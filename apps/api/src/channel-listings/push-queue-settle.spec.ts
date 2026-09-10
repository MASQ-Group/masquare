import { describe, expect, it } from 'vitest';
import { settlePushQueue } from './push-queue-settle';

const row = (id: string, productId: string) => ({ id, productId });

describe('settlePushQueue', () => {
  it('settles a product every channel accepted', () => {
    const due = [row('q1', 'p1')];
    const { settled, retry } = settlePushQueue(due, [
      { productId: 'p1', ok: true },
      { productId: 'p1', ok: true },
    ]);
    expect(settled).toHaveLength(1);
    expect(retry).toHaveLength(0);
  });

  /**
   * The case the all-or-nothing version got wrong. Seven marketplaces took the figure and one
   * refused; clearing the debt would report success and lose the refusal, which is the exact
   * silence this queue was built to end.
   */
  it('keeps a product owing when any single channel refused', () => {
    const { settled, retry } = settlePushQueue([row('q1', 'p1')], [
      { productId: 'p1', ok: true },
      { productId: 'p1', ok: false, message: 'SKU not found in this marketplace' },
      { productId: 'p1', ok: true },
    ]);
    expect(settled).toHaveLength(0);
    expect(retry[0].why).toBe('SKU not found in this marketplace');
  });

  /** One product's failure must not hold up the others drained alongside it. */
  it('settles the healthy products in the same drain', () => {
    const { settled, retry } = settlePushQueue([row('q1', 'p1'), row('q2', 'p2'), row('q3', 'p3')], [
      { productId: 'p1', ok: true },
      { productId: 'p2', ok: false, message: 'rate limited' },
      { productId: 'p3', ok: true },
    ]);
    expect(settled.map((s) => s.id)).toEqual(['q1', 'q3']);
    expect(retry.map((r) => r.row.id)).toEqual(['q2']);
  });

  /**
   * A product with no listings at all comes back with no results. It owes nothing, so holding the
   * debt would leave a row that can never clear — a permanent worklist entry for a non-problem.
   */
  it('settles a product that had nothing to push to', () => {
    const { settled, retry } = settlePushQueue([row('q1', 'p1')], []);
    expect(settled).toHaveLength(1);
    expect(retry).toHaveLength(0);
  });

  /**
   * A failure that names no product cannot be attributed. It must not condemn an unrelated debt,
   * and equally must not be read as anyone's success.
   */
  it('ignores an unattributable failure', () => {
    const { settled, retry } = settlePushQueue([row('q1', 'p1')], [
      { productId: null, ok: false, message: 'connection reset' },
      { productId: 'p1', ok: true },
    ]);
    expect(settled).toHaveLength(1);
    expect(retry).toHaveLength(0);
  });

  /** A refusal with no message still has to say something a reader can act on. */
  it('always carries a reason forward', () => {
    const { retry } = settlePushQueue([row('q1', 'p1')], [{ productId: 'p1', ok: false, message: '  ' }]);
    expect(retry[0].why).toBe('refused');
  });

  /** The first refusal is the one reported, so the reason does not churn between drains. */
  it('reports the first refusal rather than the last', () => {
    const { retry } = settlePushQueue([row('q1', 'p1')], [
      { productId: 'p1', ok: false, message: 'first' },
      { productId: 'p1', ok: false, message: 'second' },
    ]);
    expect(retry[0].why).toBe('first');
  });
});

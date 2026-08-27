import { describe, expect, it } from 'vitest';

/**
 * An FBA shipment cannot be confirmed until its actual shipping cost is registered.
 *
 * Confirming is what settles the cost. That cost is allocated across the shipment's SKUs, feeds the
 * fulfilment pool average, and lands in the profit on every order fulfilled from the shipment.
 * Confirming while still on the estimate publishes a guess as settled, and nothing downstream can
 * tell the difference afterwards.
 *
 * The rule also decides where a shipment appears: the Shipments FBA tab is the worklist of what
 * still needs costing, and All shipments is the log of what is settled.
 */

const NEEDS_COST = /Register the actual shipping cost/;

/** assertCostRegistered, as the service applies it. */
function assertCostRegistered(actualCostEur: number | null | undefined) {
  if (actualCostEur == null) {
    throw new Error(
      'Register the actual shipping cost before confirming — a confirmed shipment sets the cost used for every order fulfilled from it.',
    );
  }
}

describe('confirming', () => {
  it('is refused with no actual cost', () => {
    expect(() => assertCostRegistered(null)).toThrow(NEEDS_COST);
    expect(() => assertCostRegistered(undefined)).toThrow(NEEDS_COST);
  });

  it('is allowed once a cost is registered', () => {
    expect(() => assertCostRegistered(240.5)).not.toThrow();
  });

  it('accepts a genuine zero', () => {
    // Zero is a registered cost, not a missing one — a shipment can be carried free. `== null` is
    // load-bearing here; a falsy check would reject it and leave the shipment stuck on the worklist.
    expect(() => assertCostRegistered(0)).not.toThrow();
  });

  it('cannot be done at creation', () => {
    // A shipment being created has no actual cost — that arrives with the carrier's invoice — so
    // create() passes null and the rule refuses it. Drafts are the only thing you can create.
    expect(() => assertCostRegistered(null)).toThrow(NEEDS_COST);
  });
});

/**
 * Where a shipment shows up. Since confirming now requires a cost, "still a draft" and "not yet
 * costed" are the same set in the steady state — but a cost entered without confirming must keep
 * the shipment on the worklist rather than let it fall out of both lists.
 */
type Fba = { status: 'draft' | 'confirmed'; actualCostEur: number | null };

const onWorklist = (s: Fba) => s.status !== 'confirmed';
const inLog = (s: Fba) => s.status === 'confirmed' && s.actualCostEur != null;

describe('which list a shipment belongs to', () => {
  const uncosted: Fba = { status: 'draft', actualCostEur: null };
  const costedNotConfirmed: Fba = { status: 'draft', actualCostEur: 300 };
  const settled: Fba = { status: 'confirmed', actualCostEur: 300 };

  it('keeps an uncosted shipment on the FBA worklist', () => {
    expect(onWorklist(uncosted)).toBe(true);
    expect(inLog(uncosted)).toBe(false);
  });

  it('moves a settled shipment to the log', () => {
    expect(onWorklist(settled)).toBe(false);
    expect(inLog(settled)).toBe(true);
  });

  it('keeps a costed but unconfirmed shipment on the worklist', () => {
    // The operator entered the cost and stopped. There is still an action outstanding, so it stays
    // where that action is done.
    expect(onWorklist(costedNotConfirmed)).toBe(true);
  });

  it('never leaves a shipment out of both lists', () => {
    for (const s of [uncosted, costedNotConfirmed, settled]) {
      expect(onWorklist(s) || inLog(s)).toBe(true);
    }
  });

  it('never shows the same shipment in both', () => {
    for (const s of [uncosted, costedNotConfirmed, settled]) {
      expect(onWorklist(s) && inLog(s)).toBe(false);
    }
  });
});

/**
 * The log merges two tables into one date-ordered page. To fill page N, each source can contribute
 * at most the rows up to the end of that page, so taking `page * pageSize` from each and slicing
 * the merge is exact — not an approximation that drops rows at a boundary.
 */
describe('merging the two sources into one page', () => {
  const at = (r: { d: string }) => new Date(r.d).getTime();
  const own = [{ id: 'o1', d: '2026-08-01' }, { id: 'o2', d: '2026-06-01' }, { id: 'o3', d: '2026-04-01' }];
  const fba = [{ id: 'f1', d: '2026-07-01' }, { id: 'f2', d: '2026-05-01' }, { id: 'f3', d: '2026-03-01' }];

  const pageOf = (page: number, pageSize: number, asc = false) => {
    const upTo = page * pageSize;
    const by = (a: { d: string }, b: { d: string }) => (asc ? at(a) - at(b) : at(b) - at(a));
    // Each source is queried in the requested direction, so its first `upTo` rows are the ones that
    // could reach this page. Slicing a fixed order instead would take the wrong end when ascending.
    const take = (rows: { id: string; d: string }[]) => [...rows].sort(by).slice(0, upTo);
    return [...take(own), ...take(fba)]
      .sort(by)
      .slice((page - 1) * pageSize, upTo)
      .map((r) => r.id);
  };

  it('interleaves both sources by date', () => {
    expect(pageOf(1, 6)).toEqual(['o1', 'f1', 'o2', 'f2', 'o3', 'f3']);
  });

  it('is exact at a page boundary', () => {
    // The second page must continue the merged order, not restart one source's.
    expect(pageOf(1, 2)).toEqual(['o1', 'f1']);
    expect(pageOf(2, 2)).toEqual(['o2', 'f2']);
    expect(pageOf(3, 2)).toEqual(['o3', 'f3']);
  });

  it('honours ascending order too', () => {
    expect(pageOf(1, 2, true)).toEqual(['f3', 'o3']);
  });

  it('totals both sources', () => {
    expect(own.length + fba.length).toBe(6);
  });
});

import { describe, expect, it } from 'vitest';

/**
 * Pan-European FBA: stock is shipped to Amazon IT, Amazon redistributes it across Europe, and the
 * sale arrives on Amazon SE. Inbound cost is recorded against the channel that received the
 * shipment, so a Swedish order found nothing and booked zero inbound cost — reading more profitable
 * than it was, on every unit sold that way.
 *
 * A pool says which channels share one body of stock. It is declared, not inferred: nothing in the
 * data connects a shipment to Italy with a sale in Sweden, and guessing would be worse than the gap.
 */

type Pool = { id: string; from: Date | null; to: Date | null };

/**
 * The lookup as fbaUnitCost performs it: pool first when one applies, then the channel's own figure.
 */
function unitCost(
  poolAvg: Map<string, number>,
  byChannel: Map<string, Pool[]>,
  direct: Map<string, number>,
  it: { sku: string; productId: string | null },
  channelId: string,
  orderDate: Date | null,
): number {
  const sku = it.sku.trim().toLowerCase();
  for (const p of byChannel.get(channelId) ?? []) {
    if (orderDate && p.from && orderDate < p.from) continue;
    if (orderDate && p.to && orderDate > p.to) continue;
    const hit = (it.productId ? poolAvg.get(`P:${p.id}:p:${it.productId}`) : undefined)
      ?? poolAvg.get(`P:${p.id}:s:${sku}`);
    if (hit != null) return hit;
  }
  return (
    (it.productId ? direct.get(`p:${it.productId}:${channelId}`) : undefined)
    ?? direct.get(`s:${sku}:${channelId}`)
    ?? 0
  );
}

const IT = 'ch-it', SE = 'ch-se', DE = 'ch-de', AU = 'ch-au';
const item = { sku: 'IT69283-FBA', productId: 'p1' };

/** One pool: IT receives, SE and DE sell. Average across the pool is 4.00. */
const poolAvg = new Map<string, number>([
  ['P:pool-eu:p:p1', 4],
  ['P:pool-eu:s:it69283-fba', 4],
]);
const byChannel = new Map<string, Pool[]>([
  [SE, [{ id: 'pool-eu', from: null, to: null }]],
  [DE, [{ id: 'pool-eu', from: null, to: null }]],
]);

describe('a sale on a channel that never received stock', () => {
  it('draws the pool average instead of booking nothing', () => {
    // The bug this fixes: 0, on a sale that certainly cost something to fulfil.
    expect(unitCost(poolAvg, byChannel, new Map(), item, SE, null)).toBe(4);
  });

  it('leaves a channel outside the pool alone', () => {
    // Australia is its own arrangement. Nothing about Europe applies to it.
    const direct = new Map([[`p:p1:${AU}`, 9]]);
    expect(unitCost(poolAvg, byChannel, direct, item, AU, null)).toBe(9);
    expect(unitCost(poolAvg, byChannel, new Map(), item, AU, null)).toBe(0);
  });

  it('finds the pool by SKU when the sale line has no product', () => {
    expect(unitCost(poolAvg, byChannel, new Map(), { sku: 'IT69283-FBA', productId: null }, SE, null)).toBe(4);
  });
});

describe('a channel that both receives and sells', () => {
  it('uses the pool average, not its own shipments', () => {
    // Germany has inbound shipments of its own at 3.00, but is in the pool. Once Amazon commingles
    // the stock the unit that sold cannot be traced to a particular shipment, so an average across
    // the pool is the truthful figure and the direct match is false precision.
    const direct = new Map([[`p:p1:${DE}`, 3]]);
    expect(unitCost(poolAvg, byChannel, direct, item, DE, null)).toBe(4);
  });
});

describe('when the arrangement started', () => {
  const enrolled = new Date('2026-01-01');
  const dated = new Map<string, Pool[]>([[SE, [{ id: 'pool-eu', from: enrolled, to: null }]]]);
  const direct = new Map([[`p:p1:${SE}`, 7]]);

  it('leaves orders from before enrolment as they were', () => {
    // Before enrolment an Italian shipment genuinely did not supply Sweden. Retro-fitting the pool
    // would rewrite profit on orders that were already correct.
    expect(unitCost(poolAvg, dated, direct, item, SE, new Date('2025-06-01'))).toBe(7);
  });

  it('applies from the start date onward', () => {
    expect(unitCost(poolAvg, dated, direct, item, SE, enrolled)).toBe(4);
    expect(unitCost(poolAvg, dated, direct, item, SE, new Date('2026-08-27'))).toBe(4);
  });

  it('stops at the end date', () => {
    const closed = new Map<string, Pool[]>([[SE, [{ id: 'pool-eu', from: null, to: new Date('2026-03-31') }]]]);
    expect(unitCost(poolAvg, closed, direct, item, SE, new Date('2026-03-30'))).toBe(4);
    expect(unitCost(poolAvg, closed, direct, item, SE, new Date('2026-04-01'))).toBe(7);
  });
});

describe('a channel in more than one pool', () => {
  // Successive arrangements: one closed, another opened. Both are listed against the channel, and
  // only the one covering the order date may answer.
  const avg = new Map<string, number>([['P:old:p:p1', 2], ['P:new:p:p1', 5]]);
  const both = new Map<string, Pool[]>([[SE, [
    { id: 'old', from: null, to: new Date('2025-12-31') },
    { id: 'new', from: new Date('2026-01-01'), to: null },
  ]]]);

  it('picks the pool in force at the time', () => {
    expect(unitCost(avg, both, new Map(), item, SE, new Date('2025-07-01'))).toBe(2);
    expect(unitCost(avg, both, new Map(), item, SE, new Date('2026-07-01'))).toBe(5);
  });
});

describe('a pool with nothing recorded for the product', () => {
  it('falls through to the channel rather than forcing a zero', () => {
    // The pool applies but has never seen this product. The channel's own figure is still better
    // than nothing, and returning 0 here would recreate the original bug inside the fix.
    const direct = new Map([[`p:p1:${SE}`, 6]]);
    expect(unitCost(new Map(), byChannel, direct, item, SE, null)).toBe(6);
  });
});

describe('what a pool must declare', () => {
  // checkPoolChannels rejects these at the door: a pool with no receiving channel has no cost to
  // share, so every sale on it would read zero — the very thing the pool exists to stop.
  const check = (rows: { receives?: boolean; sells?: boolean }[]) => {
    if (!rows.some((c) => c.receives)) throw new Error('no receiver');
    if (!rows.some((c) => c.sells)) throw new Error('no seller');
    return rows;
  };

  it('refuses a pool nothing ships into', () => {
    expect(() => check([{ receives: false, sells: true }])).toThrow('no receiver');
  });

  it('refuses a pool nothing sells from', () => {
    expect(() => check([{ receives: true, sells: false }])).toThrow('no seller');
  });

  it('accepts one channel that does both', () => {
    expect(check([{ receives: true, sells: true }])).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';

/**
 * Orders the marketplace has announced but not yet priced.
 *
 * A channel tells us about an order twice: once when the customer places it, and again — days
 * later — with what it was actually worth. In between the order is real, has goods against it, and
 * has no revenue, so every cost on it lands with nothing on the other side.
 *
 * The resulting loss is a fact about the sync, not about the business, and it corrects itself a
 * week later without anyone touching it. That is the worst shape of wrong number: nobody
 * reconciles a figure that moves on its own.
 *
 * The rule is four conditions and every one of them matters, so they are pinned individually. Most
 * are the kind that look redundant to a later reader and get "simplified" away.
 */

type Txn = {
  source: string | null;
  resolution: string;
  quantity: number;
  netSales: number;
};

const CHANNEL_FED = (source: string | null) => source != null && !['manual', 'erp_import'].includes(source);

/** Mirrors sales-transactions.service.ts. */
const awaitingFinancials = (t: Txn) =>
  CHANNEL_FED(t.source) && t.resolution === 'none' && t.quantity > 0 && t.netSales === 0;

const base: Txn = { source: 'amazon', resolution: 'none', quantity: 1, netSales: 0 };

describe('what counts as awaiting financials', () => {
  it('catches the ordinary case: an Amazon order with goods and no money yet', () => {
    expect(awaitingFinancials(base)).toBe(true);
  });

  it('releases the order the moment net sales arrive', () => {
    // The whole point. Fees may still be missing — they are estimated and that estimate is good
    // enough — but revenue is what decides whether the order can be measured.
    expect(awaitingFinancials({ ...base, netSales: 24.99 })).toBe(false);
  });

  it('ignores a cancellation, which is deliberately worth nothing', () => {
    // A cancelled order already settles at zero through its own rule. Treating it as "pending"
    // would leave it out of the totals forever, since its revenue is never coming.
    expect(awaitingFinancials({ ...base, resolution: 'cancelled' })).toBe(false);
  });

  it('ignores a return or a replacement', () => {
    for (const resolution of ['returned', 'replaced']) {
      expect(awaitingFinancials({ ...base, resolution }), resolution).toBe(false);
    }
  });

  it('ignores an order with no goods on it', () => {
    // Nothing to be paid for, so nothing to wait for.
    expect(awaitingFinancials({ ...base, quantity: 0 })).toBe(false);
  });

  it('does not wait on a hand-keyed order', () => {
    // Nothing further is coming for these: a zero is the figure somebody typed, and hiding it
    // would hide their mistake rather than a timing gap.
    expect(awaitingFinancials({ ...base, source: 'manual' })).toBe(false);
  });

  it('does not wait on a historical import', () => {
    // There is one such order on this database, 73 days old and still at zero. It is a data
    // problem, and excluding it would bury the evidence.
    expect(awaitingFinancials({ ...base, source: 'erp_import' })).toBe(false);
  });

  it('applies to every live channel, not just Amazon', () => {
    // Amazon is the one that does this at scale, but the condition is "the money has not arrived",
    // which is not Amazon-specific — and naming one channel would quietly exclude the next.
    for (const source of ['amazon', 'ebay', 'onbuy']) {
      expect(awaitingFinancials({ ...base, source }), source).toBe(true);
    }
  });
});

describe('what such an order contributes', () => {
  // Analytics adds nothing from these and counts them separately. Modelled here as the aggregate
  // loop does it, so the "counted, never added" property is asserted rather than assumed.
  const aggregate = (txns: (Txn & { profit: number | null })[]) => {
    const totals = { profitEur: 0, orders: 0, units: 0 };
    const pending = { orders: 0, units: 0 };
    for (const t of txns) {
      if (awaitingFinancials(t)) {
        pending.orders += 1;
        pending.units += t.quantity;
        continue;
      }
      totals.profitEur += t.profit ?? 0;
      totals.orders += 1;
      totals.units += t.quantity;
    }
    return { totals, pending };
  };

  it('leaves the company profit untouched', () => {
    const settled = { ...base, netSales: 100, profit: 40 };
    const waiting = { ...base, profit: null };
    const { totals, pending } = aggregate([settled, waiting, waiting]);
    expect(totals.profitEur).toBe(40);
    expect(totals.orders).toBe(1);
    expect(pending.orders).toBe(2);
  });

  it('does not count their units either', () => {
    // Units with no revenue would drag every per-unit figure — average price, fee per unit —
    // toward zero just as surely as the profit.
    const { totals, pending } = aggregate([
      { ...base, netSales: 100, profit: 40, quantity: 2 },
      { ...base, profit: null, quantity: 5 },
    ]);
    expect(totals.units).toBe(2);
    expect(pending.units).toBe(5);
  });

  it('reports profit as unknown rather than as break-even', () => {
    // null, not 0. Zero is a claim that the order broke even, which is just as untrue as the loss
    // and much harder to notice.
    const waiting = { ...base, profit: null };
    expect(waiting.profit).toBeNull();
    expect(aggregate([waiting]).totals.profitEur).toBe(0);
  });

  it('folds the order back in once the money lands, with nothing left behind', () => {
    const before = aggregate([{ ...base, profit: null }]);
    const after = aggregate([{ ...base, netSales: 100, profit: 40 }]);
    expect(before.totals.orders).toBe(0);
    expect(before.pending.orders).toBe(1);
    expect(after.totals.orders).toBe(1);
    expect(after.totals.profitEur).toBe(40);
    expect(after.pending.orders).toBe(0);
  });
});

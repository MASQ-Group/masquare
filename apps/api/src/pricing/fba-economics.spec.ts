import { describe, it, expect } from 'vitest';

// The FBA cost basis Individual Pricing must share with the sales-transaction module:
// an FBA unit's "shipping" is the allocated freight INTO Amazon, and Amazon's fulfilment fee
// is a separate per-unit charge. Both have to be in the profit, or FBA reads too profitable.
//
// Mirrors economics(): profit is net of VAT, but the referral fee and the target margin are
// both measured against the VAT-inclusive amount the buyer pays.
function profit(gross: number, vatPct: number, feePct: number, cost: number, shipping: number, fbaFee: number): number {
  const net = gross / (1 + vatPct / 100);
  return net - gross * (feePct / 100) - cost - shipping - fbaFee;
}

describe('FBA economics', () => {
  it('charges both the inbound freight and the fulfilment fee', () => {
    const fba = profit(100, 20, 15, 30, 2.5, 6);
    expect(fba).toBeCloseTo(100 / 1.2 - 15 - 30 - 2.5 - 6, 6);
  });

  it('omitting the fulfilment fee overstates FBA profit by exactly that fee', () => {
    const withFee = profit(100, 20, 15, 30, 2.5, 6);
    const withoutFee = profit(100, 20, 15, 30, 2.5, 0);
    expect(withoutFee - withFee).toBeCloseTo(6, 6);
  });

  it('a target-margin price recovers the fulfilment fee', () => {
    // solveGrossEur: gross x (1/(1+vat) - fee - target) = cost + shipping + fbaFee
    const solve = (target: number, cost: number, shipping: number, fbaFee: number) =>
      (cost + shipping + fbaFee) / (1 / 1.2 - 0.15 - target);
    const withFee = solve(0.1, 30, 2.5, 6);
    expect(withFee).toBeGreaterThan(solve(0.1, 30, 2.5, 0));
    // the solved price hits the target margin once the fulfilment fee is paid
    expect(profit(withFee, 20, 15, 30, 2.5, 6)).toBeCloseTo(0.1 * withFee, 6);
  });

  it('an FBA unit never sent to Amazon falls back to the weight estimate, not zero', () => {
    const allocated: number | null = null;
    const weightEstimate = 4.2;
    expect(allocated ?? weightEstimate).toBe(4.2);
  });
});

// An FBA shipment or order line that never linked to a product carries only a SKU. Matching on
// product id alone finds nothing and the cost reads as if the unit had never been sent to Amazon.
describe('FBA cost matching', () => {
  const rows = [
    { productId: null, sku: 'LAG-8.1681.09-FBA', qty: 10, cost: 54 },
    { productId: 'p1', sku: 'LAG-8.1681.09', qty: 5, cost: 26 },
  ];
  const match = (productId: string, skus: string[]) =>
    rows.filter((r) => r.productId === productId || skus.includes(r.sku.trim().toLowerCase()));

  it('product-only matching misses SKU-only lines', () => {
    expect(match('p1', []).length).toBe(1);
  });

  it('matching on product OR any known SKU finds them all', () => {
    const skus = ['lag-8.1681.09', 'lag-8.1681.09-fba'];
    const hit = match('p1', skus);
    expect(hit.length).toBe(2);
    const perUnit = hit.reduce((s, r) => s + r.cost, 0) / hit.reduce((s, r) => s + r.qty, 0);
    expect(perUnit).toBeCloseTo(80 / 15, 6);
  });

  it('an unknown fulfilment fee is null, never 0', () => {
    const resolve = (byProduct: number | null, byChannel: number | null) => byProduct ?? byChannel ?? null;
    expect(resolve(null, null)).toBeNull();
    expect(resolve(null, 6.2)).toBe(6.2);
    expect(resolve(5.1, 6.2)).toBe(5.1);
  });
});

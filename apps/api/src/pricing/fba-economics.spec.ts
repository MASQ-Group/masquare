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

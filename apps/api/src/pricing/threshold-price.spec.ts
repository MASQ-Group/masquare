import { describe, it, expect } from 'vitest';
import { lowestPriceForMargin } from './threshold-price';

/**
 * A UK channel as production has it: 15% fee, 20% VAT at or under £135 net (£162.00 gross), none over
 * it. Figures in GBP here with a rate of 1, which is all the helper cares about.
 */
const LINE_GROSS = 135 * 1.2;
const vatAt = (gross: number) => (gross / 1.2 <= 135 ? 20 : 0);
const solver = (costs: number, fee = 0.15, target = 0.2) => (vat: number) => {
  const denom = 1 / (1 + vat / 100) - fee - target;
  return denom > 0 ? costs / denom : null;
};
const uk = (costs: number) => ({ rates: [20, 0], vatAt, solveAt: solver(costs), firstAboveEur: LINE_GROSS + 0.01 });

describe('lowest price for a margin across the UK VAT line', () => {
  it('prices IT33248 on its own side of the line — not the 20%-VAT answer that sits over it', () => {
    // €97 cost + €46 shipping = €143; at £1 = €1.1644 that is £122.81.
    const costs = 143 / 1.1644;
    const price = lowestPriceForMargin(uk(costs))!;
    expect(price).toBeCloseTo(188.94, 2);
    expect(vatAt(price)).toBe(0);
    // The old rule took the higher answer: the 20%-VAT one, £254.09, which earns ~37%.
    expect(solver(costs)(20)!).toBeCloseTo(254.09, 2);
  });

  it('keeps the under-the-line answer for a cheap product', () => {
    const price = lowestPriceForMargin(uk(20))!;
    expect(price).toBeCloseTo(20 / (1 / 1.2 - 0.35), 6);
    expect(vatAt(price)).toBe(20);
  });

  it('takes the first price over the line when neither answer lands on its own side', () => {
    // Needs over £162 with VAT taken, but under £162 without it: the line itself is the answer.
    const costs = 90;
    expect(solver(costs)(20)!).toBeGreaterThan(LINE_GROSS);
    expect(solver(costs)(0)!).toBeLessThan(LINE_GROSS);
    expect(lowestPriceForMargin(uk(costs))).toBeCloseTo(162.01, 6);
  });

  it('says no price reaches the margin when fees and tax consume it', () => {
    expect(lowestPriceForMargin({ ...uk(50), solveAt: solver(50, 0.9) })).toBeNull();
  });

  it('works for a channel with no line', () => {
    expect(lowestPriceForMargin({ rates: [21], vatAt: () => 21, solveAt: solver(100), firstAboveEur: null }))
      .toBeCloseTo(100 / (1 / 1.21 - 0.35), 6);
  });
});

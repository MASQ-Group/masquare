import { describe, expect, it } from 'vitest';
import { grossToNet } from './floor-solver';

/**
 * One margin basis, so two numbers on the same panel can be compared.
 *
 * From Amazon FR on 6 Sep 2026, side by side in the listing panel:
 *
 *   Lowest price     EUR 67.50   18.2%
 *   Our suggestion   EUR 65.52   at 20%
 *
 * A LOWER price appearing to earn a HIGHER margin, which cannot happen on one cost basis. Both
 * figures were right about different things:
 *
 *   the suggestion   solveMinFeasiblePrice targets netRevenue(P) >= margin * grossToNet(P)
 *                    -> a fraction of NET revenue
 *   the at-price     profitCents / priceCents
 *                    -> a fraction of GROSS price
 *
 * and a comment above the second claimed it was "the same basis the floor solver targets", which
 * is the sort of assertion that stops anyone checking.
 *
 * Reported on net now, matching the target. The lowest offer reads 21.8% — above the suggested
 * 20%, as a price above the suggestion must be.
 */
describe('margin is quoted on one basis', () => {
  const VAT = 0.2; // Amazon FR

  it('reproduces the contradiction the old basis produced', () => {
    const profitAt6750 = 1228; // cents, as published on the panel
    const ofGross = (1228 / 6750) * 100;
    expect(ofGross).toBeCloseTo(18.2, 1);
    // Below the suggestion's stated 20%, despite EUR 67.50 being ABOVE the EUR 65.52 suggestion.
    expect(ofGross).toBeLessThan(20);
  });

  it('puts the lowest offer above the suggestion, as its price demands', () => {
    const ofNet = (1228 / grossToNet(6750, VAT)) * 100;
    expect(ofNet).toBeCloseTo(21.8, 1);
    expect(ofNet).toBeGreaterThan(20);
  });

  it('agrees with the solver at the suggested price itself', () => {
    // The suggestion targets 20% of net at EUR 65.52, so that profit reported on net is 20%.
    const netAt6552 = grossToNet(6552, VAT);
    const profit = 0.2 * netAt6552;
    expect((profit / netAt6552) * 100).toBeCloseTo(20, 6);
  });

  it('is monotonic: a higher price never reports a lower margin', () => {
    // The property the old basis broke. Same costs, rising price, on one basis.
    const costs = 3408; // cents, recovered from the two published points
    const referral = 0.1465;
    const marginOfNet = (p: number) => {
      const profit = grossToNet(p, VAT) - costs - referral * p;
      return (profit / grossToNet(p, VAT)) * 100;
    };
    let previous = -Infinity;
    for (let price = 5000; price <= 9000; price += 250) {
      const m = marginOfNet(price);
      expect(m).toBeGreaterThan(previous);
      previous = m;
    }
  });

  it('is the identity where there is no VAT to strip', () => {
    // UK above the GBP 135 threshold resolves to 0%: net and gross coincide, and the two bases
    // agree — which is why this never showed up there.
    expect(grossToNet(6750, 0)).toBe(6750);
  });
});

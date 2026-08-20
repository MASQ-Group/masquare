import { describe, it, expect } from 'vitest';
import { solveFloors, netRevenueExactCents } from './floor-solver';

// Amazon AU adds GST at checkout for an overseas seller, so the price we list is already our
// revenue. Modelled by passing vatRate 0 -- the bug this guards against is carrying the real 10%
// and dividing it out of a price that never contained it.
const AU_BRACKETS = [{ minCents: 1, maxCents: Number.MAX_SAFE_INTEGER, pct: 0.15 }];
const base = { referralBrackets: AU_BRACKETS, cogsLandedCents: 5000, fixedPerUnitCents: 1000 };

describe('tax-exclusive channels (Amazon AU)', () => {
  it('treats the listed price as revenue in full', () => {
    const { breakevenCents } = solveFloors({ ...base, vatRate: 0 }, 0);
    // 0.85 * P = 6000  ->  P = 7058.8 -> 7059
    expect(breakevenCents).toBe(7059);
    expect(netRevenueExactCents(breakevenCents!, { ...base, vatRate: 0 })).toBeGreaterThanOrEqual(0);
  });

  it('does not divide out a tax the price never contained', () => {
    const exclusive = solveFloors({ ...base, vatRate: 0 }, 0).breakevenCents!;
    const asIfInclusive = solveFloors({ ...base, vatRate: 0.1 }, 0).breakevenCents!;
    // Wrongly treating the price as GST-inclusive inflates the floor by roughly the GST rate.
    expect(asIfInclusive).toBeGreaterThan(exclusive);
    expect(asIfInclusive / exclusive).toBeCloseTo(1.1, 1);
  });

  it('still applies the margin to the same revenue base', () => {
    const inp = { ...base, vatRate: 0 };
    const floor = solveFloors(inp, 0.12).strategyFloorCents!;
    // With no tax to strip, net revenue IS the price, so profit must be >= 12% of the price.
    expect(netRevenueExactCents(floor, inp)).toBeGreaterThanOrEqual(0.12 * floor - 1);
  });
});

import { describe, expect, it } from 'vitest';
import { solveFloors } from './floor-solver';
import { referralScheduleFor } from '../config/referral-schedule';

// Regression: FBM outbound shipping must be inside the breakeven.
//
// For FBM there is no Amazon fulfilment fee — WE pay the carrier, so that charge is a per-unit
// cost like any other. floor.service used to leave `fixedPerUnitCents` at 0, which silently
// dropped it. Real case (LE-81520 on Amazon UK, 5 kg): the platform's own pricing puts breakeven
// at £76.46, the solver without carriage said £38.87 — every sale between the two is a loss the
// floor was supposed to prevent.
describe('FBM floor includes outbound shipping', () => {
  const GBP_TO_EUR = 1.1681;
  const gbp = (eur: number) => Math.round((eur / GBP_TO_EUR) * 100);
  const base = { vatRate: 0.20, referralBrackets: referralScheduleFor(null) };
  const cogsLandedCents = gbp(31.03); // £26.56
  const shipCents = gbp(30.0); // £25.68

  it('matches the platform breakeven when carriage is included', () => {
    const r = solveFloors({ ...base, cogsLandedCents, fixedPerUnitCents: shipCents }, 0);
    // Individual Pricing reports profit exactly €0 at £76.46 for this SKU.
    expect(r.breakevenCents! / 100).toBeCloseTo(76.46, 0);
  });

  it('is far too low when carriage is dropped (the bug)', () => {
    const r = solveFloors({ ...base, cogsLandedCents, fixedPerUnitCents: 0 }, 0);
    expect(r.breakevenCents! / 100).toBeCloseTo(38.87, 0);
  });

  it('rises monotonically with the shipping cost', () => {
    const at = (ship: number) => solveFloors({ ...base, cogsLandedCents, fixedPerUnitCents: ship }, 0).breakevenCents!;
    expect(at(0)).toBeLessThan(at(1000));
    expect(at(1000)).toBeLessThan(at(shipCents));
  });

  it('keeps the strategy floor above breakeven once a margin is required', () => {
    const r = solveFloors({ ...base, cogsLandedCents, fixedPerUnitCents: shipCents }, 0.12);
    expect(r.strategyFloorCents!).toBeGreaterThan(r.breakevenCents!);
  });
});

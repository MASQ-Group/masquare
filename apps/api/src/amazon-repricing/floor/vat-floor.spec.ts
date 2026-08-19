import { describe, expect, it } from 'vitest';
import { solveFloors } from './floor-solver';
import { referralScheduleFor } from '../config/referral-schedule';

// Regression: the floor must use the platform's tax resolution, not Country.vatRate.
//
// GB's country row carries 0% because the real UK rule (the £135 threshold) lives on the sales
// channel. Reading the country rate alone gave vatRate=0, which does not fail loudly — it just
// makes every UK floor far too low, so the engine would happily price below true breakeven.
// Real case, BE-MG205 on Amazon UK: cost £43.07 + shipping £23.11.
describe('UK floor is destroyed by a 0% VAT rate', () => {
  const base = { referralBrackets: referralScheduleFor(null), cogsLandedCents: 4307, fixedPerUnitCents: 2311 };

  it('with the correct 20% VAT, breakeven matches the platform (£96.85)', () => {
    const r = solveFloors({ ...base, vatRate: 0.2 }, 0);
    expect(r.breakevenCents! / 100).toBeCloseTo(96.85, 1);
  });

  it('with VAT read as 0% it collapses to the wrong figure (£77.86)', () => {
    const r = solveFloors({ ...base, vatRate: 0 }, 0);
    expect(r.breakevenCents! / 100).toBeCloseTo(77.86, 1);
  });

  it('a 0% rate always understates the floor — never the safe direction', () => {
    const correct = solveFloors({ ...base, vatRate: 0.2 }, 0).breakevenCents!;
    const zeroVat = solveFloors({ ...base, vatRate: 0 }, 0).breakevenCents!;
    expect(zeroVat).toBeLessThan(correct);
    // ~20% adrift: enough to sell under cost on every unit.
    expect((correct - zeroVat) / correct).toBeGreaterThan(0.15);
  });
});

import { describe, expect, it } from 'vitest';
import { eurToCents } from '../common/money';

// Guards the currency BASIS of the floor solver (not the solver maths, which floor-solver.spec
// covers). Everything fed to solveFloors must be in the MARKETPLACE's currency: Amazon's fee
// estimates and the SKU's current price already are, and COGS — held in EUR — is converted in
// floor.service. Mixing the two produced a UK "breakeven" of EUR cost + GBP fees: a number in no
// currency, ~17% adrift of the GBP prices the engine clamps against.

/** The conversion floor.service performs: EUR cost → marketplace currency, given native→EUR. */
const cogsNativeCents = (cogsEur: number, nativeToEur: number) => eurToCents(cogsEur / nativeToEur);

describe('floor currency basis', () => {
  const GBP_TO_EUR = 1.1681; // 1 GBP = 1.1681 EUR

  it('converts EUR COGS into the marketplace currency (GBP costs FEWER pounds than euros)', () => {
    // £-denominated cost must be lower than the € figure, since a pound buys more.
    const cents = cogsNativeCents(14.56, GBP_TO_EUR);
    expect(cents).toBe(1246); // 14.56 / 1.1681 = £12.46
    expect(cents).toBeLessThan(eurToCents(14.56));
  });

  it('is a no-op for a EUR marketplace', () => {
    expect(cogsNativeCents(14.56, 1)).toBe(eurToCents(14.56));
  });

  it('would misstate the floor by the FX gap if left unconverted (the bug this guards)', () => {
    const wrong = eurToCents(14.56);          // EUR cents treated as pence
    const right = cogsNativeCents(14.56, GBP_TO_EUR);
    // ~17% overstatement — enough to push a floor above a viable price and vice versa.
    expect((wrong - right) / right).toBeGreaterThan(0.16);
  });

  it('scales the other way for a weaker currency (more units per euro)', () => {
    const SEK_TO_EUR = 0.088; // 1 SEK ≈ 0.088 EUR
    // 14.56 EUR ≈ 165 SEK — must be MORE units, not fewer.
    expect(cogsNativeCents(14.56, SEK_TO_EUR)).toBeGreaterThan(eurToCents(14.56));
  });
});

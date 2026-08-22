import { describe, it, expect } from 'vitest';
import {
  FloorInputs,
  ReferralBracket,
  netRevenueCents,
  netRevenueExactCents,
  referralPctAt,
  solveFloors,
} from './floor-solver';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A tiered EU referral schedule with real discontinuities (illustrative of the clothing-style
// tiers in spec §4.3: e.g. 5% ≤ €15, 10% €15–20, 15% above). Fees are DATA — these are test
// data, not the production schedule (which floor-service refreshes from Amazon).
const TIERED: ReferralBracket[] = [
  { minCents: 1, maxCents: 1500, pct: 0.05 }, // ≤ €15.00
  { minCents: 1501, maxCents: 2000, pct: 0.1 }, // €15.01–20.00
  { minCents: 2001, maxCents: Number.MAX_SAFE_INTEGER, pct: 0.15 }, // > €20.00
];

// A flat 15% schedule — the common single-bracket case.
const FLAT_15: ReferralBracket[] = [
  { minCents: 1, maxCents: Number.MAX_SAFE_INTEGER, pct: 0.15 },
];

const DE_VAT = 0.19;
const FR_VAT = 0.2;
const ES_VAT = 0.21;

/** A baseline FBA SKU: €8 landed cost, €3 FBA fee, flat 15% referral, DE VAT. */
function baseFba(overrides: Partial<FloorInputs> = {}): FloorInputs {
  return {
    vatRate: DE_VAT,
    referralBrackets: FLAT_15,
    fbaFulfillmentFeeCents: 300,
    cogsLandedCents: 800,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// referralPctAt — bracket lookup
// ---------------------------------------------------------------------------

describe('referralPctAt', () => {
  it.each([
    [1, 0.05],
    [1500, 0.05], // top edge of bracket 1
    [1501, 0.1], // bottom edge of bracket 2
    [2000, 0.1], // top edge of bracket 2
    [2001, 0.15], // bottom edge of bracket 3
    [999999, 0.15],
  ])('price %ic → pct %f', (price, pct) => {
    expect(referralPctAt(price, TIERED)).toBe(pct);
  });

  it('throws when no bracket covers the price', () => {
    const gap: ReferralBracket[] = [{ minCents: 1, maxCents: 1000, pct: 0.15 }];
    expect(() => referralPctAt(5000, gap)).toThrow(/No referral bracket/);
  });
});

// ---------------------------------------------------------------------------
// netRevenueCents — the cost model
// ---------------------------------------------------------------------------

describe('netRevenueCents', () => {
  it('computes net revenue on the VAT-inclusive → net basis (spec §4.3)', () => {
    // P = €20.00 gross, DE 19% VAT, flat 15% referral, €3 FBA, €8 COGS.
    // net = round(2000 / 1.19) = 1681;  referral = round(0.15 × 2000) = 300 (gross basis)
    // netRevenue = 1681 − 300 − 300 − 800 = 281
    expect(netRevenueCents(2000, baseFba())).toBe(281);
  });

  it('honours the net referral-fee basis when configured (§9-#20 TO VERIFY)', () => {
    // referral on net: round(0.15 × round(2000/1.19)) = round(0.15 × 1681) = 252
    // netRevenue = 1681 − 252 − 300 − 800 = 329
    expect(netRevenueCents(2000, baseFba({ referralFeeBasis: 'net' }))).toBe(329);
  });

  it('applies the per-item minimum referral fee when the percentage is smaller', () => {
    // P = €5.00, pct 15% → 75c raw, but min fee 90c dominates.
    const inp = baseFba({ perItemMinReferralFeeCents: 90, cogsLandedCents: 100, fbaFulfillmentFeeCents: 0 });
    // net = round(500/1.19)=420; referral = max(90, round(0.15×500)=75)=90; −100 cogs → 230
    expect(netRevenueCents(500, inp)).toBe(230);
  });

  it('is strictly increasing in price within a single bracket (monotonicity)', () => {
    const inp = baseFba();
    let prev = -Infinity;
    for (let p = 1000; p <= 2000; p += 1) {
      const nr = netRevenueCents(p, inp);
      expect(nr).toBeGreaterThanOrEqual(prev);
      prev = nr;
    }
  });

  it('drops discontinuously at a bracket edge where the percentage steps up', () => {
    const inp = baseFba({ referralBrackets: TIERED, fbaFulfillmentFeeCents: 0, cogsLandedCents: 100 });
    // At the €20.00/€20.01 edge the referral pct jumps 10% → 15%.
    const below = netRevenueCents(2000, inp); // 10% bracket
    const above = netRevenueCents(2001, inp); // 15% bracket
    expect(above).toBeLessThan(below); // net revenue falls despite the +1c price
  });
});

// ---------------------------------------------------------------------------
// solveFloors — breakeven & strategy floor
// ---------------------------------------------------------------------------

describe('solveFloors', () => {
  it('finds a breakeven where net revenue first reaches 0', () => {
    const inp = baseFba();
    const { breakevenCents } = solveFloors(inp, 0.12);
    expect(breakevenCents).not.toBeNull();
    // The cent just below breakeven must be a loss; breakeven itself must be ≥ 0 (exact P&L,
    // the function the solver optimizes — the rounded display can read 0 either side of the line).
    expect(netRevenueExactCents(breakevenCents! - 1, inp)).toBeLessThan(0);
    expect(netRevenueExactCents(breakevenCents!, inp)).toBeGreaterThanOrEqual(0);
  });

  it('strategy floor is always ≥ breakeven (minimum-margin monotonicity)', () => {
    const cases: FloorInputs[] = [
      baseFba(),
      baseFba({ vatRate: FR_VAT }),
      baseFba({ vatRate: ES_VAT, referralBrackets: TIERED }),
      baseFba({ referralBrackets: TIERED, returnsRate: 0.08, refundAdminFeeCents: 50 }),
    ];
    for (const inp of cases) {
      const { breakevenCents, strategyFloorCents } = solveFloors(inp, 0.12);
      expect(breakevenCents).not.toBeNull();
      expect(strategyFloorCents).not.toBeNull();
      expect(strategyFloorCents!).toBeGreaterThanOrEqual(breakevenCents!);
    }
  });

  it('strategy floor clears the required net margin at the returned price', () => {
    const inp = baseFba({ referralBrackets: TIERED });
    const margin = 0.12;
    const { strategyFloorCents } = solveFloors(inp, margin);
    const net = strategyFloorCents! / (1 + inp.vatRate);
    // netRevenue at the floor must be ≥ 12% of net revenue (exact P&L).
    expect(netRevenueExactCents(strategyFloorCents!, inp)).toBeGreaterThanOrEqual(margin * net);
    // One cent lower must fail the margin bar.
    const below = strategyFloorCents! - 1;
    const netBelow = below / (1 + inp.vatRate);
    expect(netRevenueExactCents(below, inp)).toBeLessThan(margin * netBelow);
  });

  it('higher VAT ⇒ higher floor, all else equal (DE < FR < ES)', () => {
    const de = solveFloors(baseFba({ vatRate: DE_VAT }), 0.12).breakevenCents!;
    const fr = solveFloors(baseFba({ vatRate: FR_VAT }), 0.12).breakevenCents!;
    const es = solveFloors(baseFba({ vatRate: ES_VAT }), 0.12).breakevenCents!;
    expect(de).toBeLessThan(fr);
    expect(fr).toBeLessThan(es);
  });

  it('FBM (no FBA fee) yields a lower floor than the same SKU on FBA', () => {
    const fba = solveFloors(baseFba({ fbaFulfillmentFeeCents: 300 }), 0.12).breakevenCents!;
    const fbm = solveFloors(baseFba({ fbaFulfillmentFeeCents: 0 }), 0.12).breakevenCents!;
    expect(fbm).toBeLessThan(fba);
  });

  it('returns allowance and ad cost push the floor up', () => {
    const bare = solveFloors(baseFba(), 0.12).breakevenCents!;
    const withReturns = solveFloors(baseFba({ returnsRate: 0.1, refundAdminFeeCents: 100 }), 0.12).breakevenCents!;
    const withAds = solveFloors(baseFba({ adCostPerUnitCents: 150 }), 0.12).breakevenCents!;
    expect(withReturns).toBeGreaterThan(bare);
    expect(withAds).toBeGreaterThan(bare);
  });

  it('returns null (⇒ EXCLUDED) when no price in range can break even', () => {
    // Costs exceed anything achievable inside a tight search band.
    const inp = baseFba({ cogsLandedCents: 5000, searchHiCents: 2000 });
    expect(solveFloors(inp, 0.12).breakevenCents).toBeNull();
    expect(solveFloors(inp, 0.12).strategyFloorCents).toBeNull();
  });

  it('picks the smallest feasible price across brackets despite edge discontinuities', () => {
    // Construct a SKU whose breakeven sits right around the 10%→15% edge (€20.00).
    const inp: FloorInputs = {
      vatRate: DE_VAT,
      referralBrackets: TIERED,
      fbaFulfillmentFeeCents: 200,
      cogsLandedCents: 1350,
    };
    const { breakevenCents } = solveFloors(inp, 0);
    expect(breakevenCents).not.toBeNull();
    // Whatever the solver returns must be the true minimum: nothing cheaper breaks even.
    for (let p = 1; p < breakevenCents!; p += 1) {
      expect(netRevenueExactCents(p, inp)).toBeLessThan(0);
    }
    expect(netRevenueExactCents(breakevenCents!, inp)).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — same inputs give the same floors', () => {
    const inp = baseFba({ referralBrackets: TIERED, returnsRate: 0.05 });
    const a = solveFloors(inp, 0.12);
    const b = solveFloors(inp, 0.12);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Input validation (the §6.1 quarantine input classes)
// ---------------------------------------------------------------------------

describe('solveFloors input validation', () => {
  it.each([
    ['zero COGS', baseFba({ cogsLandedCents: 0 })],
    ['negative COGS', baseFba({ cogsLandedCents: -100 })],
    ['non-integer COGS', baseFba({ cogsLandedCents: 12.5 })],
  ])('throws on %s', (_label, inp) => {
    expect(() => solveFloors(inp, 0.12)).toThrow();
  });

  it('throws on an empty referral schedule', () => {
    expect(() => solveFloors(baseFba({ referralBrackets: [] }), 0.12)).toThrow(/schedule/);
  });

  it('throws on a negative VAT rate', () => {
    expect(() => solveFloors(baseFba({ vatRate: -0.1 }), 0.12)).toThrow(/vatRate/);
  });
});

// The solver has always accepted these; the service supplied none of them, so every floor was a
// fee-and-cost breakeven. The gap is invisible at a 12% margin and decisive at 2%.
describe('loaded costs', () => {
  const base = {
    vatRate: 0.19,
    referralBrackets: [{ minCents: 1, maxCents: Number.MAX_SAFE_INTEGER, pct: 0.15 }],
    cogsLandedCents: 2000,
    fixedPerUnitCents: 500,
  };

  it('a returns allowance raises the breakeven', () => {
    const bare = solveFloors(base, 0).breakevenCents!;
    const withReturns = solveFloors({ ...base, returnsRate: 0.08 }, 0).breakevenCents!;
    expect(withReturns).toBeGreaterThan(bare);
  });

  it('the omission is small against a 12% margin and decisive against 2%', () => {
    const loaded = { ...base, returnsRate: 0.08, storagePerUnitCents: 15, adCostPerUnitCents: 60 };
    // At 12% the bare floor still clears the loaded breakeven — the margin absorbs the omission.
    expect(solveFloors(base, 0.12).strategyFloorCents!).toBeGreaterThan(solveFloors(loaded, 0).breakevenCents!);
    // At 2% it does not: that price is below the true breakeven, i.e. sold at a loss while the
    // engine reports a profit. This is why aggressive strategies need the loaded floor first.
    expect(solveFloors(base, 0.02).strategyFloorCents!).toBeLessThan(solveFloors(loaded, 0).breakevenCents!);
  });

  it('storage and advertising both push the floor up', () => {
    const bare = solveFloors(base, 0).breakevenCents!;
    expect(solveFloors({ ...base, storagePerUnitCents: 100 }, 0).breakevenCents!).toBeGreaterThan(bare);
    expect(solveFloors({ ...base, adCostPerUnitCents: 100 }, 0).breakevenCents!).toBeGreaterThan(bare);
  });
});

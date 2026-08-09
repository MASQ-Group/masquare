import { describe, it, expect } from 'vitest';
import { decide, DecideInput } from './decision-core';
import { CompetitorFilters, MarketSnapshot, Offer } from './types';

const FILTERS: CompetitorFilters = {
  minFeedbackPct: 0.9,
  minFeedbackCount: 50,
  maxShippingHours: 96,
  domesticOnly: true,
  blocklistedSellerIds: [],
  amazonRetailSellerIds: ['AMZ_DE'],
};

const ourFba: Offer = { sellerId: 'US', listingPriceCents: 2000, shippingCents: 0, isBuyBoxWinner: false, isFulfilledByAmazon: true };

function comp(sellerId: string, landed: number): Offer {
  return { sellerId, listingPriceCents: landed, shippingCents: 0, isBuyBoxWinner: false, isFulfilledByAmazon: true, feedbackRatingPct: 0.98, feedbackCount: 500, shippingMaxHours: 48, shipsDomestic: true, subCondition: 'new' };
}

/** A worse-delivery (FBM, 2–3 day) competitor — we out-deliver it, so the matrix prices us above. */
function compFbm(sellerId: string, landed: number): Offer {
  return { ...comp(sellerId, landed), isFulfilledByAmazon: false, isPrime: false, shippingMaxHours: 48 };
}

function baseInput(offers: Offer[], overrides: Partial<DecideInput> = {}): DecideInput {
  const snapshot: MarketSnapshot = {
    asin: 'B0T',
    marketplaceId: 'A1PA6795UKMFR9',
    timeOfOfferChange: '2026-08-01T00:00:00Z',
    ourSellerId: 'US',
    ourSubCondition: 'new',
    offers,
    buyBoxLandedCents: 2000,
  };
  return {
    snapshot,
    ourOffer: ourFba,
    strategy: 'BUY_BOX',
    automationState: 'SHADOW',
    filters: FILTERS,
    bounds: { breakevenCents: 1500, strategyFloorCents: 1750, maxPriceCents: 3000 },
    clampBounds: { strategyFloorCents: 1750, breakevenCents: 1500, maxPriceCents: 3000, fairPricingCeilingCents: 2800 },
    state: { currentPriceLandedCents: 2000, holdingBuyBox: false, probeAnchorCents: null },
    targetParams: { fbmPremiumPct: 0.03, fbmUndercutPct: 0.05, beatByCents: 2, probeStepPct: 0.01, amazonRetailWaitPremiumPct: 0.02, maxUpStepPct: 0.1 },
    emitParams: { epsilonCents: 10, epsilonPct: 0.005, cooldownSeconds: 300 },
    lastSubmissionAtMs: null,
    nowMs: 1_000_000_000_000,
    ...overrides,
  };
}

describe('decide — end to end', () => {
  it('SKIPPED for an EXCLUDED SKU', () => {
    const d = decide(baseInput([comp('C1', 1900)], { automationState: 'EXCLUDED' }));
    expect(d.outcome).toBe('SKIPPED');
  });

  it('SKIPPED for MANUAL_ONLY (evaluate but never write)', () => {
    const d = decide(baseInput([comp('C1', 1900)], { strategy: 'MANUAL_ONLY' }));
    expect(d.outcome).toBe('SKIPPED');
  });

  it('PRICED on a contested listing, target within floor/ceiling', () => {
    // We out-deliver an FBM competitor → +3% above Buy Box 2000 = 2060, a real (> epsilon) move.
    const d = decide(baseInput([compFbm('C1', 1950)]));
    expect(d.outcome).toBe('PRICED');
    expect(d.branch).toBe('C_CONTESTED');
    expect(d.finalPriceCents).toBe(2060);
    expect(d.finalPriceCents!).toBeGreaterThanOrEqual(1750);
    expect(d.finalPriceCents!).toBeLessThanOrEqual(2800);
  });

  it('never lets a decision breach the strategy floor even when the raw target is far lower', () => {
    // A cheap Buy Box (1700) below our strategy floor (1750): the raw competitive target undershoots,
    // but the clamp chain lifts the final price back to the floor. Never below breakeven, ever.
    const input = baseInput([comp('C1', 1700)]);
    input.snapshot.buyBoxLandedCents = 1700;
    const d = decide(input);
    expect(d.rawTargetCents!).toBeLessThan(1750);
    expect(d.finalPriceCents!).toBeGreaterThanOrEqual(1750);
  });

  it('QUARANTINED when the strategy floor exceeds a ceiling', () => {
    const d = decide(
      baseInput([comp('C1', 1950)], {
        clampBounds: { strategyFloorCents: 3000, breakevenCents: 1500, fairPricingCeilingCents: 2500 },
      }),
    );
    expect(d.outcome).toBe('QUARANTINED');
  });

  it('HELD (epsilon) when the target barely moves', () => {
    // Holding the Buy Box with no competitor → probe up 1% = 2020, but set epsilon high to force skip.
    const d = decide(
      baseInput([comp('C1', 2100)], {
        state: { currentPriceLandedCents: 2000, holdingBuyBox: true, probeAnchorCents: 2000 },
        emitParams: { epsilonCents: 100, epsilonPct: 0.005, cooldownSeconds: 300 },
      }),
    );
    expect(d.outcome).toBe('HELD');
    expect(d.reason).toMatch(/EPSILON/);
  });

  it('HELD (cooldown) when inside the cooldown window', () => {
    // A > epsilon move (2060) that would otherwise price, blocked by the 300s cooldown.
    const d = decide(
      baseInput([compFbm('C1', 1950)], {
        lastSubmissionAtMs: 1_000_000_000_000 - 100_000, // 100s ago < 300s
      }),
    );
    expect(d.outcome).toBe('HELD');
    expect(d.reason).toMatch(/COOLDOWN/);
  });

  it('records the branch and full competitor set for the audit trail', () => {
    const d = decide(baseInput([comp('C1', 1950), comp('AMZ_DE', 2100)]));
    expect(d.branch).toBe('B_AMAZON');
    expect(d.competitorSet?.amazonRetailPresent).toBe(true);
  });

  it('derives competitorSetShrank (§5.4 C-1: 2× probe step) when the set is smaller than before', () => {
    // Holding the Buy Box at 2000, one competitor left in the set (at 2100, above us so we keep it).
    // Previous evaluation had 2 competitors → the set shrank → probe at 2× the 1% step (2040 not 2020).
    const shrank = decide(
      baseInput([comp('C1', 2100)], {
        state: { currentPriceLandedCents: 2000, holdingBuyBox: true, probeAnchorCents: 2000, prevCompetitorCount: 2 },
      }),
    );
    expect(shrank.outcome).toBe('PRICED');
    expect(shrank.reason).toContain('set shrank');
    expect(shrank.finalPriceCents).toBe(2040);

    // Same picture but the previous count matches the current one → normal 1% step (2020).
    const steady = decide(
      baseInput([comp('C1', 2100)], {
        state: { currentPriceLandedCents: 2000, holdingBuyBox: true, probeAnchorCents: 2000, prevCompetitorCount: 1 },
      }),
    );
    expect(steady.reason).not.toContain('set shrank');
    expect(steady.finalPriceCents).toBe(2020);
  });
});

import { describe, it, expect } from 'vitest';
import { Bounds, EngineState, TargetParams, computeRawTarget } from './target';
import { CompetitorSet, MarketSnapshot, Offer } from './types';

const PARAMS: TargetParams = {
  fbmPremiumPct: 0.03,
  fbmUndercutPct: 0.05,
  beatByCents: 2,
  probeStepPct: 0.01,
  amazonRetailWaitPremiumPct: 0.02,
  maxUpStepPct: 0.1,
};

const BOUNDS: Bounds = { breakevenCents: 1500, strategyFloorCents: 1750, maxPriceCents: 3000 };

const ourFba: Offer = { sellerId: 'US', listingPriceCents: 2000, shippingCents: 0, isBuyBoxWinner: false, isFulfilledByAmazon: true };

function comp(sellerId: string, landed: number, fba = true): Offer {
  return { sellerId, listingPriceCents: landed, shippingCents: 0, isBuyBoxWinner: false, isFulfilledByAmazon: fba };
}

function set(effective: Offer[], buyBoxLandedCents: number | null = null): CompetitorSet {
  return {
    effective: [...effective].sort((a, b) => a.listingPriceCents - b.listingPriceCents),
    dropped: [],
    amazonRetailPresent: false,
    runnerUpLandedCents: effective.length ? Math.min(...effective.map((o) => o.listingPriceCents)) : null,
    buyBoxLandedCents,
  };
}

const snap: MarketSnapshot = {
  asin: 'B0T',
  marketplaceId: 'A1PA6795UKMFR9',
  timeOfOfferChange: '2026-08-01T00:00:00Z',
  ourSellerId: 'US',
  ourSubCondition: 'new',
  offers: [],
};

const idle: EngineState = { currentPriceLandedCents: 2000, holdingBuyBox: false, probeAnchorCents: null };

describe('computeRawTarget — Branch C contested', () => {
  it('C-2 anchors on FOEP when fresh and sane', () => {
    const out = computeRawTarget('C_CONTESTED', 'BUY_BOX', snap, set([comp('C1', 1950)], 2000), ourFba, idle, BOUNDS, PARAMS, {
      foepLandedCents: 1980,
    });
    expect(out.targetCents).toBe(1980);
    expect(out.reason).toMatch(/FOEP/);
  });

  it('C-2 rejects an insane FOEP (below breakeven) and falls through to the Buy Box × matrix', () => {
    const out = computeRawTarget('C_CONTESTED', 'BUY_BOX', snap, set([comp('C1', 1950)], 2000), ourFba, idle, BOUNDS, PARAMS, {
      foepLandedCents: 1400, // < breakeven 1500
    });
    // equal tier (both FBA) → match Buy Box landed 2000, shave 2c
    expect(out.targetCents).toBe(1998);
    expect(out.reason).toMatch(/matrix/);
  });

  it('C-1 probes up while holding the Buy Box, never below current, bounded by the runner-up threat', () => {
    const holding: EngineState = { currentPriceLandedCents: 2000, holdingBuyBox: true, probeAnchorCents: 2000 };
    const out = computeRawTarget('C_CONTESTED', 'BUY_BOX', snap, set([comp('C1', 2100)]), ourFba, holding, BOUNDS, PARAMS);
    expect(out.targetCents).toBeGreaterThanOrEqual(2000); // never lowers
    expect(out.targetCents).toBeLessThanOrEqual(2100); // capped by runner-up threat (equal tier, 0 premium)
    expect(out.newProbeAnchorCents).toBe(2000);
  });

  it('C-1 probes at 2× step when the competitor set shrank', () => {
    const holding: EngineState = { currentPriceLandedCents: 2000, holdingBuyBox: true, probeAnchorCents: 2000, competitorSetShrank: true };
    const out = computeRawTarget('C_CONTESTED', 'BUY_BOX', snap, set([comp('C1', 2500)]), ourFba, holding, BOUNDS, PARAMS);
    expect(out.targetCents).toBe(2040); // +2% (2× the 1% step)
  });

  it('C-5 holds (no target) when the undercut-loop guard has tripped', () => {
    const holding: EngineState = { currentPriceLandedCents: 2000, holdingBuyBox: true, probeAnchorCents: 2000, holdForLoop: true };
    const out = computeRawTarget('C_CONTESTED', 'BUY_BOX', snap, set([comp('C1', 1900)]), ourFba, holding, BOUNDS, PARAMS);
    expect(out.targetCents).toBeNull();
    expect(out.reason).toMatch(/undercut-loop/);
  });

  it('C-3 LOWEST_PRICE matches the lowest competitor landed', () => {
    const out = computeRawTarget('C_CONTESTED', 'LOWEST_PRICE', snap, set([comp('C1', 1900), comp('C2', 1950)]), ourFba, idle, BOUNDS, PARAMS);
    expect(out.targetCents).toBe(1898);
  });
});

describe('computeRawTarget — Branches A/B/D', () => {
  it('Branch B holds a wait price above Amazon Retail landed', () => {
    const out = computeRawTarget('B_AMAZON', 'BUY_BOX', snap, set([]), ourFba, idle, BOUNDS, PARAMS, { amazonRetailLandedCents: 2000 });
    expect(out.targetCents).toBe(2040); // +2%
  });

  it('Branch D prices under the reference constraint when profitable', () => {
    const out = computeRawTarget('D_RESTORE', 'BUY_BOX', snap, set([]), ourFba, idle, BOUNDS, PARAMS, { restoreReferenceLandedCents: 1900 });
    expect(out.targetCents).toBe(1900);
  });

  it('Branch D parks at floor and ALERTS when the reference is below breakeven', () => {
    const out = computeRawTarget('D_RESTORE', 'BUY_BOX', snap, set([]), ourFba, idle, BOUNDS, PARAMS, { restoreReferenceLandedCents: 1400 });
    expect(out.targetCents).toBe(1750); // strategy floor
    expect(out.alert).toBe(true);
  });

  it('Branch A raises when trailing velocity is above target', () => {
    const out = computeRawTarget('A_SOLE', 'VELOCITY', snap, set([]), ourFba, idle, BOUNDS, PARAMS, { velocity: { trailing: 100, target: 80 } });
    expect(out.targetCents).toBe(2020); // +1%
  });

  it('Branch A holds when there is no velocity signal', () => {
    const out = computeRawTarget('A_SOLE', 'VELOCITY', snap, set([]), ourFba, idle, BOUNDS, PARAMS, {});
    expect(out.targetCents).toBeNull();
  });
});

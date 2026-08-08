import { describe, it, expect } from 'vitest';
import { buildDecideInput, RepricerConfig } from './mapping';
import { decide } from './decision-core';
import { MarketSnapshot, Offer } from './types';

function cfg(overrides: Partial<RepricerConfig> = {}): RepricerConfig {
  return {
    sku: 'SKU1',
    asin: 'B0T',
    marketplaceId: 'A1PA6795UKMFR9',
    currency: 'EUR',
    fulfillment: 'FBA',
    strategy: 'BUY_BOX',
    automationState: 'SHADOW',
    breakevenCents: 1500,
    strategyFloorCents: 1750,
    maxPriceCents: 3000,
    mapCents: null,
    fairPricingCeilingCents: 2800,
    amazonMinAllowedCents: 1400,
    amazonMaxAllowedCents: 3200,
    currentPriceCents: 2000,
    holdingBuyBox: false,
    probeAnchorCents: null,
    lastSubmissionAtMs: null,
    epsilonCents: null,
    cooldownSeconds: null,
    probeStepPct: null,
    fbmPremiumPct: null,
    ...overrides,
  };
}

function snap(offers: Offer[]): MarketSnapshot {
  return {
    asin: 'B0T',
    marketplaceId: 'A1PA6795UKMFR9',
    timeOfOfferChange: '2026-08-01T00:00:00Z',
    ourSellerId: 'US',
    ourSubCondition: 'new',
    offers,
    buyBoxLandedCents: 2000,
  };
}

const comp: Offer = { sellerId: 'C1', listingPriceCents: 1950, shippingCents: 0, isBuyBoxWinner: false, isFulfilledByAmazon: true, feedbackRatingPct: 0.98, feedbackCount: 500, shippingMaxHours: 48, shipsDomestic: true, subCondition: 'new' };

const OPTS = { blocklistedSellerIds: [], amazonRetailSellerIds: [], nowMs: 1_000_000_000_000 };

describe('buildDecideInput', () => {
  it('skips when floors are unknown (never prices without a floor)', () => {
    const out = buildDecideInput(cfg({ breakevenCents: null }), snap([comp]), OPTS);
    expect(out).toEqual({ skip: 'FLOOR_UNKNOWN' });
  });

  it('maps bounds, clamp bounds and state from the config', () => {
    const out = buildDecideInput(cfg(), snap([comp]), OPTS);
    if ('skip' in out) throw new Error('unexpected skip');
    expect(out.bounds).toEqual({ breakevenCents: 1500, strategyFloorCents: 1750, maxPriceCents: 3000 });
    expect(out.clampBounds.fairPricingCeilingCents).toBe(2800);
    expect(out.state.currentPriceLandedCents).toBe(2000);
    expect(out.automationState).toBe('SHADOW');
  });

  it('synthesizes our offer from config when we are not in the snapshot top-20', () => {
    const out = buildDecideInput(cfg({ fulfillment: 'FBA', currentPriceCents: 2000 }), snap([comp]), OPTS);
    if ('skip' in out) throw new Error('unexpected skip');
    expect(out.ourOffer.sellerId).toBe('US');
    expect(out.ourOffer.isFulfilledByAmazon).toBe(true);
    expect(out.ourOffer.listingPriceCents).toBe(2000);
  });

  it('uses our real offer from the snapshot when present', () => {
    const ours: Offer = { sellerId: 'US', listingPriceCents: 1980, shippingCents: 0, isBuyBoxWinner: true, isFulfilledByAmazon: true };
    const out = buildDecideInput(cfg(), snap([ours, comp]), OPTS);
    if ('skip' in out) throw new Error('unexpected skip');
    expect(out.ourOffer.listingPriceCents).toBe(1980);
    expect(out.ourOffer.isBuyBoxWinner).toBe(true);
  });

  it('applies per-SKU overrides over the defaults', () => {
    const out = buildDecideInput(cfg({ epsilonCents: 25, probeStepPct: 0.02, fbmPremiumPct: 0.04 }), snap([comp]), OPTS);
    if ('skip' in out) throw new Error('unexpected skip');
    expect(out.emitParams.epsilonCents).toBe(25);
    expect(out.targetParams.probeStepPct).toBe(0.02);
    expect(out.targetParams.fbmPremiumPct).toBe(0.04);
  });

  it('surfaces Amazon Retail landed price as a signal when present', () => {
    const amz: Offer = { sellerId: 'AMZ', listingPriceCents: 2100, shippingCents: 0, isBuyBoxWinner: false, isFulfilledByAmazon: true };
    const out = buildDecideInput(cfg(), snap([comp, amz]), { ...OPTS, amazonRetailSellerIds: ['AMZ'] });
    if ('skip' in out) throw new Error('unexpected skip');
    expect(out.signals?.amazonRetailLandedCents).toBe(2100);
  });

  it('produces an input that decide() can consume end to end', () => {
    const out = buildDecideInput(cfg(), snap([comp]), OPTS);
    if ('skip' in out) throw new Error('unexpected skip');
    const d = decide(out);
    expect(['PRICED', 'HELD', 'QUARANTINED', 'SKIPPED']).toContain(d.outcome);
    if (d.finalPriceCents != null) expect(d.finalPriceCents).toBeGreaterThanOrEqual(1750);
  });

  it('wires the trailing Buy-Box median into the §6.1 anomalous-competitor guard', () => {
    const out = buildDecideInput(cfg(), snap([comp]), { ...OPTS, medianBuyBoxLandedCents: 2000 });
    if ('skip' in out) throw new Error('unexpected skip');
    expect(out.competitorSetOptions?.medianBuyBoxLandedCents).toBe(2000);
    expect(out.competitorSetOptions?.anomalousFraction).toBe(0.3);
  });

  it('leaves the anomalous-competitor guard off when no median is available', () => {
    const out = buildDecideInput(cfg(), snap([comp]), OPTS);
    if ('skip' in out) throw new Error('unexpected skip');
    expect(out.competitorSetOptions?.medianBuyBoxLandedCents).toBeNull();
  });

  it('threads the undercut-loop hold flag into engine state (§5.4 C-5)', () => {
    const held = buildDecideInput(cfg(), snap([comp]), { ...OPTS, holdForLoop: true });
    if ('skip' in held) throw new Error('unexpected skip');
    expect(held.state.holdForLoop).toBe(true);
    expect(decide(held).outcome).toBe('HELD');

    const normal = buildDecideInput(cfg(), snap([comp]), OPTS);
    if ('skip' in normal) throw new Error('unexpected skip');
    expect(normal.state.holdForLoop).toBe(false);
  });

  it('drops a glitch/hijacker offer (landed < 30% of the median) from the effective set', () => {
    // Legit competitor at 1950, plus a €0.10 hijacker bait. Median Buy Box = 2000 → floor 600c.
    const bait: Offer = { sellerId: 'BAIT', listingPriceCents: 10, shippingCents: 0, isBuyBoxWinner: false, isFulfilledByAmazon: false, feedbackRatingPct: 0.99, feedbackCount: 1000, shippingMaxHours: 24, shipsDomestic: true, subCondition: 'new' };
    const out = buildDecideInput(cfg(), snap([comp, bait]), { ...OPTS, medianBuyBoxLandedCents: 2000 });
    if ('skip' in out) throw new Error('unexpected skip');
    const d = decide(out);
    expect(d.competitorSet?.dropped.some((x) => x.sellerId === 'BAIT' && x.reason === 'ANOMALOUS_PRICE')).toBe(true);
    expect(d.competitorSet?.effective.some((o) => o.sellerId === 'BAIT')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { buildCompetitorSet } from './competitor-set';
import { CompetitorFilters, MarketSnapshot, Offer } from './types';

const FILTERS: CompetitorFilters = {
  minFeedbackPct: 0.9,
  minFeedbackCount: 50,
  maxShippingHours: 96,
  domesticOnly: true,
  blocklistedSellerIds: ['BLOCKED1'],
  amazonRetailSellerIds: ['AMZ_DE'],
};

function offer(overrides: Partial<Offer> & { sellerId: string }): Offer {
  return {
    listingPriceCents: 2000,
    shippingCents: 0,
    isBuyBoxWinner: false,
    isFulfilledByAmazon: true,
    feedbackRatingPct: 0.98,
    feedbackCount: 500,
    shippingMaxHours: 48,
    shipsDomestic: true,
    subCondition: 'new',
    ...overrides,
  };
}

function snapshot(offers: Offer[], overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    asin: 'B0TEST',
    marketplaceId: 'A1PA6795UKMFR9',
    timeOfOfferChange: '2026-08-01T00:00:00Z',
    ourSellerId: 'US',
    ourSubCondition: 'new',
    offers,
    buyBoxLandedCents: 2100,
    ...overrides,
  };
}

describe('buildCompetitorSet', () => {
  it('drops our own offer', () => {
    const set = buildCompetitorSet(snapshot([offer({ sellerId: 'US' }), offer({ sellerId: 'C1' })]), FILTERS);
    expect(set.effective.map((o) => o.sellerId)).toEqual(['C1']);
    expect(set.dropped).toContainEqual({ sellerId: 'US', reason: 'OURS' });
  });

  it('drops blocklisted sellers rather than following them', () => {
    const set = buildCompetitorSet(snapshot([offer({ sellerId: 'BLOCKED1', listingPriceCents: 1 })]), FILTERS);
    expect(set.effective).toHaveLength(0);
    expect(set.dropped).toContainEqual({ sellerId: 'BLOCKED1', reason: 'BLOCKLISTED' });
  });

  it('drops condition mismatches (used competes in a separate Buy Box)', () => {
    const set = buildCompetitorSet(snapshot([offer({ sellerId: 'C1', subCondition: 'used-good' })]), FILTERS);
    expect(set.dropped).toContainEqual({ sellerId: 'C1', reason: 'CONDITION_MISMATCH' });
  });

  it('drops non-domestic shippers when domesticOnly is on', () => {
    const set = buildCompetitorSet(snapshot([offer({ sellerId: 'C1', shipsDomestic: false })]), FILTERS);
    expect(set.dropped).toContainEqual({ sellerId: 'C1', reason: 'NON_DOMESTIC' });
  });

  it('drops low-feedback and slow-shipping offers only when the datum is present', () => {
    const set = buildCompetitorSet(
      snapshot([
        offer({ sellerId: 'LOWPCT', feedbackRatingPct: 0.8 }),
        offer({ sellerId: 'LOWCOUNT', feedbackCount: 10 }),
        offer({ sellerId: 'SLOW', shippingMaxHours: 200 }),
        offer({ sellerId: 'UNKNOWN', feedbackRatingPct: null, feedbackCount: null, shippingMaxHours: null }),
      ]),
      FILTERS,
    );
    const reasons = Object.fromEntries(set.dropped.map((d) => [d.sellerId, d.reason]));
    expect(reasons['LOWPCT']).toBe('LOW_FEEDBACK');
    expect(reasons['LOWCOUNT']).toBe('LOW_FEEDBACK');
    expect(reasons['SLOW']).toBe('SLOW_SHIPPING');
    // Unknown data must NOT drop a potentially-real competitor.
    expect(set.effective.map((o) => o.sellerId)).toContain('UNKNOWN');
  });

  it('never uses IsFeaturedMerchant as a drop filter (post-July-2026 caution)', () => {
    const set = buildCompetitorSet(snapshot([offer({ sellerId: 'C1', isFeaturedMerchant: false })]), FILTERS);
    expect(set.effective.map((o) => o.sellerId)).toEqual(['C1']);
  });

  it('detects Amazon Retail without dropping it, and sorts survivors by landed price', () => {
    const set = buildCompetitorSet(
      snapshot([
        offer({ sellerId: 'AMZ_DE', listingPriceCents: 2500 }),
        offer({ sellerId: 'C2', listingPriceCents: 1900, shippingCents: 100 }), // landed 2000
        offer({ sellerId: 'C1', listingPriceCents: 1800 }), // landed 1800
      ]),
      FILTERS,
    );
    expect(set.amazonRetailPresent).toBe(true);
    expect(set.effective.map((o) => o.sellerId)).toEqual(['C1', 'C2', 'AMZ_DE']);
    expect(set.runnerUpLandedCents).toBe(1800); // lowest landed effective competitor
  });

  it('drops anomalous glitch/hijacker prices below the median-based floor (§6.1)', () => {
    const set = buildCompetitorSet(
      snapshot([offer({ sellerId: 'GLITCH', listingPriceCents: 1 }), offer({ sellerId: 'C1', listingPriceCents: 2000 })]),
      FILTERS,
      { medianBuyBoxLandedCents: 2100, anomalousFraction: 0.3 }, // floor = 630c
    );
    expect(set.dropped).toContainEqual({ sellerId: 'GLITCH', reason: 'ANOMALOUS_PRICE' });
    expect(set.effective.map((o) => o.sellerId)).toEqual(['C1']);
  });

  it('returns an empty effective set with runnerUp null when no competitor survives', () => {
    const set = buildCompetitorSet(snapshot([offer({ sellerId: 'US' })]), FILTERS);
    expect(set.effective).toHaveLength(0);
    expect(set.runnerUpLandedCents).toBeNull();
  });
});

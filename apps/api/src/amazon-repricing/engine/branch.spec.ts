import { describe, it, expect } from 'vitest';
import { classifyBranch } from './branch';
import { CompetitorSet, MarketSnapshot } from './types';

function snap(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    asin: 'B0T',
    marketplaceId: 'A1PA6795UKMFR9',
    timeOfOfferChange: '2026-08-01T00:00:00Z',
    ourSellerId: 'US',
    ourSubCondition: 'new',
    offers: [],
    ...overrides,
  };
}

function set(overrides: Partial<CompetitorSet> = {}): CompetitorSet {
  return {
    effective: [],
    dropped: [],
    amazonRetailPresent: false,
    runnerUpLandedCents: null,
    buyBoxLandedCents: null,
    ...overrides,
  };
}

const anOffer = {
  sellerId: 'C1',
  listingPriceCents: 2000,
  shippingCents: 0,
  isBuyBoxWinner: false,
  isFulfilledByAmazon: true,
};

describe('classifyBranch', () => {
  it('D_RESTORE when suppressed', () => {
    expect(classifyBranch(snap({ suppressed: true }), set({ effective: [anOffer] }))).toBe('D_RESTORE');
  });

  it('D_RESTORE when PRICING_HEALTH fired — overrides sole-seller and Amazon presence', () => {
    expect(
      classifyBranch(snap({ pricingHealthFired: true }), set({ effective: [], amazonRetailPresent: true })),
    ).toBe('D_RESTORE');
  });

  it('A_SOLE when the effective set is empty and not suppressed', () => {
    expect(classifyBranch(snap(), set({ effective: [] }))).toBe('A_SOLE');
  });

  it('B_AMAZON when Amazon Retail is present in a non-empty set', () => {
    expect(classifyBranch(snap(), set({ effective: [anOffer], amazonRetailPresent: true }))).toBe('B_AMAZON');
  });

  it('C_CONTESTED for a normal multi-seller listing', () => {
    expect(classifyBranch(snap(), set({ effective: [anOffer], amazonRetailPresent: false }))).toBe('C_CONTESTED');
  });

  it('priority: suppression beats an empty set', () => {
    expect(classifyBranch(snap({ suppressed: true }), set({ effective: [] }))).toBe('D_RESTORE');
  });
});

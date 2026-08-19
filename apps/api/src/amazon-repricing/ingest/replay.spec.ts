import { describe, expect, it } from 'vitest';
import { parseAnyOfferChanged } from './parser';
import { RawNotificationEnvelope, RawOffer } from './any-offer-changed.types';
import { buildDecideInput, RepricerConfig } from '../engine/mapping';
import { decide } from '../engine/decision-core';

// End-to-end replay (spec §6.5 step 4). A synthetic ANY_OFFER_CHANGED envelope run through the REAL
// parse → map → decide chain, asserting the shadow decision is sane. The units are covered
// elsewhere; this proves they COMPOSE on a realistic §8.2 payload — the integration risk — with no
// DB or timers. Stand this alongside the stored Phase-0 corpus once live payloads are captured.

const OUR = 'A1OURSELLER';
const DE = 'A1PA6795UKMFR9';

function ourOffer(landed = 20.0): RawOffer {
  return {
    SellerId: OUR, SubCondition: 'New',
    ListingPrice: { Amount: landed, CurrencyCode: 'EUR' }, Shipping: { Amount: 0, CurrencyCode: 'EUR' },
    IsFulfilledByAmazon: true, IsBuyBoxWinner: false, PrimeInformation: { IsPrime: true },
    SellerFeedbackRating: { SellerPositiveFeedbackRating: 99, FeedbackCount: 1000 },
    ShippingTime: { maximumHours: 24 }, ShipsFrom: { Country: 'DE' },
  };
}

function competitor(sellerId: string, landed: number, fba = false): RawOffer {
  return {
    SellerId: sellerId, SubCondition: 'New',
    ListingPrice: { Amount: landed, CurrencyCode: 'EUR' }, Shipping: { Amount: 0, CurrencyCode: 'EUR' },
    IsFulfilledByAmazon: fba, PrimeInformation: { IsPrime: fba },
    SellerFeedbackRating: { SellerPositiveFeedbackRating: 98, FeedbackCount: 500 },
    ShippingTime: { maximumHours: 48 }, ShipsFrom: { Country: 'DE' },
  };
}

function envelope(offers: RawOffer[], opts: { buyBox?: number; notificationId?: string } = {}): RawNotificationEnvelope {
  return {
    NotificationType: 'ANY_OFFER_CHANGED',
    EventTime: '2026-08-09T10:00:00Z',
    Payload: {
      AnyOfferChangedNotification: {
        SellerId: OUR,
        OfferChangeTrigger: { MarketplaceId: DE, ASIN: 'B0EXAMPLE', ItemCondition: 'New', TimeOfOfferChange: '2026-08-09T10:00:00Z', OfferChangeType: 'External' },
        Summary: { BuyBoxPrices: [{ Condition: 'New', LandedPrice: { Amount: opts.buyBox ?? 20.0, CurrencyCode: 'EUR' } }], TotalOfferCount: offers.length },
        Offers: offers,
      },
    },
    NotificationMetadata: { NotificationId: opts.notificationId ?? 'notif-1', PublishTime: '2026-08-09T10:00:01Z' },
  };
}

function cfg(overrides: Partial<RepricerConfig> = {}): RepricerConfig {
  return {
    sku: 'SKU-1', asin: 'B0EXAMPLE', marketplaceId: DE, currency: 'EUR',
    fulfillment: 'FBA', strategy: 'BUY_BOX', automationState: 'SHADOW',
    breakevenCents: 1500, strategyFloorCents: 1750, maxPriceCents: 3000, mapCents: null,
    fairPricingCeilingCents: 2800, amazonMinAllowedCents: 1400, amazonMaxAllowedCents: 3200,
    currentPriceCents: 2000, holdingBuyBox: false, probeAnchorCents: null, lastSubmissionAtMs: null,
    epsilonCents: null, cooldownSeconds: null, probeStepPct: null, fbmPremiumPct: null,
    ...overrides,
  };
}

const OPTS = { blocklistedSellerIds: [], amazonRetailSellerIds: [], nowMs: Date.parse('2026-08-09T10:00:05Z') };

describe('replay — ANY_OFFER_CHANGED end to end (parse → map → decide)', () => {
  it('parses a realistic envelope into a snapshot the engine prices within bounds', () => {
    const parsed = parseAnyOfferChanged(envelope([ourOffer(20), competitor('C1', 19.5)]));
    expect(parsed.asin).toBe('B0EXAMPLE');
    expect(parsed.marketplaceId).toBe(DE);
    expect(parsed.snapshot.ourSellerId).toBe(OUR);
    expect(parsed.snapshot.offers).toHaveLength(2);
    expect(parsed.snapshot.buyBoxLandedCents).toBe(2000);

    const built = buildDecideInput(cfg(), parsed.snapshot, OPTS);
    if ('skip' in built) throw new Error('unexpected skip');
    const d = decide(built);
    expect(['PRICED', 'HELD', 'QUARANTINED', 'SKIPPED']).toContain(d.outcome);
    expect(d.branch).toBe('C_CONTESTED');
    if (d.finalPriceCents != null) {
      expect(d.finalPriceCents).toBeGreaterThanOrEqual(1750); // never below the strategy floor
      expect(d.finalPriceCents).toBeLessThanOrEqual(3000); // never above the business max
    }
  });

  it('never breaches the strategy floor even when the market is cheap', () => {
    const parsed = parseAnyOfferChanged(envelope([ourOffer(20), competitor('C1', 16.0)], { buyBox: 16.0 }));
    const built = buildDecideInput(cfg(), parsed.snapshot, OPTS);
    if ('skip' in built) throw new Error('unexpected skip');
    const d = decide(built);
    expect(d.finalPriceCents == null || d.finalPriceCents >= 1750).toBe(true);
  });

  it('drops a €0.10 glitch/hijacker offer via the §6.1 guard when a reference median is present', () => {
    const parsed = parseAnyOfferChanged(envelope([ourOffer(20), competitor('C1', 19.5), competitor('BAIT', 0.1)]));
    const built = buildDecideInput(cfg(), parsed.snapshot, { ...OPTS, medianBuyBoxLandedCents: 2000 });
    if ('skip' in built) throw new Error('unexpected skip');
    const d = decide(built);
    expect(d.competitorSet?.dropped.some((x) => x.sellerId === 'BAIT' && x.reason === 'ANOMALOUS_PRICE')).toBe(true);
    expect(d.competitorSet?.effective.some((o) => o.sellerId === 'BAIT')).toBe(false);
  });

  it('an EXCLUDED SKU is skipped without pricing (safety over automation)', () => {
    const parsed = parseAnyOfferChanged(envelope([ourOffer(20), competitor('C1', 19.5)]));
    const built = buildDecideInput(cfg({ automationState: 'EXCLUDED' }), parsed.snapshot, OPTS);
    if ('skip' in built) throw new Error('unexpected skip');
    expect(decide(built).outcome).toBe('SKIPPED');
  });

  it('a missing marketplace/ASIN/seller throws a ParseError rather than a bad snapshot', () => {
    const bad = envelope([ourOffer(20)]);
    delete bad.Payload!.AnyOfferChangedNotification!.OfferChangeTrigger!.ASIN;
    expect(() => parseAnyOfferChanged(bad)).toThrow(/ASIN/);
  });
});

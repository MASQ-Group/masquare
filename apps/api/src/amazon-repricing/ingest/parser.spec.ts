import { describe, it, expect } from 'vitest';
import { ParseError, isStaleEvent, moneyToCents, parseAnyOfferChanged, parseFeePromotion, parsePricingHealth } from './parser';
import { RawNotificationEnvelope } from './any-offer-changed.types';

// A representative ANY_OFFER_CHANGED envelope for amazon.de (§8.2). Amazon money is in major units.
function envelope(): RawNotificationEnvelope {
  return {
    NotificationType: 'AnyOfferChanged',
    EventTime: '2026-08-01T09:13:40Z',
    Payload: {
      AnyOfferChangedNotification: {
        SellerId: 'US_SELLER',
        OfferChangeTrigger: {
          MarketplaceId: 'A1PA6795UKMFR9', // DE
          ASIN: 'B0EXAMPLE',
          ItemCondition: 'New',
          TimeOfOfferChange: '2026-08-01T09:13:40Z',
          OfferChangeType: 'FeaturedOffer',
        },
        Summary: {
          BuyBoxPrices: [{ Condition: 'New', LandedPrice: { Amount: 21.0, CurrencyCode: 'EUR' } }],
          NumberOfOffers: [{ Condition: 'new', FulfillmentChannel: 'Amazon', OfferCount: 3 }],
        },
        Offers: [
          {
            SellerId: 'US_SELLER',
            SubCondition: 'new',
            ListingPrice: { Amount: 20.99, CurrencyCode: 'EUR' },
            Shipping: { Amount: 0, CurrencyCode: 'EUR' },
            IsFulfilledByAmazon: true,
            IsBuyBoxWinner: true,
            IsFeaturedMerchant: true,
            SellerFeedbackRating: { SellerPositiveFeedbackRating: 99, FeedbackCount: 1200 },
            ShippingTime: { minimumHours: 0, maximumHours: 24 },
            ShipsFrom: { Country: 'DE' },
            PrimeInformation: { IsPrime: true },
          },
          {
            SellerId: 'COMP_FBM',
            SubCondition: 'new',
            ListingPrice: { Amount: 19.5, CurrencyCode: 'EUR' },
            Shipping: { Amount: 3.99, CurrencyCode: 'EUR' },
            IsFulfilledByAmazon: false,
            IsBuyBoxWinner: false,
            IsFeaturedMerchant: false,
            SellerFeedbackRating: { SellerPositiveFeedbackRating: 92, FeedbackCount: 80 },
            ShippingTime: { minimumHours: 24, maximumHours: 72 },
            ShipsFrom: { Country: 'FR' },
          },
        ],
      },
    },
    NotificationMetadata: {
      NotificationId: 'notif-123',
      PublishTime: '2026-08-01T09:13:45Z',
    },
  };
}

describe('moneyToCents', () => {
  it('converts major units to integer cents', () => {
    expect(moneyToCents({ Amount: 20.99, CurrencyCode: 'EUR' })).toBe(2099);
    expect(moneyToCents({ Amount: 0, CurrencyCode: 'EUR' })).toBe(0);
  });
  it('returns null for missing/invalid amounts', () => {
    expect(moneyToCents(undefined)).toBeNull();
    expect(moneyToCents({ CurrencyCode: 'EUR' })).toBeNull();
  });
});

describe('parseAnyOfferChanged', () => {
  it('extracts metadata and identifiers', () => {
    const p = parseAnyOfferChanged(envelope());
    expect(p.notificationId).toBe('notif-123');
    expect(p.marketplaceId).toBe('A1PA6795UKMFR9');
    expect(p.asin).toBe('B0EXAMPLE');
    expect(p.snapshot.ourSellerId).toBe('US_SELLER');
    expect(p.snapshot.ourSubCondition).toBe('new');
    expect(p.timeOfOfferChange).toBe('2026-08-01T09:13:40Z');
  });

  it('maps our FBA offer: landed cents, prime, domestic, feedback fraction', () => {
    const us = parseAnyOfferChanged(envelope()).snapshot.offers.find((o) => o.sellerId === 'US_SELLER')!;
    expect(us.listingPriceCents).toBe(2099);
    expect(us.shippingCents).toBe(0);
    expect(us.isFulfilledByAmazon).toBe(true);
    expect(us.isPrime).toBe(true);
    expect(us.shipsDomestic).toBe(true); // ships from DE, marketplace DE
    expect(us.feedbackRatingPct).toBeCloseTo(0.99, 5); // 99% → 0.99
    expect(us.feedbackCount).toBe(1200);
  });

  it('computes landed = listing + shipping for the FBM competitor and flags it non-domestic', () => {
    const fbm = parseAnyOfferChanged(envelope()).snapshot.offers.find((o) => o.sellerId === 'COMP_FBM')!;
    expect(fbm.listingPriceCents).toBe(1950);
    expect(fbm.shippingCents).toBe(399);
    expect(fbm.shipsDomestic).toBe(false); // ships from FR into DE
    expect(fbm.isFeaturedMerchant).toBe(false); // preserved as a soft signal
  });

  it('extracts the Buy Box landed price for our condition', () => {
    expect(parseAnyOfferChanged(envelope()).snapshot.buyBoxLandedCents).toBe(2100);
  });

  it('prefers an explicit LandedPrice over listing+shipping when present', () => {
    const env = envelope();
    env.Payload!.AnyOfferChangedNotification!.Summary!.BuyBoxPrices = [
      { Condition: 'New', ListingPrice: { Amount: 20 }, Shipping: { Amount: 5 }, LandedPrice: { Amount: 22 } },
    ];
    expect(parseAnyOfferChanged(env).snapshot.buyBoxLandedCents).toBe(2200); // explicit 22.00, not 25.00
  });

  it('degrades missing optional offer fields to null/defaults without throwing', () => {
    const env = envelope();
    env.Payload!.AnyOfferChangedNotification!.Offers = [{ SellerId: 'BARE' }];
    const bare = parseAnyOfferChanged(env).snapshot.offers[0];
    expect(bare.listingPriceCents).toBe(0);
    expect(bare.feedbackRatingPct).toBeNull();
    expect(bare.shippingMaxHours).toBeNull();
    expect(bare.shipsDomestic).toBeNull(); // no ShipsFrom → unknown
  });

  it.each([
    ['MarketplaceId', (e: RawNotificationEnvelope) => delete e.Payload!.AnyOfferChangedNotification!.OfferChangeTrigger!.MarketplaceId],
    ['ASIN', (e: RawNotificationEnvelope) => delete e.Payload!.AnyOfferChangedNotification!.OfferChangeTrigger!.ASIN],
    ['SellerId', (e: RawNotificationEnvelope) => delete e.Payload!.AnyOfferChangedNotification!.SellerId],
  ])('throws ParseError when %s is missing', (_label, mutate) => {
    const env = envelope();
    mutate(env);
    expect(() => parseAnyOfferChanged(env)).toThrow(ParseError);
  });

  it('handles an empty Offers array (all competitors filtered upstream)', () => {
    const env = envelope();
    env.Payload!.AnyOfferChangedNotification!.Offers = [];
    expect(parseAnyOfferChanged(env).snapshot.offers).toHaveLength(0);
  });
});

describe('parsePricingHealth (defensive, TO VERIFY schema)', () => {
  it('extracts marketplace/asin/sku and the notification id', () => {
    const env = {
      NotificationType: 'PricingHealth',
      Payload: { PricingHealthNotification: { MarketplaceId: 'A1PA6795UKMFR9', ASIN: 'B0X', SellerSKU: 'SKU1' } },
      NotificationMetadata: { NotificationId: 'ph-1' },
    };
    expect(parsePricingHealth(env)).toEqual({ notificationId: 'ph-1', marketplaceId: 'A1PA6795UKMFR9', asin: 'B0X', sku: 'SKU1' });
  });

  it('reads identifiers from an OfferChangeTrigger sub-object too', () => {
    const env = { Payload: { PricingHealthNotification: { OfferChangeTrigger: { MarketplaceId: 'A13V1IB3VIYZZH', ASIN: 'B0Y' } } }, NotificationMetadata: {} };
    const p = parsePricingHealth(env);
    expect(p.marketplaceId).toBe('A13V1IB3VIYZZH');
    expect(p.asin).toBe('B0Y');
  });

  it('degrades to nulls on an unexpected shape', () => {
    expect(parsePricingHealth({})).toEqual({ notificationId: null, marketplaceId: null, asin: null, sku: null });
  });
});

describe('parseFeePromotion (defensive, TO VERIFY schema)', () => {
  it('extracts the marketplace and notification id', () => {
    const env = { Payload: { FeePromotionNotification: { MarketplaceId: 'A1RKKUPIHCS9HS' } }, NotificationMetadata: { NotificationId: 'fp-1' } };
    expect(parseFeePromotion(env)).toEqual({ notificationId: 'fp-1', marketplaceId: 'A1RKKUPIHCS9HS' });
  });
});

describe('isStaleEvent', () => {
  it('discards an event not newer than the stored snapshot', () => {
    expect(isStaleEvent('2026-08-01T09:00:00Z', '2026-08-01T09:00:00Z')).toBe(true); // equal → stale
    expect(isStaleEvent('2026-08-01T08:59:59Z', '2026-08-01T09:00:00Z')).toBe(true); // older → stale
  });
  it('keeps a newer event', () => {
    expect(isStaleEvent('2026-08-01T09:00:01Z', '2026-08-01T09:00:00Z')).toBe(false);
  });
  it('keeps the first event when nothing is stored', () => {
    expect(isStaleEvent('2026-08-01T09:00:00Z', null)).toBe(false);
  });
});

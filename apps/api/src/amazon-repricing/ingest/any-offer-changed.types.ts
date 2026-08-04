// Raw shape of an ANY_OFFER_CHANGED notification as delivered over SQS (spec §8.2). This is a
// DEFENSIVE, partial view — every field is optional because payloads vary and we never trust the
// wire shape. The parser (parser.ts) maps this onto the engine's normalized MarketSnapshot.
//
// `TO VERIFY` in Phase 0/2 against the official AnyOfferChangedNotification.json schema and live
// EU payloads: the semantics of IsFeaturedMerchant and TotalBuyBoxEligibleOffers post-July-2026.

/** A money amount as Amazon sends it: major units (e.g. 19.99) + currency. */
export interface RawMoney {
  Amount?: number;
  CurrencyCode?: string;
}

export interface RawPrice {
  Condition?: string;
  FulfillmentChannel?: string; // "Amazon" (FBA) | "Merchant" (FBM)
  LandedPrice?: RawMoney;
  ListingPrice?: RawMoney;
  Shipping?: RawMoney;
}

export interface RawSummary {
  NumberOfOffers?: Array<{ Condition?: string; FulfillmentChannel?: string; OfferCount?: number }>;
  LowestPrices?: RawPrice[];
  BuyBoxPrices?: RawPrice[];
  ListPrice?: RawMoney;
  TotalOfferCount?: number;
  TotalBuyBoxEligibleOffers?: number; // semantics TO VERIFY post-rank-only
  OffersAvailableTime?: string;
}

export interface RawOffer {
  SellerId?: string;
  SubCondition?: string;
  SellerFeedbackRating?: { SellerPositiveFeedbackRating?: number; FeedbackCount?: number };
  ShippingTime?: { minimumHours?: number; maximumHours?: number; availabilityType?: string };
  ListingPrice?: RawMoney;
  Shipping?: RawMoney;
  ShipsFrom?: { Country?: string; State?: string };
  IsFulfilledByAmazon?: boolean;
  IsBuyBoxWinner?: boolean;
  IsFeaturedMerchant?: boolean;
  PrimeInformation?: { IsPrime?: boolean; IsNationalPrime?: boolean };
}

export interface RawOfferChangeTrigger {
  MarketplaceId?: string;
  ASIN?: string;
  ItemCondition?: string;
  TimeOfOfferChange?: string;
  OfferChangeType?: string; // Internal | External | FeaturedOffer
}

export interface RawAnyOfferChangedNotification {
  SellerId?: string; // OUR seller id
  OfferChangeTrigger?: RawOfferChangeTrigger;
  Summary?: RawSummary;
  Offers?: RawOffer[];
}

/** The full SQS-delivered envelope. NotificationId (for dedupe) lives in the metadata block. */
export interface RawNotificationEnvelope {
  NotificationType?: string;
  EventTime?: string;
  PayloadVersion?: string;
  Payload?: { AnyOfferChangedNotification?: RawAnyOfferChangedNotification };
  NotificationMetadata?: {
    ApplicationId?: string;
    SubscriptionId?: string;
    PublishTime?: string;
    NotificationId?: string;
  };
}

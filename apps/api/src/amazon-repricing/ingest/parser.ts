import { MarketSnapshot, Offer } from '../engine/types';
import { MARKETPLACE_TO_ISO } from '../config/repricing.config';
import {
  RawAnyOfferChangedNotification,
  RawMoney,
  RawNotificationEnvelope,
  RawOffer,
  RawPrice,
} from './any-offer-changed.types';

// Parse an ANY_OFFER_CHANGED envelope (spec §8.2) into the engine's normalized MarketSnapshot plus
// the metadata the ingest pipeline needs (dedupe id, publish/offer-change times). PURE — no I/O —
// so it is exhaustively fixture-tested (parser.spec.ts). Defensive throughout: malformed/missing
// fields degrade to null rather than throwing, EXCEPT the identifiers the pipeline can't work
// without (marketplace, ASIN), which throw a ParseError.

export class ParseError extends Error {}

export interface ParsedNotification {
  notificationId: string | null;
  notificationType: string | null;
  publishTime: string | null;
  marketplaceId: string;
  asin: string;
  timeOfOfferChange: string;
  offerChangeType: string | null;
  snapshot: MarketSnapshot;
  /** Verbatim blocks for persistence to RepricingOfferSnapshot (audit / replay). */
  summaryRaw: unknown;
  offersRaw: unknown;
}

/** Amazon money (major units) → integer cents. Null/absent → null. */
export function moneyToCents(m: RawMoney | undefined | null): number | null {
  if (m?.Amount == null || !Number.isFinite(m.Amount)) return null;
  return Math.round(m.Amount * 100);
}

/** Landed = ListingPrice + Shipping; prefer an explicit LandedPrice when Amazon provides one. */
function landedFromPrice(p: RawPrice | undefined): number | null {
  if (!p) return null;
  const explicit = moneyToCents(p.LandedPrice);
  if (explicit != null) return explicit;
  const listing = moneyToCents(p.ListingPrice);
  const shipping = moneyToCents(p.Shipping) ?? 0;
  return listing == null ? null : listing + shipping;
}

const norm = (c?: string): string => (c ?? '').trim().toLowerCase();

/** Buy Box landed price matching our condition, from Summary.BuyBoxPrices[]. Null if none. */
function buyBoxLandedFor(summary: RawAnyOfferChangedNotification['Summary'], condition: string): number | null {
  const prices = summary?.BuyBoxPrices ?? [];
  const match = prices.find((p) => norm(p.Condition) === condition) ?? prices[0];
  return landedFromPrice(match);
}

function parseOffer(raw: RawOffer, marketplaceIso: string | undefined): Offer {
  const listing = moneyToCents(raw.ListingPrice) ?? 0;
  const shipping = moneyToCents(raw.Shipping) ?? 0;
  const fb = raw.SellerFeedbackRating;
  const shipsFromCountry = raw.ShipsFrom?.Country;
  return {
    sellerId: raw.SellerId ?? '',
    listingPriceCents: listing,
    shippingCents: shipping,
    isBuyBoxWinner: raw.IsBuyBoxWinner ?? false,
    isFulfilledByAmazon: raw.IsFulfilledByAmazon ?? false,
    isFeaturedMerchant: raw.IsFeaturedMerchant, // soft signal only (§5.2)
    // Amazon sends the positive-feedback rating as a percent (98) → fraction (0.98).
    feedbackRatingPct: fb?.SellerPositiveFeedbackRating != null ? fb.SellerPositiveFeedbackRating / 100 : null,
    feedbackCount: fb?.FeedbackCount ?? null,
    shippingMaxHours: raw.ShippingTime?.maximumHours ?? null,
    isPrime: raw.PrimeInformation?.IsPrime ?? false,
    // Domestic iff the offer ships from the marketplace's own country. Unknown → null (never dropped).
    shipsDomestic: shipsFromCountry == null || marketplaceIso == null ? null : shipsFromCountry === marketplaceIso,
    subCondition: raw.SubCondition != null ? norm(raw.SubCondition) : undefined,
  };
}

export function parseAnyOfferChanged(envelope: RawNotificationEnvelope): ParsedNotification {
  const notif = envelope.Payload?.AnyOfferChangedNotification;
  const trigger = notif?.OfferChangeTrigger;
  const marketplaceId = trigger?.MarketplaceId;
  const asin = trigger?.ASIN;
  if (!marketplaceId) throw new ParseError('ANY_OFFER_CHANGED missing MarketplaceId');
  if (!asin) throw new ParseError('ANY_OFFER_CHANGED missing ASIN');
  if (!notif?.SellerId) throw new ParseError('ANY_OFFER_CHANGED missing our SellerId');

  const marketplaceIso = MARKETPLACE_TO_ISO[marketplaceId];
  const ourSubCondition = norm(trigger?.ItemCondition) || 'new';
  const timeOfOfferChange = trigger?.TimeOfOfferChange ?? envelope.EventTime ?? envelope.NotificationMetadata?.PublishTime;
  if (!timeOfOfferChange) throw new ParseError('ANY_OFFER_CHANGED missing TimeOfOfferChange');

  const offers = (notif.Offers ?? []).map((o) => parseOffer(o, marketplaceIso));

  const snapshot: MarketSnapshot = {
    asin,
    marketplaceId,
    timeOfOfferChange,
    ourSellerId: notif.SellerId,
    ourSubCondition,
    offers,
    buyBoxLandedCents: buyBoxLandedFor(notif.Summary, ourSubCondition),
    // Suppression and eligibility loss are NOT carried by ANY_OFFER_CHANGED — they arrive via
    // PRICING_HEALTH and are set by that handler. Default false here.
    suppressed: false,
    pricingHealthFired: false,
  };

  return {
    notificationId: envelope.NotificationMetadata?.NotificationId ?? null,
    notificationType: envelope.NotificationType ?? null,
    publishTime: envelope.NotificationMetadata?.PublishTime ?? null,
    marketplaceId,
    asin,
    timeOfOfferChange,
    offerChangeType: trigger?.OfferChangeType ?? null,
    snapshot,
    summaryRaw: notif.Summary ?? null,
    offersRaw: notif.Offers ?? [],
  };
}

/**
 * Stale-event discard (spec §2.3, §5.7): an event whose TimeOfOfferChange is not newer than the
 * stored snapshot's must be dropped (a redelivered or out-of-order event). Returns true = STALE.
 * Uses lexicographic compare on ISO-8601 strings, which is chronological for well-formed UTC stamps.
 */
export function isStaleEvent(incoming: string, storedTimeOfOfferChange: string | null | undefined): boolean {
  if (!storedTimeOfOfferChange) return false;
  return incoming <= storedTimeOfOfferChange;
}

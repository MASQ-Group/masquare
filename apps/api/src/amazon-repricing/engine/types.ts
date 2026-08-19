// Normalized domain types for the decision engine (spec §5). PURE — no Prisma, no NestJS. The I/O
// shell maps an ANY_OFFER_CHANGED snapshot (§8.2) and a RepricingSkuPricing row onto these, so the
// decision core can be exhaustively table-tested without a DB or live Amazon (spec §6.5).
//
// All money is integer euro cents. All price comparisons are on LANDED price (item + shipping) —
// never sticker price (spec §1.1).

export type Fulfillment = 'FBA' | 'FBM' | 'SFP';
export type Strategy = 'BUY_BOX' | 'LOWEST_PRICE' | 'VELOCITY' | 'MANUAL_ONLY';
export type AutomationState = 'EXCLUDED' | 'SHADOW' | 'LIVE' | 'QUARANTINED' | 'KILLED';
export type Branch = 'A_SOLE' | 'B_AMAZON' | 'C_CONTESTED' | 'D_RESTORE';

/** One competing offer from the snapshot's top-20 Offers[] (§8.2). */
export interface Offer {
  sellerId: string;
  listingPriceCents: number;
  shippingCents: number;
  isBuyBoxWinner: boolean;
  isFulfilledByAmazon: boolean;
  /** Post-July-2026 semantics `TO VERIFY` — treated as a SOFT signal, never a drop filter (§5.2). */
  isFeaturedMerchant?: boolean;
  /** Seller feedback as a fraction (0.96 = 96%). Null = unknown. */
  feedbackRatingPct?: number | null;
  feedbackCount?: number | null;
  /** Promised delivery upper bound in hours (from ShippingTime). Null = unknown. */
  shippingMaxHours?: number | null;
  /** Prime badge — SFP detection (§8.2 PrimeInformation). */
  isPrime?: boolean;
  /** Whether the offer ships domestically within the marketplace. Null = unknown. */
  shipsDomestic?: boolean | null;
  /** Item sub-condition ('new', 'used-verygood', …). Used/refurb compete in a separate Buy Box. */
  subCondition?: string;
}

/** Landed price = item price + shipping — the only price the engine ever compares (§1.1). */
export function landedCents(o: Offer): number {
  return o.listingPriceCents + o.shippingCents;
}

/**
 * Delivery tier for the FBA/FBM adjustment matrix (§5.4 EU note): the premium is earned by
 * DELIVERY OUTCOME, not the FBA badge (EU equal-treatment, §1.4). Higher number = better tier.
 * SFP and a 0-day-handling same-day FBM offer count as the top (FBA) tier.
 */
export function deliveryTier(o: Offer): number {
  if (o.isFulfilledByAmazon || o.isPrime) return 2; // FBA or Prime/SFP → top tier
  if (o.shippingMaxHours != null && o.shippingMaxHours <= 24) return 2; // same/next-day FBM
  if (o.shippingMaxHours != null && o.shippingMaxHours <= 72) return 1; // 2–3 day
  return 0; // slow / unknown
}

/** The market picture for one ASIN × marketplace, normalized from a snapshot. */
export interface MarketSnapshot {
  asin: string;
  marketplaceId: string;
  timeOfOfferChange: string;
  ourSellerId: string;
  ourSubCondition: string;
  offers: Offer[];
  /** Buy Box landed price for our condition/channel (from Summary.BuyBoxPrices[]). Null if none. */
  buyBoxLandedCents?: number | null;
  /** Listing suppressed — "See All Buying Options", no featured offer (§1.5). */
  suppressed?: boolean;
  /** PRICING_HEALTH fired for us — we lost Featured-Offer eligibility (§5.3 Branch D). */
  pricingHealthFired?: boolean;
}

/** Competitor-set filter configuration (§5.2 / §9-#10). */
export interface CompetitorFilters {
  minFeedbackPct: number;
  minFeedbackCount: number;
  maxShippingHours: number;
  domesticOnly: boolean;
  blocklistedSellerIds: string[];
  /** Amazon Retail SellerId(s) for this marketplace — `TO VERIFY` for DE/FR/ES (§5.2). */
  amazonRetailSellerIds: string[];
}

export interface DropReason {
  sellerId: string;
  reason:
    | 'OURS'
    | 'BLOCKLISTED'
    | 'CONDITION_MISMATCH'
    | 'NON_DOMESTIC'
    | 'LOW_FEEDBACK'
    | 'SLOW_SHIPPING'
    | 'ANOMALOUS_PRICE';
}

/** Result of Step 0 — the effective competitor set + market structure signals (§5.2). */
export interface CompetitorSet {
  /** Survivors, sorted by landed price ascending. */
  effective: Offer[];
  /** Every dropped offer with its reason (for the audit record, §6.6). */
  dropped: DropReason[];
  amazonRetailPresent: boolean;
  /** Best (lowest landed) effective competitor — the runner-up threat. Null if set empty. */
  runnerUpLandedCents: number | null;
  buyBoxLandedCents: number | null;
}

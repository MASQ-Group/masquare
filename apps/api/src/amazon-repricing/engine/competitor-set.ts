import {
  CompetitorFilters,
  CompetitorSet,
  DropReason,
  MarketSnapshot,
  Offer,
  landedCents,
} from './types';

// Step 0 — build the effective competitor set (spec §5.2). Drops our own offer, blocklisted
// sellers, condition mismatches, non-domestic shippers, weak-feedback and slow-shipping offers,
// and anomalous (glitch/hijacker-bait) prices. Also surfaces the market-structure signals the
// branch classifier needs: Amazon Retail presence, the Buy Box landed price, and the runner-up.
//
// PURE. IsFeaturedMerchant is deliberately NOT a drop filter (post-July-2026 semantics are
// `TO VERIFY`, §5.2 — soft signal only). Feedback/shipping/domestic filters only fire when the
// datum is PRESENT and below threshold; unknown data never drops a potentially-real competitor.

export interface CompetitorSetOptions {
  /**
   * §6.1 anomalous-competitor guard: drop offers whose landed price is below this fraction of the
   * trailing 7-day median Buy Box landed (the classic €0.01 glitch / hijacker bait). Omit to skip.
   */
  medianBuyBoxLandedCents?: number | null;
  anomalousFraction?: number;
}

export function buildCompetitorSet(
  snapshot: MarketSnapshot,
  filters: CompetitorFilters,
  options: CompetitorSetOptions = {},
): CompetitorSet {
  const blocklist = new Set(filters.blocklistedSellerIds);
  const amazonRetail = new Set(filters.amazonRetailSellerIds);
  const dropped: DropReason[] = [];
  const effective: Offer[] = [];

  const anomalyFloor =
    options.medianBuyBoxLandedCents != null && options.anomalousFraction != null
      ? options.medianBuyBoxLandedCents * options.anomalousFraction
      : null;

  let amazonRetailPresent = false;

  for (const offer of snapshot.offers) {
    // Amazon Retail is detected but NOT dropped — its presence flips us into Branch B (§5.3).
    if (amazonRetail.has(offer.sellerId)) amazonRetailPresent = true;

    const reason = dropReasonFor(offer, snapshot, filters, blocklist, anomalyFloor);
    if (reason) {
      dropped.push({ sellerId: offer.sellerId, reason });
      continue;
    }
    effective.push(offer);
  }

  effective.sort((a, b) => landedCents(a) - landedCents(b));

  return {
    effective,
    dropped,
    amazonRetailPresent,
    runnerUpLandedCents: effective.length ? landedCents(effective[0]) : null,
    buyBoxLandedCents: snapshot.buyBoxLandedCents ?? null,
  };
}

function dropReasonFor(
  offer: Offer,
  snapshot: MarketSnapshot,
  filters: CompetitorFilters,
  blocklist: Set<string>,
  anomalyFloor: number | null,
): DropReason['reason'] | null {
  if (offer.sellerId === snapshot.ourSellerId) return 'OURS';
  if (blocklist.has(offer.sellerId)) return 'BLOCKLISTED';

  // Used/refurb offers compete in a separate Featured Offer — different condition, not a competitor.
  if (offer.subCondition != null && offer.subCondition !== snapshot.ourSubCondition) {
    return 'CONDITION_MISMATCH';
  }

  // Domestic-only: a cross-border offer's delivery promise rarely beats domestic (§5.2 default ON).
  if (filters.domesticOnly && offer.shipsDomestic === false) return 'NON_DOMESTIC';

  // Weak sellers rarely beat a strong offer at a moderate premium — only drop on PRESENT data.
  if (
    (offer.feedbackRatingPct != null && offer.feedbackRatingPct < filters.minFeedbackPct) ||
    (offer.feedbackCount != null && offer.feedbackCount < filters.minFeedbackCount)
  ) {
    return 'LOW_FEEDBACK';
  }

  // Post-2025 weighting: slow offers aren't real Featured-Offer threats.
  if (offer.shippingMaxHours != null && offer.shippingMaxHours > filters.maxShippingHours) {
    return 'SLOW_SHIPPING';
  }

  // §6.1: an offer far below the reference median is a glitch/hijacker — drop and re-run without it.
  if (anomalyFloor != null && landedCents(offer) < anomalyFloor) return 'ANOMALOUS_PRICE';

  return null;
}

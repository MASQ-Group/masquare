import { DecideInput } from './decision-core';
import { AutomationState, MarketSnapshot, Offer, Strategy, landedCents } from './types';
import { REPRICING_DEFAULTS } from '../config/repricing.config';

// Pure translation from a SKU's stored config/state + a normalized snapshot to the engine's
// DecideInput (spec §5.1). Kept separate from repricer.service (the DB I/O) so it is unit-testable
// without Prisma. Percentages arrive here already converted to fractions.

/** The subset of RepricingSkuPricing the engine needs, with Decimals pre-converted to fractions. */
export interface RepricerConfig {
  sku: string;
  asin: string | null;
  marketplaceId: string;
  currency: string;
  fulfillment: string; // FBA | FBM | SFP
  strategy: Strategy;
  automationState: AutomationState;

  breakevenCents: number | null;
  strategyFloorCents: number | null;
  maxPriceCents: number | null;
  mapCents: number | null;
  fairPricingCeilingCents: number | null;
  amazonMinAllowedCents: number | null;
  amazonMaxAllowedCents: number | null;

  currentPriceCents: number | null;
  holdingBuyBox: boolean;
  probeAnchorCents: number | null;
  lastSubmissionAtMs: number | null;

  // Per-SKU overrides as FRACTIONS (null ⇒ strategy-group default).
  epsilonCents: number | null;
  cooldownSeconds: number | null;
  probeStepPct: number | null;
  fbmPremiumPct: number | null;
}

export interface BuildOptions {
  blocklistedSellerIds: string[];
  amazonRetailSellerIds: string[];
  nowMs: number;
  safetyOverride?: boolean;
  /** Trailing 7-day median Buy Box landed for this ASIN × marketplace — the reference the
   *  anomalous-competitor guard (§6.1) drops glitch/hijacker offers against. Null ⇒ guard off. */
  medianBuyBoxLandedCents?: number | null;
  /** §5.4 C-5: a repeat undercutter is looping us → hold current price instead of chasing. */
  holdForLoop?: boolean;
  /** Effective-competitor count at the previous evaluation for this listing (§5.4 C-1). decide()
   *  compares it to the current set to decide whether to probe up faster. Null ⇒ no history. */
  prevCompetitorCount?: number | null;
}

/** A reason the SKU can't be evaluated into a priced decision (still logged as SKIPPED). */
export type BuildSkip = { skip: 'FLOOR_UNKNOWN' };

export function buildDecideInput(
  cfg: RepricerConfig,
  snapshot: MarketSnapshot,
  opts: BuildOptions,
): DecideInput | BuildSkip {
  // Floors are mandatory — the engine never prices without them (floor-service excludes such SKUs,
  // but guard here too so a stale state can't slip a null floor into the clamp chain).
  if (cfg.breakevenCents == null || cfg.strategyFloorCents == null) return { skip: 'FLOOR_UNKNOWN' };

  const D = REPRICING_DEFAULTS;
  const amazonRetail = new Set(opts.amazonRetailSellerIds);

  // Our own offer from the snapshot, or a synthetic one from stored state if we're not in the top-20.
  const ourOffer: Offer =
    snapshot.offers.find((o) => o.sellerId === snapshot.ourSellerId) ?? {
      sellerId: snapshot.ourSellerId,
      listingPriceCents: cfg.currentPriceCents ?? 0,
      shippingCents: 0,
      isBuyBoxWinner: false,
      isFulfilledByAmazon: cfg.fulfillment === 'FBA',
      isPrime: cfg.fulfillment === 'SFP',
      subCondition: snapshot.ourSubCondition,
    };

  // Amazon Retail's landed price (Branch B signal), if present in the snapshot.
  const amazonOffers = snapshot.offers.filter((o) => amazonRetail.has(o.sellerId));
  const amazonRetailLandedCents = amazonOffers.length ? Math.min(...amazonOffers.map(landedCents)) : null;

  return {
    snapshot,
    ourOffer,
    strategy: cfg.strategy,
    automationState: cfg.automationState,
    filters: {
      minFeedbackPct: D.minFeedbackPct,
      minFeedbackCount: D.minFeedbackCount,
      maxShippingHours: D.maxShippingHours,
      domesticOnly: D.domesticOnly,
      blocklistedSellerIds: opts.blocklistedSellerIds,
      amazonRetailSellerIds: opts.amazonRetailSellerIds,
    },
    // §6.1 anomalous-competitor guard: drop offers far below the trailing Buy-Box median (glitch /
    // hijacker bait). No median (new listing, no history) ⇒ the guard is simply off for this eval.
    competitorSetOptions: {
      medianBuyBoxLandedCents: opts.medianBuyBoxLandedCents ?? null,
      anomalousFraction: D.anomalousCompetitorFraction,
    },
    bounds: {
      breakevenCents: cfg.breakevenCents,
      strategyFloorCents: cfg.strategyFloorCents,
      maxPriceCents: cfg.maxPriceCents,
    },
    clampBounds: {
      mapCents: cfg.mapCents,
      strategyFloorCents: cfg.strategyFloorCents,
      breakevenCents: cfg.breakevenCents,
      maxPriceCents: cfg.maxPriceCents,
      fairPricingCeilingCents: cfg.fairPricingCeilingCents,
      amazonMinAllowedCents: cfg.amazonMinAllowedCents,
      amazonMaxAllowedCents: cfg.amazonMaxAllowedCents,
    },
    state: {
      currentPriceLandedCents: cfg.currentPriceCents,
      holdingBuyBox: cfg.holdingBuyBox,
      probeAnchorCents: cfg.probeAnchorCents,
      prevCompetitorCount: opts.prevCompetitorCount ?? null, // §5.4 C-1: decide() derives competitorSetShrank
      holdForLoop: opts.holdForLoop ?? false, // §5.4 C-5 undercut-loop guard (computed in repricer)
    },
    signals: { amazonRetailLandedCents },
    targetParams: {
      fbmPremiumPct: cfg.fbmPremiumPct ?? D.fbmPremiumPct,
      fbmUndercutPct: D.fbmUndercutPct,
      beatByCents: D.beatByCents,
      probeStepPct: cfg.probeStepPct ?? D.probeStepPct,
      amazonRetailWaitPremiumPct: D.amazonRetailWaitPremiumPct,
      maxUpStepPct: D.maxUpStepPct,
    },
    emitParams: {
      epsilonCents: cfg.epsilonCents ?? D.epsilonCents,
      epsilonPct: D.epsilonPct,
      cooldownSeconds: cfg.cooldownSeconds ?? D.cooldownSeconds,
    },
    lastSubmissionAtMs: cfg.lastSubmissionAtMs,
    nowMs: opts.nowMs,
    safetyOverride: opts.safetyOverride,
  };
}

import { Offer, deliveryTier } from './types';

// The FBA/FBM adjustment matrix (spec §5.4). Under EU equal-treatment (§1.4) the premium is earned
// by DELIVERY OUTCOME, not the FBA badge — so the matrix is driven by delivery TIER (deliveryTier),
// where SFP and a same-day FBM offer count as the top tier. PURE.
//
//  Us \ best competitor │ better/equal delivery tier │ worse delivery tier
//  ─────────────────────┼────────────────────────────┼─────────────────────
//  we out-deliver        │            —               │ price ABOVE by fbmPremiumPct
//  equal tier            │ match / beat by beatByCents │        —
//  we under-deliver      │ price BELOW by fbmUndercutPct (only if ≥ floor) │ —

export interface MatrixParams {
  /** Premium we can hold above a WORSE-delivery competitor (§9-#3, default +3%). */
  fbmPremiumPct: number;
  /** How far below a BETTER-delivery competitor we go to compete (§9-#4, default −5%). */
  fbmUndercutPct: number;
  /** When we're at the same tier, match and shade under by this many cents (1–2c). */
  beatByCents: number;
}

/**
 * The fractional offset to apply to a competitor's landed price given our delivery tier vs theirs.
 * Positive = we can sit above them; negative = we must undercut. Same tier ⇒ 0 (match, then shave
 * beatByCents in landedTargetAgainst).
 */
export function matrixOffsetPct(ourTier: number, competitorTier: number, p: MatrixParams): number {
  if (ourTier > competitorTier) return p.fbmPremiumPct; // we out-deliver → charge a premium
  if (ourTier < competitorTier) return -p.fbmUndercutPct; // we under-deliver → undercut
  return 0; // equal tier → match
}

/**
 * Our target LANDED price against one competitor, applying the matrix. At equal tier we match and
 * shave `beatByCents`; otherwise we offset by the matrix percentage. Result is rounded to cents and
 * never negative. Floors/ceilings are enforced later by the clamp chain (§5.5) — this is the raw
 * competitive target only.
 */
export function landedTargetAgainst(
  competitorLandedCents: number,
  ourTier: number,
  competitorTier: number,
  p: MatrixParams,
): number {
  const offset = matrixOffsetPct(ourTier, competitorTier, p);
  if (offset === 0) {
    return Math.max(0, competitorLandedCents - p.beatByCents);
  }
  return Math.max(0, Math.round(competitorLandedCents * (1 + offset)));
}

/** Convenience: our delivery tier for our own offer descriptor. */
export function ourDeliveryTier(offer: Pick<Offer, 'isFulfilledByAmazon' | 'isPrime' | 'shippingMaxHours'>): number {
  return deliveryTier(offer as Offer);
}

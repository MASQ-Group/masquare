// §6.2 Fair-pricing ceiling (suppression avoidance). Raising a price too far above the market's
// recent norm gets our offer SUPPRESSED (no Buy Box, and it silently kills ad delivery — §1.5), so
// we cap the target at `min(maxPrice, referencePrice × multiplier)` where referencePrice is the
// trailing 30-day median Buy Box landed for the ASIN (from our own snapshots). Pure.

/**
 * The default fair-pricing ceiling in landed cents, or null when there's no reference median yet
 * (then only the business max clamps the price). A per-SKU manual override, if set, wins over this.
 */
export function computeFairCeilingCents(
  referenceMedianCents: number | null | undefined,
  maxPriceCents: number | null | undefined,
  multiplier: number,
): number | null {
  if (referenceMedianCents == null) return null;
  const fromReference = Math.round(referenceMedianCents * multiplier);
  return maxPriceCents == null ? fromReference : Math.min(maxPriceCents, fromReference);
}

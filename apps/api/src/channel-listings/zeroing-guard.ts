/**
 * How much of the catalogue one quantity push is allowed to empty.
 *
 * On 4 August a push took roughly 1,900 listings from a real quantity down to zero, because every
 * product without an availability row read as "none in stock" rather than "we do not know". Nothing
 * stopped it and nothing remarked on it. The guard that came out of that refuses the whole run when
 * it would empty more than a ceiling allows — before the loop, because a guard that trips halfway
 * has already done the damage it exists to prevent.
 *
 * It counted LISTINGS, and that was the wrong unit. Two products genuinely sold out, listed across
 * eleven and thirty-four marketplaces, count as forty-five — indistinguishable from forty-five
 * unrelated listings being emptied by a fault. In production that refusal stood for seven days
 * while those two products stayed on sale, advertising eighty-nine units nobody had. The guard was
 * protecting the catalogue from the truth.
 *
 * So breadth is measured in PRODUCTS, which is what an incident looks like: many things going to
 * zero at once. A product listed in thirty-four places legitimately empties thirty-four listings.
 *
 * A second ceiling remains on listings, far higher, for the different fault it catches: a matching
 * bug that attaches thousands of listings to a handful of products. Breadth and depth fail
 * separately and neither number can express the other.
 *
 * PURE.
 */

/** One listing a run would take from a real quantity down to zero. */
export interface ZeroingCandidate {
  productId: string;
}

/**
 * The listings ceiling: depth rather than breadth.
 *
 * A constant rather than a setting because nobody should be tuning it. It exists to catch a
 * mismatch between products and their listings — the SKU-matching faults this codebase has had
 * before — and if it ever trips, the answer is to find out why one product holds hundreds of
 * listings, not to raise a number. Set well above any honest catalogue shape and well below the
 * August incident, which would have been refused by either ceiling.
 */
export const MAX_ZEROING_LISTINGS = 500;

export type ZeroingVerdict =
  | { ok: true; products: number; listings: number }
  | { ok: false; products: number; listings: number; reason: string };

/**
 * May this run go ahead?
 *
 * `productCeiling` is the configured one — how many distinct products may be emptied at once.
 */
export function zeroingVerdict(candidates: readonly ZeroingCandidate[], productCeiling: number): ZeroingVerdict {
  const listings = candidates.length;
  const products = new Set(candidates.map((c) => c.productId)).size;

  // A ceiling somebody has set to zero means "never empty anything automatically", not "no limit".
  const ceiling = Number.isFinite(productCeiling) && productCeiling >= 0 ? Math.floor(productCeiling) : 25;

  if (products > ceiling) {
    return {
      ok: false,
      products,
      listings,
      reason:
        `Refused: this would take ${products} product${products === 1 ? '' : 's'} `
        + `(${listings} listing${listings === 1 ? '' : 's'}) from a real quantity down to zero, over the limit of `
        + `${ceiling}. Nothing was sent. Raise the limit in Settings if this is genuinely intended.`,
    };
  }

  if (listings > MAX_ZEROING_LISTINGS) {
    return {
      ok: false,
      products,
      listings,
      reason:
        `Refused: ${products} product${products === 1 ? '' : 's'} would empty ${listings} listings, over the `
        + `safety limit of ${MAX_ZEROING_LISTINGS}. That is more listings than those products should have; `
        + 'nothing was sent, and the matching between products and listings is worth checking before it is.',
    };
  }

  return { ok: true, products, listings };
}

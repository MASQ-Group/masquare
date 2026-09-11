/**
 * Which of several stored rows is the listing.
 *
 * A product has ONE live listing per marketplace. But a marketplace can hold more than one SKU for
 * it — a SKU submitted once and never completed, an old SKU Amazon still returns in its report —
 * and those arrive with no offer attached: no price, no quantity, no ASIN, and a listing status of
 * the empty string, which is Amazon answering "this is not for sale" rather than saying nothing.
 *
 * All three screens used to take whichever row came first, or last, out of a query with no ORDER BY.
 * For IT68277 on Amazon UK that was the empty one, so a listing with 19 units at £390 displayed as
 * Paused with no stock while Seller Central showed it live.
 *
 * So the row is chosen rather than stumbled upon: the one that can be bought, else the one that at
 * least carries an offer, and the most recently pulled where that still ties.
 */

export type ListingLike = {
  channelSku?: string | null;
  listingStatus?: string | null;
  listedQuantity?: number | null;
  listedPrice?: number | null;
  asin?: string | null;
  externalListingId?: string | null;
  lastPulledAt?: Date | string | null;
};

/**
 * How much of a listing a row is. Higher wins; 0 is a SKU with nothing behind it.
 *
 * Three signals rather than one, because two rows can both be real and still not be equally worth
 * showing. A product out of stock on its merchant offer and carrying an FBA sibling ranks alike on
 * "is it an offer" — and then the merchant row is the better answer, because it is the one with a
 * stock figure in it. Ranking on buyability alone left that to the order the query happened to
 * return, which is the whole defect this file exists to end.
 *
 * `listedQuantity != null` rather than `> 0`: a genuine zero is still the listing, and ranking it
 * below an empty stub would swap one wrong answer for another.
 */
function score(l: ListingLike): number {
  let n = 0;
  if ((l.listingStatus ?? '').toUpperCase().includes('BUYABLE')) n += 4;
  if (l.listedQuantity != null) n += 2;
  if (l.listedPrice != null || (l.asin ?? '').trim() || (l.externalListingId ?? '').trim()) n += 1;
  return n;
}

const pulledAt = (l: ListingLike): number => {
  const v = l.lastPulledAt;
  if (!v) return 0;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
};

/**
 * The listing among `rows`, or undefined when there are none.
 *
 * Returns a row even when every candidate is a stub — "not listed" is a question about whether any
 * row exists, and answering it here would hide a SKU the channel really did report.
 */
export function pickLiveListing<T extends ListingLike>(rows: readonly T[]): T | undefined {
  if (rows.length <= 1) return rows[0];
  return rows.reduce((best, row) => {
    const [a, b] = [score(row), score(best)];
    if (a !== b) return a > b ? row : best;

    const [ta, tb] = [pulledAt(row), pulledAt(best)];
    if (ta !== tb) return ta > tb ? row : best;

    /**
     * A last resort that does not depend on the order rows arrived in.
     *
     * Without it the answer came from whichever row the query returned first — and the screens do
     * not all select `lastPulledAt`, so one could tie where another did not and the same product
     * showed a different SKU on two pages. Arbitrary is tolerable here; inconsistent is not.
     */
    return String(row.channelSku ?? '') < String(best.channelSku ?? '') ? row : best;
  });
}

/** Group rows by a caller's key, keeping only the listing for each. */
export function pickLiveListingsByKey<T extends ListingLike>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): Map<string, T> {
  const grouped = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    grouped.set(k, [...(grouped.get(k) ?? []), r]);
  }
  const out = new Map<string, T>();
  for (const [k, group] of grouped) {
    const picked = pickLiveListing(group);
    if (picked) out.set(k, picked);
  }
  return out;
}

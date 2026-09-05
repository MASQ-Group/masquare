/** The status the Channel Listings grid colours by. */
export type DerivedListingStatus = 'live' | 'low' | 'oos' | 'paused' | 'error';

/**
 * What a pulled listing's state actually is, as one word.
 *
 * Order matters here. Whether the offer can be bought at all is settled FIRST, because a listing
 * Amazon refuses to sell is not "live" merely because it has stock behind it.
 *
 * Amazon reports status as an array: `["BUYABLE","DISCOVERABLE"]` for a healthy offer,
 * `["DISCOVERABLE"]` for one on the catalogue that nobody can buy, and `[]` for one that is simply
 * off. We store that joined, so an inactive listing arrives as the EMPTY STRING - and an empty
 * string is falsy, which is how a dead UK listing came to be shown as Live: the buyability check
 * was written as `if (s && ...)` and skipped itself exactly when the answer mattered most.
 *
 * So the test is on `listingStatus != null`, not on the string being non-empty. Null means the
 * channel does not report status at all (eBay, OnBuy) and must fall through; empty means Amazon
 * answered, and the answer was "no".
 */
export function deriveListingStatus(l: {
  listedQuantity: number | null;
  listingStatus: string | null;
  fulfilmentChannel: string | null;
}): DerivedListingStatus {
  const s = (l.listingStatus ?? '').toUpperCase();

  // Not buyable — whether that is DISCOVERABLE-only or nothing at all.
  if (l.listingStatus != null && !s.includes('BUYABLE')) return 'paused';

  if (l.fulfilmentChannel === 'FBA') return 'live'; // Amazon controls FBA quantity
  if (l.listedQuantity != null && l.listedQuantity <= 0) return 'oos';
  if (l.listedQuantity != null && l.listedQuantity <= 5) return 'low';
  return 'live';
}

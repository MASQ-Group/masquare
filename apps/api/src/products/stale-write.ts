/**
 * Is this save about to write an old copy of a product over a newer one?
 *
 * The product card loads a whole product when it opens and writes every field back on save. Anything
 * saved to that product while the card sat open was therefore silently reverted — which is how a
 * description Claude researched and wrote through the connector vanished 81 seconds later, with the
 * product's history showing only the person's save.
 *
 * Opt-in by design: a caller that does not say when it last saw the product (bulk edit, imports) is
 * not checked, and behaves exactly as it always has.
 *
 * PURE.
 */
export function isStaleWrite(storedUpdatedAt: Date | null | undefined, expectedUpdatedAt: string | null | undefined): boolean {
  if (!expectedUpdatedAt || !storedUpdatedAt) return false;

  const expected = new Date(expectedUpdatedAt).getTime();
  // An unreadable timestamp is a broken caller, not evidence of a change; it gets no check at all.
  if (!Number.isFinite(expected)) return false;

  /**
   * Compared as instants, not as strings. `2026-09-14T18:34:51.000Z` and `2026-09-14T21:34:51+03:00`
   * are the same moment, and a string comparison would refuse a save onto an unchanged product.
   */
  return storedUpdatedAt.getTime() !== expected;
}

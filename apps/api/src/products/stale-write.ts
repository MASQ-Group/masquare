import { renderValue } from '../activity/diff';

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

/**
 * Which of the fields a stale save carries changed underneath it.
 *
 * A stale save used to be refused outright. The card only sends the fields a person edited, so when
 * research wrote the eBay title and description while someone had the card open to fix the weight,
 * the weight save was refused although it touched nothing the research did — close, reopen, redo.
 *
 * Now the card also sends what each edited field showed when it opened. A field whose stored value
 * is still that is safe to write: nobody else changed it. A field that moved is a real conflict and
 * is named. Compared by value, not by reading the history, so it holds whatever wrote the product —
 * research, a colleague, a stock receipt — including writers that leave no history.
 *
 * `sent` and `expected` are in column form (the save's own mapping), so money and trimming compare
 * the way they are stored. A field sent without an expected value, and the lists (`unverifiable`,
 * e.g. aliases) that have no single stored value to compare, count as conflicts: not knowing is
 * treated as changed.
 *
 * Returns the conflicting columns. Empty means the save can go through.
 *
 * PURE.
 */
export function fieldsChangedUnderneath(
  stored: Record<string, unknown>,
  sent: Record<string, unknown>,
  expected: Record<string, unknown> | null,
  unverifiable: string[] = [],
): string[] {
  const out = [...unverifiable];
  for (const [column, value] of Object.entries(sent)) {
    const now = renderValue(stored[column]);
    // Already what this save writes — someone made the same change; nothing to lose.
    if (now === renderValue(value)) continue;
    if (!expected || !(column in expected) || now !== renderValue(expected[column])) out.push(column);
  }
  return out;
}

/**
 * Does a profit result still answer the prices on screen?
 *
 * The profit check is asked for a set of prices and answers with one line each. When a price is then
 * edited, the old answer is about prices nobody is looking at any more and must not be shown beside
 * the new ones.
 *
 * Its own function because the check it replaced looked right and never fired: it also required the
 * mutation's `variables`, which a mutation called with no argument never has, so every answer was
 * computed, returned, and thrown away. A rule that decides whether to show an answer is worth a test.
 *
 * PURE.
 */
export function profitResultFresh(
  resultPricesCents: readonly number[] | undefined,
  askedPricesCents: readonly number[],
): boolean {
  if (!resultPricesCents) return false;
  // The server answers each DISTINCT price once, in the order asked.
  const asked = [...new Set(askedPricesCents)];
  return asked.length > 0
    && resultPricesCents.length === asked.length
    && resultPricesCents.every((p, i) => p === asked[i]);
}

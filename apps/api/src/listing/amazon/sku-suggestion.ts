/**
 * A seller SKU that Amazon will actually accept on a new marketplace.
 *
 * Amazon treats a seller SKU as the listing's identity across the whole account, not per
 * marketplace. Asked to create IT33136 on Amazon AU while that SKU is already live on AE, SA and
 * SG, it refuses:
 *
 *   100398 — SKU 'IT33136' already exists in other Amazon marketplace(s).
 *            Use a new SKU and resubmit your listing.
 *
 * Which is a rejection nobody could have predicted from our own screen: the product genuinely is
 * not listed on AU, so the platform correctly offered it, and the collision only surfaced after a
 * person filled in the whole plan and pressed Validate. Knowing beforehand is the whole point.
 *
 * The suffix is the marketplace, because that is what a person reading the SKU later needs to
 * know: IT33136-AU says which listing this is at a glance, where IT33136-2 says nothing.
 */

/** Amazon caps seller SKUs at 40 characters. */
export const MAX_SKU_LENGTH = 40;

/**
 * A SKU close to `base` that is not in `taken`, suffixed with the marketplace.
 *
 * `taken` must be every SKU known to be in use anywhere in the account — the suggestion is
 * pointless if it collides in turn, and a second rejection after we proposed the name would be
 * worse than the first.
 *
 * Returns null when `base` is free: there is nothing to suggest, and offering an alternative to a
 * SKU that works would invite splitting one product across two identities for no reason.
 */
export function suggestSku(base: string, marketplace: string, taken: Iterable<string>): string | null {
  const seen = new Set([...taken].map((s) => s.trim().toUpperCase()).filter(Boolean));
  const root = base.trim();
  if (!root) return null;
  if (!seen.has(root.toUpperCase())) return null;

  const suffix = (marketplace ?? '').trim().toUpperCase();
  // Without a marketplace there is no meaningful name to give it, so fall back to a plain counter
  // rather than inventing a label that says nothing.
  const stem = suffix ? `${root}-${suffix}` : root;

  const fit = (candidate: string) =>
    candidate.length <= MAX_SKU_LENGTH
      ? candidate
      // Trim the ROOT, never the suffix: the suffix is the part that makes it unique and legible.
      : candidate.slice(0, MAX_SKU_LENGTH);

  const first = fit(stem);
  if (!seen.has(first.toUpperCase())) return first;

  // The marketplace-suffixed name is taken too — a previous attempt, most likely. Count up rather
  // than give up, but stop well short of forever: past a handful something else is wrong and a
  // person should look.
  for (let n = 2; n <= 20; n++) {
    const candidate = fit(`${stem}-${n}`);
    if (!seen.has(candidate.toUpperCase())) return candidate;
  }
  return null;
}

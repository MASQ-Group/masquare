/**
 * The carrier's own public tracking page for one number.
 *
 * The template lives on the shipping service — `{tracking}` is replaced — so adding a courier is a
 * settings row rather than a code change.
 *
 * Its own module because three services now need it: the tracking panel, the shipments log and the
 * tracking table. Whether we can LINK to a carrier's website and whether we can ASK its API where a
 * parcel is are separate questions, and only the second is FedEx-only — so the answer to the first
 * cannot live inside the FedEx integration.
 */
export function buildTrackingUrl(
  template: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  const t = (template ?? '').trim();
  const n = (trackingNumber ?? '').trim();
  // Null rather than a broken link: no template, no number, or a template with nowhere to put it.
  if (!t || !n || !t.includes('{tracking}')) return null;
  return t.replace('{tracking}', encodeURIComponent(n));
}

/**
 * The carrier's tracking page, for couriers whose results cannot be linked to.
 *
 * Some operators deliberately make a parcel un-linkable. Cyprus Post is one: its search is a POST
 * to /track-and-trace/find carrying a CSRF token and an obfuscated anti-bot field, and the results
 * page it then redirects to is a SIGNED url — the `expires` and `signature` in
 * `?code=…&expires=…&signature=…` are generated per search from a secret we do not hold. Reusing
 * one gives "Token has been expired."; a plain GET gives "Method Not Allowed". No template can
 * produce a working deep link, whatever we put where the code goes.
 *
 * So a template with NO `{tracking}` placeholder is read as the carrier's tracking page rather than
 * rejected: the best available is to open their form, with the number already on the clipboard.
 * Kept separate from the deep link so a screen can say which of the two it is offering — a link
 * that lands on an empty form should not look like one that lands on the parcel.
 */
export function carrierSiteUrl(template: string | null | undefined): string | null {
  const t = (template ?? '').trim();
  // A template WITH the placeholder is a deep link and is buildTrackingUrl's business, not this.
  if (!t || t.includes('{tracking}')) return null;
  return /^https?:\/\//i.test(t) ? t : null;
}

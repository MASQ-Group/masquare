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

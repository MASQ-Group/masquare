/** Build a shipment tracking URL from a shipping service's template.
 *  The template may contain a {tracking} placeholder; if absent, the number is appended. */
export function buildTrackingUrl(template: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  const num = trackingNumber?.trim();
  if (!template || !num) return null;
  const encoded = encodeURIComponent(num);
  return template.includes('{tracking}') ? template.replace(/\{tracking\}/g, encoded) : template + encoded;
}

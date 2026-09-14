/**
 * What KIND of source is the page this finding came from?
 *
 * A search brings back pages from everywhere: the maker's own site, Amazon, eBay, and a long tail of
 * retailers and catalogues. The validation rules already know what to do with each — the
 * manufacturer publishes, anything else needs corroboration — but only once somebody has said which
 * is which. That decision is here, and it is deliberately hard to fool in the dangerous direction.
 *
 * The dangerous direction is calling a reseller the manufacturer: a `manufacturer` finding publishes
 * without anybody confirming it. So the brand test matches a whole domain LABEL, never a substring.
 * `panasonic.co.uk` and `shop.panasonic.com` are Panasonic; `panasonic-store.co.uk` and
 * `mypanasonic.com` are not, and land as ordinary web pages — held back until a person agrees.
 *
 * Failing the other way is cheap. An unrecognised manufacturer domain becomes `web`, which means a
 * true fact waits for one click instead of publishing itself. A wrong `manufacturer` means a wrong
 * fact published with the highest confidence in the system.
 *
 * PURE.
 */
import type { OriginKind } from './provenance';

/** Anything found on the open web that is not the maker, Amazon or eBay: retailers, catalogues. */
export type WebSourceKind = Exclude<OriginKind, 'user'> | 'web';

/** Down to the letters and digits, so "De'Longhi" and "delonghi" are the same brand. */
function brandKey(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function classifySourceUrl(
  url: string,
  brand: { name?: string | null; website?: string | null },
): WebSourceKind {
  const host = hostOf(url);
  if (!host) return 'web';

  /**
   * The brand's recorded website wins, when there is one. Compared by registrable-ish suffix so a
   * recorded `beurer.com` still matches `www.beurer.com/uk` and `shop.beurer.com`.
   */
  const recorded = brand.website ? hostOf(brand.website) : null;
  if (recorded && (host === recorded || host.endsWith(`.${recorded}`))) return 'manufacturer';

  const labels = host.split('.');

  /**
   * No brand website recorded — which is every brand in this catalogue today. Fall back to the brand
   * name matching a whole label. A label, not a substring: `panasonic-store.co.uk` splits to
   * `panasonic-store`, which is not `panasonic`, so a reseller cannot inherit the maker's authority
   * by putting the name in its domain.
   */
  const key = brandKey(brand.name ?? '');
  if (key.length >= 3 && labels.some((l) => brandKey(l) === key)) return 'manufacturer';

  // Marketplaces are named explicitly; every national domain of each is one source, not many.
  if (labels.includes('amazon')) return 'amazon';
  if (labels.includes('ebay')) return 'ebay';

  return 'web';
}

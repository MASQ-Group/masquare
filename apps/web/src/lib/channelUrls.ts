/**
 * Where a listing actually lives, so "View" opens the listing rather than a guess.
 *
 * The storefront domain is per marketplace and is not derivable from the country code — Amazon
 * uses amazon.co.uk for GB, amazon.com.au for AU, amazon.ae for the UAE. A single hardcoded
 * amazon.com sent every "View on Amazon" to the US store, where a Spanish or German listing does
 * not exist, and the reader is shown a "page not found" for a listing that is perfectly live.
 */
const AMAZON_DOMAIN: Record<string, string> = {
  UK: 'amazon.co.uk', GB: 'amazon.co.uk',
  DE: 'amazon.de', FR: 'amazon.fr', ES: 'amazon.es', IT: 'amazon.it',
  NL: 'amazon.nl', BE: 'amazon.com.be', IE: 'amazon.ie', SE: 'amazon.se',
  PL: 'amazon.pl', TR: 'amazon.com.tr',
  US: 'amazon.com', CA: 'amazon.ca', MX: 'amazon.com.mx', BR: 'amazon.com.br',
  AU: 'amazon.com.au', JP: 'amazon.co.jp', SG: 'amazon.sg', IN: 'amazon.in',
  AE: 'amazon.ae', SA: 'amazon.sa', EG: 'amazon.eg', ZA: 'amazon.co.za',
};

const EBAY_DOMAIN: Record<string, string> = {
  UK: 'ebay.co.uk', GB: 'ebay.co.uk',
  DE: 'ebay.de', FR: 'ebay.fr', ES: 'ebay.es', IT: 'ebay.it', NL: 'ebay.nl',
  BE: 'ebay.be', IE: 'ebay.ie', AT: 'ebay.at', CH: 'ebay.ch', PL: 'ebay.pl',
  US: 'ebay.com', CA: 'ebay.ca', AU: 'ebay.com.au',
};

/**
 * A public link to the listing, or null when we cannot build an honest one.
 *
 * Null rather than a fallback on purpose: a link that lands on the wrong marketplace, or on a
 * search page, looks like the listing is missing. Better to show no button than a misleading one.
 */
export function listingUrl(args: {
  channelType?: string | null;
  /** ISO-2 of the marketplace the listing is on. */
  countryIso?: string | null;
  /** Amazon ASIN. */
  asin?: string | null;
  /** The channel's own id where it is not an ASIN — an eBay ItemID, for instance. */
  externalListingId?: string | null;
}): string | null {
  const iso = (args.countryIso ?? '').toUpperCase();
  const type = (args.channelType ?? '').toLowerCase();

  if (type === 'amazon' || (!type && args.asin)) {
    const domain = AMAZON_DOMAIN[iso];
    const asin = args.asin ?? args.externalListingId;
    return domain && asin ? `https://www.${domain}/dp/${encodeURIComponent(asin)}` : null;
  }

  if (type === 'ebay') {
    const domain = EBAY_DOMAIN[iso];
    // eBay's own id is the ItemID; a SKU will not resolve, so no id means no link.
    return domain && args.externalListingId ? `https://www.${domain}/itm/${encodeURIComponent(args.externalListingId)}` : null;
  }

  return null;
}

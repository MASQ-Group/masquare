import { ebayMarketplaceToIso } from './mappings/ebay-mapping';

/**
 * One eBay inventory item and its offers, as channel-listing rows.
 *
 * eBay answers with ONE OFFER PER SITE a SKU sells on, so a product eBaymag has republished to
 * Germany, France, Italy and Spain comes back as five offers. This is written once and used by both
 * reads — the account-wide sync and the per-product one — because they disagreed: the account sync
 * kept `offers[0]` and recorded such a product as listed in Britain alone, and since that sync
 * REPLACES a channel's rows it then deleted the other markets each time the per-product sync found
 * them. Two readers of the same API cannot be allowed to describe it differently.
 *
 * An item with no offer still produces a row: eBay manages the SKU, it is simply offered nowhere.
 *
 * PURE.
 */
export interface EbayListingRow {
  sku: string;
  asin: string | null;
  externalId: string | null;
  title: string | null;
  quantity: number | null;
  price: number | null;
  currency: string | null;
  fulfilmentChannel: 'FBM' | 'FBA' | null;
  status: string | null;
  marketplace: string | null;
}

export function ebayOfferRows(
  item: { sku: string; title: string | null; quantity: number | null },
  offers: readonly any[],
): EbayListingRow[] {
  const base = {
    sku: item.sku,
    asin: null,
    title: item.title,
    fulfilmentChannel: null,
  } as const;

  if (!offers?.length) {
    return [{ ...base, externalId: null, quantity: item.quantity, price: null, currency: null, status: null, marketplace: null }];
  }

  return offers.map((offer) => {
    const p = offer?.pricingSummary?.price;
    const offered = offer?.availableQuantity;
    return {
      ...base,
      // The eBay ItemID of the published listing, where the offer has been published.
      externalId: offer?.listing?.listingId != null ? String(offer.listing.listingId) : null,
      // The offer's own quantity where it states one: a market can be stocked differently.
      quantity: offered != null && Number.isFinite(Number(offered)) ? Number(offered) : item.quantity,
      price: p?.value != null && Number.isFinite(Number(p.value)) ? Number(p.value) : null,
      currency: p?.currency ?? null,
      status: offer?.status ?? offer?.listing?.listingStatus ?? null,
      marketplace: ebayMarketplaceToIso(offer?.marketplaceId ?? null),
    };
  });
}

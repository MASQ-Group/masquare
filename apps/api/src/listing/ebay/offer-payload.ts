/**
 * eBay Inventory API payloads — pure, so preview and publish can never build different ones.
 *
 * Publishing takes three calls, and they fail in different ways:
 *   1. PUT  /sell/inventory/v1/inventory_item/{sku}   — what the product IS
 *   2. POST /sell/inventory/v1/offer                  — what we sell it FOR, on one marketplace
 *   3. POST /sell/inventory/v1/offer/{id}/publish     — makes it a live, buyable listing
 *
 * Only the third is public. The first two are private records and can be deleted without trace,
 * which is what makes a staged approach worth the extra round trips.
 */

export interface EbayOfferInput {
  /** eBay allows alphanumerics only, max 50 — our SKUs carry hyphens and slashes. */
  sku: string;
  title: string | null;
  descriptionHtml: string | null;
  /** Bullet points. eBay caps these at 5 and 500 chars each. */
  keyFeatures?: string[];
  imageUrls?: string[];
  brand?: string | null;
  mpn?: string | null;
  ean?: string | null;
  condition: 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD';
  quantity: number | null;
  priceValue: number | null;
  currency: string;
  marketplaceId: string;
  categoryId: string | null;
  merchantLocationKey: string | null;
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  /** Days to dispatch. eBay wants this on the offer, not the item. */
  handlingTimeDays?: number | null;
  /**
   * Category-specific item specifics, merged over the defaults.
   *
   * Every eBay category demands its own — Table Top Blenders requires Model, another will want
   * Capacity or Power — and the list is only discoverable from the Taxonomy API at runtime. So the
   * defaults cover what every product has and this carries whatever the chosen category adds.
   */
  extraAspects?: Record<string, string[]>;
}

export interface MissingField { key: string; label: string }

/**
 * eBay rejects a SKU containing anything but letters and digits, and our catalogue is full of
 * hyphens and slashes (3G-084-378-24-100/0). Stripping them is not reversible on its own, so the
 * mapping is stored on the listing row rather than recomputed — this only produces the candidate.
 */
export function ebaySafeSku(sku: string): string {
  const cleaned = sku.replace(/[^a-zA-Z0-9]/g, '');
  return cleaned.slice(0, 50);
}

/** What is missing before eBay would accept this. Reported together rather than one 400 at a time. */
export function missingForPublish(input: EbayOfferInput): MissingField[] {
  const missing: MissingField[] = [];
  if (!input.title?.trim()) missing.push({ key: 'title', label: 'Title' });
  if (!input.descriptionHtml?.trim()) missing.push({ key: 'description', label: 'Description' });
  if (!input.imageUrls?.length) missing.push({ key: 'images', label: 'At least one image' });
  if (!input.categoryId) missing.push({ key: 'categoryId', label: 'eBay category' });
  if (!input.merchantLocationKey) missing.push({ key: 'merchantLocationKey', label: 'Merchant location' });
  if (!input.fulfillmentPolicyId) missing.push({ key: 'fulfillmentPolicyId', label: 'Postage policy' });
  if (!input.paymentPolicyId) missing.push({ key: 'paymentPolicyId', label: 'Payment policy' });
  if (!input.returnPolicyId) missing.push({ key: 'returnPolicyId', label: 'Returns policy' });
  // Zero is a real quantity and zero is a real price is NOT — a free listing is always a mistake.
  if (input.quantity == null) missing.push({ key: 'quantity', label: 'Quantity' });
  if (input.priceValue == null || input.priceValue <= 0) missing.push({ key: 'price', label: 'Price' });
  return missing;
}

/** Step 1 — the product record. Marketplace-independent: one item can carry many offers. */
export function buildInventoryItem(input: EbayOfferInput) {
  const aspects: Record<string, string[]> = {};
  if (input.brand) aspects.Brand = [input.brand];
  if (input.mpn) {
    aspects.MPN = [input.mpn];
    // Model is required by categories that never say so until they refuse the publish, and for the
    // products we sell the manufacturer part number IS the model. A real model, when the category
    // wants something else, comes through extraAspects and wins.
    aspects.Model = [input.mpn];
  }
  for (const [k, v] of Object.entries(input.extraAspects ?? {})) {
    if (v?.length) aspects[k] = v;
  }

  return {
    availability: { shipToLocationAvailability: { quantity: Math.max(0, Math.trunc(input.quantity ?? 0)) } },
    condition: input.condition,
    product: {
      title: (input.title ?? '').slice(0, 80), // eBay truncates at 80 and rejects longer
      description: input.descriptionHtml ?? '',
      ...(input.keyFeatures?.length ? { aspects: { ...aspects }, bulletPoints: input.keyFeatures.slice(0, 5).map((b) => b.slice(0, 500)) } : { aspects }),
      ...(input.imageUrls?.length ? { imageUrls: input.imageUrls.slice(0, 24) } : {}),
      ...(input.ean ? { ean: [input.ean] } : {}),
      ...(input.mpn ? { mpn: input.mpn } : {}),
      ...(input.brand ? { brand: input.brand } : {}),
    },
  };
}

/** Step 2 — the offer: this marketplace, this price, these policies. Still private until published. */
export function buildOffer(input: EbayOfferInput) {
  return {
    sku: input.sku,
    marketplaceId: input.marketplaceId,
    format: 'FIXED_PRICE',
    availableQuantity: Math.max(0, Math.trunc(input.quantity ?? 0)),
    categoryId: input.categoryId,
    merchantLocationKey: input.merchantLocationKey,
    pricingSummary: { price: { value: String(input.priceValue ?? 0), currency: input.currency } },
    listingPolicies: {
      fulfillmentPolicyId: input.fulfillmentPolicyId,
      paymentPolicyId: input.paymentPolicyId,
      returnPolicyId: input.returnPolicyId,
    },
    ...(input.handlingTimeDays != null
      ? { listingDuration: 'GTC', listingDescription: input.descriptionHtml ?? undefined }
      : { listingDuration: 'GTC' }),
  };
}

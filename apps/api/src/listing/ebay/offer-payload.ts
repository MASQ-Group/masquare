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
 *
 * The description goes in BOTH, and they are not the same field. The inventory item's is capped at
 * 4000 characters and is the catalogue's own summary; the offer's `listingDescription` is what a
 * buyer reads on the listing and allows 500,000. Our house template runs past 4000 on any product
 * with a real specification table, so sending it as the item description had eBay refuse the whole
 * publish: "Invalid value for description. The length should be between 1 and 4000 characters."
 */
import { htmlToPlainText } from './description-template';

/** eBay's own limits. Exceeding either is a refusal, not a truncation. */
const ITEM_DESCRIPTION_MAX = 4000;
const LISTING_DESCRIPTION_MAX = 500_000;

export interface EbayOfferInput {
  /** The product's own SKU, as ebaySafeSku leaves it: unchanged but for trimming and the 50 cap. */
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
 * The SKU a listing goes to eBay under: the product's own, unchanged.
 *
 * It used to be stripped to letters and digits — LE-83306 went out as LE83306 — on the strength of
 * a rule written in on 26 August: "eBay SKUs are alphanumeric only". That rule was asserted, never
 * observed; the account had no Inventory API items when it was written, so no refusal could have
 * taught it. Production says otherwise: 4,508 of this account's 4,762 eBay listings carry a hyphen,
 * some a slash as well.
 *
 * And stripping was not harmless. Orders are matched to products by SKU, exactly, so an order for
 * LE83306 would have arrived belonging to nothing — stock not deducted, profit not counted, the
 * order sitting unrecognised. At least two products went out that way before it was noticed —
 * LE-83306, and LAG-A158WEA-9EF on eBay UK and Italy.
 *
 * Changing the SKU has a consequence of its own: eBay finds a listing by SKU, so re-publishing one
 * of those under the unstripped SKU would miss it and make a second listing. publish-identity.ts
 * decides that before anything is sent.
 *
 * So the SKU goes out as it is. If the Inventory API does refuse a character, it refuses on the
 * inventory item — a private record, deleted without trace, before anything is public — and says
 * which. That is how the real rule gets learnt: by asking, not by guessing and then trusting the
 * guess.
 *
 * Trimmed, and cut at 50, the one limit eBay documents. A SKU longer than that cannot match exactly
 * whatever we do, and the listing row records what was actually sent so the difference is visible.
 */
export function ebaySafeSku(sku: string): string {
  return sku.trim().slice(0, 50);
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

/**
 * The inventory item's description: the same words as plain text, cut to eBay's 4000.
 *
 * Plain text rather than trimmed markup, because cutting HTML at 4000 characters lands inside a tag
 * as often as not. Cut at a word boundary with an ellipsis so it reads as shortened rather than as
 * broken — and the full designed description is on the offer, which is what buyers actually see.
 *
 * PURE.
 */
export function itemDescription(html: string | null | undefined): string {
  const text = htmlToPlainText(html);
  if (text.length <= ITEM_DESCRIPTION_MAX) return text;
  const cut = text.slice(0, ITEM_DESCRIPTION_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > ITEM_DESCRIPTION_MAX - 200 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
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
      description: itemDescription(input.descriptionHtml),
      ...(input.keyFeatures?.length ? { aspects: { ...aspects }, bulletPoints: input.keyFeatures.slice(0, 5).map((b) => b.slice(0, 500)) } : { aspects }),
      ...(input.imageUrls?.length ? { imageUrls: input.imageUrls.slice(0, 24) } : {}),
      ...(input.ean ? { ean: [input.ean] } : {}),
      ...(input.mpn ? { mpn: input.mpn } : {}),
      ...(input.brand ? { brand: input.brand } : {}),
    },
  };
}

/**
 * The same offer, as the body of an UPDATE to one eBay already holds.
 *
 * eBay keeps one offer per SKU and marketplace. A second publish of the same product finds that offer
 * and reuses it — and publishing a reused offer as eBay stored it sends whatever the FIRST attempt
 * carried. LAG-611474 kept being refused for "top-rated seller" after that phrase had been removed,
 * because the stored offer still had the old description. The update replaces the offer whole, and
 * eBay's update call takes neither the SKU nor the marketplace nor the format, which identify it.
 *
 * PURE.
 */
export function offerUpdateBody(offer: ReturnType<typeof buildOffer>) {
  const { sku: _sku, marketplaceId: _marketplaceId, format: _format, ...rest } = offer;
  return rest;
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
    listingDuration: 'GTC',
    /**
     * What the buyer reads: the full house design. It used to be sent only when a handling time
     * happened to be set — an accident of an earlier edit — so a listing without one showed eBay's
     * fallback, the 4000-character item summary, instead of the description we render.
     */
    ...(input.descriptionHtml?.trim()
      ? { listingDescription: input.descriptionHtml.slice(0, LISTING_DESCRIPTION_MAX) }
      : {}),
  };
}

/**
 * The public page for an eBay UK item.
 *
 * eBay UK because that is where the platform lists — eBaymag republishes to every other market, each
 * with its own item number that this does not hold.
 */
export function ebayItemUrl(itemId: string | null | undefined): string | null {
  const id = String(itemId ?? '').trim();
  return /^\d+$/.test(id) ? `https://www.ebay.co.uk/itm/${id}` : null;
}

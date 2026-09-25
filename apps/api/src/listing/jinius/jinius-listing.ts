/**
 * Creating an offer on Jinius, against a product its catalogue already carries.
 *
 * This is the half of Jinius listing that the discovery run proved: their catalogue is matched by
 * EAN, and 9 of 10 of our sampled products were already in it. An offer against a product they
 * carry is a small, reversible thing — a SKU, a price, a quantity and a condition — which is why it
 * is built first. Products they do NOT carry need a product import, which is a different shape of
 * work and needs content behind it.
 *
 * PURE.
 */

/**
 * Mirakl's condition code for new goods.
 *
 * Read off Jinius's own live offers, every one of which carries `state_code: "11"`. Each operator
 * defines its own codes, so this is theirs observed rather than a Mirakl constant.
 */
export const JINIUS_STATE_NEW = '11';

/** Everything one new Jinius offer is made of, resolved once so preview and create cannot differ. */
export interface JiniusListingInput {
  /** Our SKU, which is also the offer's identity on Mirakl (`shop_sku`). */
  sku: string | null;
  /** Their catalogue product, from the lookup. Null means they do not carry it. */
  productId: string | null;
  productIdType: string | null;
  /** In euro. Jinius sells in Cyprus and prices in euro. */
  price: number | null;
  stock: number;
  condition: string;
  /** An offer already exists under this SKU, so creating one would be the wrong verb. */
  alreadyListed: boolean;
}

/**
 * What stops this from being sent, in the words of the person who has to fix it.
 *
 * Deliberately only things that are TRUE before anything is sent. "Jinius does not carry it" is
 * reported separately, because it is a fact about their catalogue rather than something missing
 * here, and it leads somewhere different — a product import rather than a field to fill in.
 */
export function missingForJiniusListing(i: JiniusListingInput): string[] {
  const out: string[] = [];
  if (!i.sku) out.push('No SKU to create the offer under.');
  if (i.price == null || !(i.price > 0)) out.push('No price set for Jinius.');
  if (!i.productId) out.push('Jinius does not carry this product, so there is nothing to attach an offer to.');
  if (i.alreadyListed) out.push('An offer already exists on Jinius under this SKU.');
  return out;
}

/** Worth saying, but not worth refusing over. */
export function warningsForJiniusListing(i: JiniusListingInput): string[] {
  const out: string[] = [];
  if (i.stock <= 0) out.push('Nothing in stock, so the offer would go live with nothing to sell. The stock push will correct it when there is.');
  return out;
}

/**
 * The OF24 body for a NEW offer.
 *
 * `update_delete: "new"` is what separates creating from changing, and the product id is what
 * attaches our offer to their catalogue entry. Only these fields are sent: anything else would be
 * us deciding something on the seller's behalf.
 */
export function jiniusNewOfferBody(i: JiniusListingInput): { offers: Record<string, unknown>[] } {
  return {
    offers: [{
      shop_sku: i.sku,
      product_id: i.productId,
      product_id_type: i.productIdType ?? 'EAN',
      price: Number((i.price ?? 0).toFixed(2)),
      quantity: Math.max(0, Math.round(i.stock)),
      state_code: JINIUS_STATE_NEW,
      update_delete: 'new',
    }],
  };
}

/**
 * How to attach an offer to what the lookup found.
 *
 * Jinius answers a product lookup in a shape of its own, so `product_id` and `product_id_type` are
 * not always in it. The barcode we asked with is then the honest identifier to use: it is the one
 * we KNOW their catalogue matched on, because it is what found the product in the first place.
 */
export function jiniusOfferIdentity(
  match: { productId: string | null; productIdType: string | null } | null,
  ean: string | null,
): { productId: string | null; productIdType: string | null } {
  if (match?.productId) return { productId: match.productId, productIdType: match.productIdType ?? 'EAN' };
  if (ean) return { productId: ean, productIdType: 'EAN' };
  return { productId: null, productIdType: null };
}

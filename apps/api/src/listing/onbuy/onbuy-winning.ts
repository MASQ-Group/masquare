/**
 * The price to beat on OnBuy, from its Check Winning call (GET /v2/listings/check-winning).
 *
 * OnBuy compares offers on the price INCLUDING delivery — "the current winning price is £40.41
 * (including delivery)" — so a price that beats it is the winning total less one penny, less our own
 * delivery charge. Check Winning answers only for SKUs we list: there is no call that shows other
 * sellers' prices on a product we do not.
 *
 * PURE.
 */

export interface OnbuyWinning {
  sku: string;
  /** Our price, as OnBuy holds it. */
  price: number | null;
  itemPrice: number | null;
  deliveryPrice: number | null;
  /** The winning offer — the total, and its item and delivery parts where OnBuy gives them. */
  leadPrice: number | null;
  leadItemPrice: number | null;
  leadDeliveryPrice: number | null;
  /** Null where OnBuy did not say. */
  winning: boolean | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pence = (n: number) => Math.round(n * 100) / 100;

export function parseOnbuyWinning(json: any): OnbuyWinning[] {
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];
  return rows
    .filter((r) => r?.sku != null)
    .map((r) => ({
      sku: String(r.sku),
      price: num(r.price),
      itemPrice: num(r.item_price),
      deliveryPrice: num(r.delivery_price),
      leadPrice: num(r.lead_price),
      leadItemPrice: num(r.lead_item_price),
      leadDeliveryPrice: num(r.lead_delivery_price),
      winning: typeof r.winning === 'boolean' ? r.winning : r.winning == null ? null : !!Number(r.winning),
    }));
}

/**
 * Our price that beats the winning offer by a penny, and the one that matches it.
 *
 * Our own delivery charge comes off, because OnBuy adds it back when it compares — which is exactly
 * how its panel arrives at "change your price to £40.40" against £40.41 with free delivery. Nothing
 * is suggested where OnBuy gave no winning price (no other seller, or a listing not live yet), or
 * where we are already the winner — beating ourselves would only lower our own price.
 */
export function priceToBeat(w: OnbuyWinning): {
  beat: number | null;
  match: number | null;
  /** Why there is no suggestion, in words. */
  reason: string | null;
} {
  if (w.winning === true) return { beat: null, match: null, reason: 'Our offer is the winning one.' };
  if (w.leadPrice == null || !(w.leadPrice > 0)) {
    return { beat: null, match: null, reason: 'OnBuy gave no winning price — there may be no other seller, or our listing is not live.' };
  }
  const ourDelivery = w.deliveryPrice ?? 0;
  const match = pence(w.leadPrice - ourDelivery);
  const beat = pence(w.leadPrice - 0.01 - ourDelivery);
  if (!(beat > 0)) return { beat: null, match: match > 0 ? match : null, reason: 'Our delivery charge is more than the winning price.' };
  return { beat, match, reason: null };
}

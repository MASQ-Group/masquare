/**
 * One Jinius offer, exactly as Jinius describes it.
 *
 * Written because their API and their seller portal disagreed: OF21 answered quantity 3 for
 * 65-16567828 while the portal showed 1, eight minutes after the pull, with nothing ever pushed from
 * here. When a marketplace's own two surfaces disagree, reading the field names it actually sends is
 * the only way forward — Mirakl has more than one notion of quantity, and which one an operator puts
 * where is an operator's choice.
 *
 * PURE.
 */

/** One field off the offer, flattened so a person can read it beside the others. */
export interface JiniusOfferField {
  name: string;
  value: string;
  /** Names that plausibly carry a stock figure, so they can be shown first. */
  aboutQuantity: boolean;
}

export interface JiniusOfferDetail {
  found: boolean;
  shopSku: string | null;
  /** Every field of theirs, flattened one level. */
  fields: JiniusOfferField[];
  /** The raw object, for the answer that no summary anticipated. */
  raw: unknown;
}

/** Anything whose name suggests stock. Deliberately generous: this exists to find the unexpected. */
const QUANTITY_LIKE = /(quantity|qty|stock|available|reserved|pending|allocat)/i;

const show = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/**
 * Flatten one level, keeping nested objects as JSON rather than dropping them.
 *
 * A quantity hiding one level down — `logistic_class.quantity`, say — is exactly the kind of thing
 * this is for, so nothing is discarded on the way.
 */
function flatten(offer: Record<string, unknown>): JiniusOfferField[] {
  const out: JiniusOfferField[] = [];
  for (const [name, value] of Object.entries(offer)) {
    out.push({ name, value: show(value), aboutQuantity: QUANTITY_LIKE.test(name) });
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out.push({ name: `${name}.${k}`, value: show(v), aboutQuantity: QUANTITY_LIKE.test(k) || QUANTITY_LIKE.test(name) });
      }
    }
  }
  // Anything that might be a stock figure first; the rest keeps the order Jinius sent it in.
  return [...out.filter((f) => f.aboutQuantity), ...out.filter((f) => !f.aboutQuantity)];
}

/** Find one offer in a page of OF21 by the seller's own SKU, and describe it whole. */
export function readJiniusOfferDetail(json: unknown, shopSku: string): JiniusOfferDetail | null {
  const body = json && typeof json === 'object' ? (json as Record<string, any>) : null;
  const offers: any[] = Array.isArray(body?.offers) ? body!.offers : [];
  const wanted = shopSku.trim().toLowerCase();
  const offer = offers.find((o) => String(o?.shop_sku ?? '').trim().toLowerCase() === wanted) ?? null;
  if (!offer) return null;
  return {
    found: true,
    shopSku: String(offer.shop_sku ?? '').trim() || null,
    fields: flatten(offer as Record<string, unknown>),
    raw: offer,
  };
}

/**
 * What the two figures add up to, said plainly.
 *
 * The point of the probe is to end an argument between two screens, so it states the comparison
 * rather than leaving a reader to make it from a field list.
 */
export function readOfferQuantityVerdict(
  detail: JiniusOfferDetail | null,
  ourQuantity: number | null,
  sku: string,
): string {
  if (!detail) return `Jinius returned no offer with shop SKU ${sku}. Every page of their offer list was read.`;
  const q = detail.fields.filter((f) => f.aboutQuantity && f.value !== '—');
  if (!q.length) return `Jinius's offer for ${sku} carries no field that looks like a stock figure at all.`;
  const list = q.map((f) => `${f.name} = ${f.value}`).join(', ');
  return `Jinius's own offer for ${sku} says: ${list}. The platform holds ${ourQuantity ?? '—'} from the last pull.`;
}

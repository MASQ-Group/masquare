import type { CustomsItemInput } from '../carriers/carriers.service';
import { normaliseHsCode } from '../carriers/fedex-customs';

/**
 * One of our own orders, as the customs lines of a FedEx booking.
 *
 * Unlike a logistics customer's shipment, where each box is one line, an order's lines are its
 * products: the invoice FedEx writes is for what was sold. Every figure comes from the order and the
 * catalogue, and every one of them can be corrected on the booking screen before it is sent —
 * the catalogue is where these facts live, not where they are always right.
 *
 *  - description: the product's title.
 *  - quantity:    what was sold. A fractional quantity is left as it is and refused by the export
 *                 gate, rather than rounded into a number nobody sold.
 *  - value:       the line's net sale, excluding VAT, in the order's currency — what the buyer paid
 *                 for the goods. Shipping charged is carriage, not goods, and is not in it.
 *  - weight:      the product's package weight, else its own weight, times the quantity.
 *  - origin, HS:  the product's own, as the catalogue holds them.
 *
 * PURE.
 */

export interface OrderLineForBooking {
  sku: string;
  quantity: number | string | { toString(): string };
  netSalesAmount: number | null;
  product: {
    title: string | null;
    hsCode: string | null;
    countryOfOrigin: string | null;
    packageWeightKg: number | string | { toString(): string } | null;
    productWeightKg: number | string | { toString(): string } | null;
    /** The product's own shipping package, as the catalogue holds it. Optional: older callers omit it. */
    packageLengthCm?: number | string | { toString(): string } | null;
    packageWidthCm?: number | string | { toString(): string } | null;
    packageHeightCm?: number | string | { toString(): string } | null;
  } | null;
}

/** A parcel as the booking screen starts it: weight in kg, sides in cm, null where unknown. */
export interface SuggestedParcel {
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  /** Whose package this is, so the screen can say which box is which. */
  sku: string | null;
}

/** Beyond this many units, one box per unit is a list nobody wants to scroll; one combined parcel instead. */
export const MAX_SUGGESTED_PARCELS = 10;

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A country of origin as FedEx takes it: two letters.
 *
 * The catalogue's column is free text, filled over years by imports and by hand, so it holds both
 * "CN" and "China". A name is looked up in our own countries table; anything that cannot be read is
 * left empty for a person to choose, rather than guessed.
 */
export function originIso(raw: string | null | undefined, isoByName: ReadonlyMap<string, string>): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  return isoByName.get(text.toLowerCase()) ?? null;
}

/** The order's lines as customs lines, prefilled for a person to check. */
export function orderCustomsItems(
  lines: readonly OrderLineForBooking[],
  currency: string | null | undefined,
  isoByName: ReadonlyMap<string, string>,
): Array<CustomsItemInput & { sku: string; weightKnown: boolean }> {
  return lines.map((l) => {
    const quantity = num(l.quantity) ?? 1;
    const unitKg = num(l.product?.packageWeightKg) ?? num(l.product?.productWeightKg);
    return {
      sku: l.sku,
      description: (l.product?.title ?? l.sku).trim(),
      quantity,
      value: round2(num(l.netSalesAmount) ?? 0),
      currency: (currency ?? 'EUR').toUpperCase(),
      weightKg: unitKg != null ? round3(unitKg * quantity) : 0,
      weightKnown: unitKg != null,
      countryOfOrigin: originIso(l.product?.countryOfOrigin, isoByName),
      hsCode: normaliseHsCode(l.product?.hsCode) ?? (l.product?.hsCode?.trim() || null),
    };
  });
}

/**
 * The parcels to start from, from the catalogue's package data.
 *
 * A product's package weight and dimensions describe the box it ships in, so the honest first
 * suggestion is one parcel per unit, each with its own product's box. One unit is simply that box.
 * The weights are the same per-unit figures the customs lines are built from, so the two totals
 * agree from the start — FedEx refuses an export where they do not.
 *
 * One combined parcel, weighed but not measured, where one-per-unit cannot be offered: a fractional
 * quantity (goods sold by length or weight are not boxes) or more units than MAX_SUGGESTED_PARCELS.
 * Whoever packs it replaces the guess either way; the screen can also merge the boxes into one.
 */
export function suggestedParcels(lines: readonly OrderLineForBooking[]): SuggestedParcel[] {
  const units = lines.map((l) => num(l.quantity) ?? 1);
  const whole = units.every((q) => Number.isInteger(q) && q >= 1);
  const count = units.reduce((t, q) => t + q, 0);
  const unitKg = (l: OrderLineForBooking) => num(l.product?.packageWeightKg) ?? num(l.product?.productWeightKg);

  if (!whole || count > MAX_SUGGESTED_PARCELS || count === 0) {
    const kg = round3(lines.reduce((t, l, i) => t + (unitKg(l) ?? 0) * units[i], 0));
    return [{ weightKg: kg > 0 ? kg : null, lengthCm: null, widthCm: null, heightCm: null, sku: null }];
  }

  return lines.flatMap((l, i) => Array.from({ length: units[i] }, () => ({
    weightKg: unitKg(l),
    lengthCm: num(l.product?.packageLengthCm),
    widthCm: num(l.product?.packageWidthCm),
    heightCm: num(l.product?.packageHeightCm),
    sku: l.sku,
  })));
}

/**
 * One parcel to start from: the lines' weight together.
 *
 * FedEx wants the parcels to weigh what the items weigh, so the first suggestion is the one that
 * already agrees. Whoever packs it changes it — and then the lines' weights with it.
 */
export function suggestedParcelKg(items: ReadonlyArray<{ weightKg: number }>): number | null {
  const total = round3(items.reduce((t, i) => t + (Number(i.weightKg) || 0), 0));
  return total > 0 ? total : null;
}

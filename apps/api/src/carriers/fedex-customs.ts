import type { ShipCommodity, ShipParcel } from './fedex-ship';

/**
 * What a shipment leaving the EU must carry before FedEx will book it.
 *
 * The booking sent no customs items at all: the item type existed, nothing ever filled it, and the
 * gate never asked. So the first sandbox booking to Canada was refused with TOTALCUSTOMSVALUE.REQUIRED
 * — and every real booking outside the EU would have been refused the same way.
 *
 * The rules are the ones FedEx applies to this account, as the people who book these every day put
 * them:
 *
 *   1. Every item has a description, a quantity, a value, a weight, a country of origin and an HS
 *      code.
 *   2. An invoice for the same value travels with it. Either FedEx generates it from the items, or
 *      the platform does — that second route is a process still to be defined, so it is refused by
 *      name rather than half-built.
 *   3. The shipment's weight equals the items' weight.
 *
 * Checked before anything is sent, and all at once, so the person booking sees the whole list rather
 * than learning it one FedEx refusal at a time.
 *
 * PURE.
 */

/** Who produces the commercial invoice. */
export type InvoiceSource = 'fedex' | 'platform';

/** Rounding a scale might fairly differ by. Anything past it is a different shipment. */
export const WEIGHT_TOLERANCE_KG = 0.01;

/**
 * An HS code as FedEx takes it: digits only.
 *
 * People write them with dots and spaces — 8516.79.70 — and the tariff is the same number. Six digits
 * is the international heading every country shares; national extensions run to ten. Anything else
 * is not an HS code, and a wrong one is a customs hold, so it is refused rather than passed on.
 */
export function normaliseHsCode(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/[\s.\-]/g, '');
  return /^\d{6,10}$/.test(digits) ? digits : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The value the invoice will state, and FedEx needs stated at the top. */
export function totalCustomsValue(items: readonly ShipCommodity[]): { amount: number; currency: string } | null {
  if (!items.length) return null;
  return {
    amount: round2(items.reduce((sum, c) => sum + (Number(c.customsValueAmount) || 0), 0)),
    currency: items[0].currency,
  };
}

/**
 * Build an item from what a person enters: the line's total value, not a unit price.
 *
 * An invoice line is read as "3 of these, 120.00" — the total — and that total is what the rules
 * compare. FedEx wants the unit price as well; it is worked out here rather than asked for, so the
 * two can never disagree.
 */
export function commodityFromItem(item: {
  description: string;
  quantity: number;
  value: number;
  currency: string;
  weightKg: number;
  countryOfOrigin: string | null;
  hsCode: string | null;
}): ShipCommodity {
  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 0));
  return {
    name: item.description.trim().slice(0, 450),
    description: item.description.trim().slice(0, 450),
    countryOfManufacture: item.countryOfOrigin ? item.countryOfOrigin.trim().toUpperCase() : null,
    harmonizedCode: normaliseHsCode(item.hsCode) ?? item.hsCode,
    quantity,
    unitPriceAmount: round2((Number(item.value) || 0) / quantity),
    customsValueAmount: round2(Number(item.value) || 0),
    currency: item.currency.trim().toUpperCase(),
    weightKg: Number(item.weightKg) || 0,
  };
}

/**
 * Everything an export still needs, named. Empty means it may be sent.
 *
 * Only asked of shipments leaving the EU. Inside it, goods are in free circulation and FedEx wants a
 * description and nothing more.
 */
export function missingForExport(input: {
  commodities?: readonly ShipCommodity[] | null;
  parcels: readonly ShipParcel[];
  invoice?: InvoiceSource | null;
}): string[] {
  const gaps: string[] = [];
  const items = input.commodities ?? [];

  if (items.length === 0) {
    gaps.push('at least one item for customs (description, quantity, value, weight, country of origin, HS code)');
  }

  items.forEach((c, i) => {
    const which = items.length === 1 ? 'the item' : `item ${i + 1}`;
    if (!c.description?.trim()) gaps.push(`a description for ${which}`);
    if (!(c.quantity >= 1) || !Number.isInteger(c.quantity)) gaps.push(`a whole-number quantity for ${which}`);
    if (!(c.customsValueAmount > 0)) gaps.push(`a value for ${which}`);
    if (!(c.weightKg > 0)) gaps.push(`a weight for ${which}`);
    if (!/^[A-Z]{2}$/.test(c.countryOfManufacture ?? '')) gaps.push(`a country of origin for ${which}`);
    if (!normaliseHsCode(c.harmonizedCode)) gaps.push(`an HS code for ${which} (6 to 10 digits)`);
  });

  // One invoice, one currency. FedEx states a single total.
  const currencies = new Set(items.map((c) => c.currency));
  if (currencies.size > 1) gaps.push(`one currency for every item — these use ${[...currencies].join(' and ')}`);

  // Rule 3. Compared only once every item has a weight, so a missing weight is reported once, as
  // itself, rather than again as a mismatch.
  if (items.length && items.every((c) => c.weightKg > 0)) {
    const itemsKg = items.reduce((sum, c) => sum + c.weightKg, 0);
    const parcelsKg = input.parcels.reduce((sum, p) => sum + (Number(p.weightKg) || 0), 0);
    if (Math.abs(itemsKg - parcelsKg) > WEIGHT_TOLERANCE_KG) {
      gaps.push(
        `the items to weigh what the shipment weighs — items ${round2(itemsKg)} kg, shipment ${round2(parcelsKg)} kg`,
      );
    }
  }

  if (input.invoice === 'platform') {
    gaps.push('an invoice from FedEx — the platform generating its own invoice is not set up yet');
  } else if (input.invoice !== 'fedex') {
    gaps.push('who produces the commercial invoice');
  }

  return gaps;
}

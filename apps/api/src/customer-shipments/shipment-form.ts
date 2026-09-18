import { phoneProblem } from './phone-number';
import { normaliseHsCode } from '../carriers/fedex-customs';
import type { ShipmentInput } from './customer-shipments.service';
/**
 * The shipment form a logistics customer fills in, as rules rather than as a screen.
 *
 * The portal validates here and the API validates here, which is the point: a browser can be made
 * to submit anything, and a required field enforced only by the form it is drawn on is not required
 * at all. The screen reads this module for what to ask; the endpoint reads it for what to accept.
 *
 * PURE.
 */

export interface AddressForm {
  countryIso?: string | null;
  postalCode?: string | null;
  city?: string | null;
  state?: string | null;
  line1?: string | null;
  line2?: string | null;
  line3?: string | null;
}

export interface RecipientForm {
  companyName?: string | null;
  vatNumber?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  deliveryInstructions?: string | null;
}

export interface PackageForm {
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  goodsDescription?: string | null;
  declaredValue?: number | null;
  customerReference?: string | null;
  dangerousGoods?: boolean | null;
  batteryType?: string | null;
  priorityHandling?: boolean | null;
  insurance?: boolean | null;
  /** The box as a customs line. Required only for a delivery outside the EU — see customsNeeded. */
  quantity?: number | null;
  hsCode?: string | null;
  countryOfOrigin?: string | null;
}

/**
 * Where we collect the goods, when they are not already at our warehouse.
 *
 * Optional as a whole: left empty, the goods are with us. Once any of it is filled in, the rest of
 * what a courier needs to find the door becomes required — half an address is worse than none,
 * because it reads as answered.
 */
export interface CollectionForm {
  companyName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  countryIso?: string | null;
  postalCode?: string | null;
  city?: string | null;
  state?: string | null;
  line1?: string | null;
  line2?: string | null;
}

export interface ShipmentForm {
  orderReference?: string | null;
  serialNumbers?: string[] | null;
  recipient?: RecipientForm;
  address?: AddressForm;
  packages?: PackageForm[];
  currency?: string | null;
  collection?: CollectionForm | null;
}

/**
 * The battery types a shipment can declare.
 *
 * The packing instruction numbers are the point: a carrier's dangerous-goods desk works in PI 965
 * to PI 970, and "lithium battery" on its own tells them nothing about what paperwork the parcel
 * needs. Offered as a list rather than typed, because the difference between "packed with" and
 * "contained in" equipment is a different packing instruction and is very easy to type wrongly.
 */
export const BATTERY_TYPES = [
  { key: 'li_ion_alone', label: 'Lithium ion batteries only (PI 965)' },
  { key: 'li_ion_with_equipment', label: 'Lithium ion packed with equipment (PI 966)' },
  { key: 'li_ion_in_equipment', label: 'Lithium ion contained in equipment (PI 967)' },
  { key: 'li_metal_alone', label: 'Lithium metal batteries only (PI 968)' },
  { key: 'li_metal_with_equipment', label: 'Lithium metal packed with equipment (PI 969)' },
  { key: 'li_metal_in_equipment', label: 'Lithium metal contained in equipment (PI 970)' },
  { key: 'other', label: 'Other dangerous goods — we will call you' },
] as const;

export const BATTERY_TYPE_KEYS = BATTERY_TYPES.map((b) => b.key);

/** What insurance costs, as a share of the declared value. */
export const INSURANCE_RATE = 0.01;

/**
 * The insurance on one package, from what it was declared at.
 *
 * Worked out here rather than in the browser so that the figure the customer is shown and the
 * figure we would charge cannot be two different numbers. Rounded to the cent, and nothing without
 * a declared value to charge against — insurance on an undeclared parcel would be a promise with no
 * amount behind it.
 */
export function insuranceAmount(declaredValue: number | null | undefined, wanted: boolean | null | undefined): number | null {
  if (!wanted) return null;
  const value = Number(declaredValue ?? 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * INSURANCE_RATE * 100) / 100;
}

/** The insurance on a whole shipment: every insured package added up. */
export function totalInsurance(packages: readonly PackageForm[]): number {
  const total = packages.reduce((sum, p) => sum + (insuranceAmount(p.declaredValue, p.insurance) ?? 0), 0);
  return Math.round(total * 100) / 100;
}

/** Every declared value on the shipment, which is what customs is told it is worth. */
export function totalDeclaredValue(packages: readonly PackageForm[]): number {
  const total = packages.reduce((sum, p) => sum + (Number(p.declaredValue) > 0 ? Number(p.declaredValue) : 0), 0);
  return Math.round(total * 100) / 100;
}

const text = (v: string | null | undefined) => (v ?? '').trim();
const positive = (v: number | null | undefined) => Number.isFinite(Number(v)) && Number(v) > 0;

/** Whether any part of a collection address was given. Empty means the goods are at our warehouse. */
export function hasCollection(c: CollectionForm | null | undefined): boolean {
  if (!c) return false;
  return [c.companyName, c.contactName, c.phone, c.email, c.countryIso, c.postalCode, c.city, c.state, c.line1, c.line2]
    .some((v) => text(v) !== '');
}

/**
 * Whether this shipment crosses a customs border, so each box must carry its customs line.
 *
 * Outside the EU at either end — the delivery country, or a collection country where one was given.
 * Our warehouse is inside the EU, so with no collection address only the destination decides. The
 * same answer FedEx's own lane gives (customsLane in fedex-rate.ts), asked earlier: at filing, where
 * the customer still has the details to hand, rather than at booking, where we would have to send it
 * back and ask.
 *
 * Needs the EU list, which lives in the countries table. Without one nothing is required, which is
 * the safe direction for a caller that has not been given the list: the booking checks again.
 */
export function customsNeeded(form: ShipmentForm, euCountries?: ReadonlySet<string> | null): boolean {
  if (!euCountries || euCountries.size === 0) return false;
  const to = text(form.address?.countryIso).toUpperCase();
  const from = hasCollection(form.collection) ? text(form.collection?.countryIso).toUpperCase() : '';
  if (!to) return false;
  if (from && from === to) return false;
  return !euCountries.has(to) || (!!from && !euCountries.has(from));
}

/**
 * What is wrong with a submitted form, in the words the person filling it in needs.
 *
 * Every message names the field and, where there is more than one of a thing, which one — "Package
 * 2 needs a weight" rather than "weight is required", because a form of four packages with one
 * empty box is otherwise a hunt.
 */
export function problemsWith(form: ShipmentForm, opts: { euCountries?: ReadonlySet<string> | null } = {}): string[] {
  const problems: string[] = [];
  const r = form.recipient ?? {};
  const a = form.address ?? {};

  if (!text(r.contactName)) problems.push('The contact name and surname are needed.');
  if (!text(r.phone)) problems.push('A contact phone number is needed.');
  else {
    // Read against the delivery country when the number carries no prefix of its own — which is
    // the right guess far more often than not, and the only one available here.
    const bad = phoneProblem(r.phone, text(a.countryIso) || undefined);
    if (bad) problems.push(`That contact phone number will not reach anybody. ${bad}`);
  }
  if (!text(r.email)) problems.push('A contact email address is needed.');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(r.email))) problems.push('That contact email address does not look like an address.');

  if (!text(a.countryIso)) problems.push('The delivery country is needed.');
  if (!text(a.postalCode)) problems.push('The delivery postcode is needed.');
  if (!text(a.city)) problems.push('The delivery city is needed.');
  if (!text(a.line1)) problems.push('The first line of the delivery address is needed.');

  const c = form.collection;
  if (hasCollection(c)) {
    if (!text(c?.contactName)) problems.push('The collection address needs a contact name.');
    if (!text(c?.phone)) problems.push('The collection address needs a phone number, for the courier.');
    else {
      const bad = phoneProblem(c?.phone, text(c?.countryIso) || undefined);
      if (bad) problems.push(`That collection phone number will not reach anybody. ${bad}`);
    }
    if (text(c?.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(c?.email))) {
      problems.push('That collection email address does not look like an address.');
    }
    if (!text(c?.countryIso)) problems.push('The collection country is needed.');
    if (!text(c?.postalCode)) problems.push('The collection postcode is needed.');
    if (!text(c?.city)) problems.push('The collection city is needed.');
    if (!text(c?.line1)) problems.push('The first line of the collection address is needed.');
  }

  const customs = customsNeeded(form, opts.euCountries);
  const packages = form.packages ?? [];
  if (packages.length === 0) problems.push('A shipment needs at least one package.');

  packages.forEach((p, i) => {
    // Numbered as the screen numbers them, from one.
    const which = packages.length === 1 ? 'The package' : `Package ${i + 1}`;
    if (!positive(p.weightKg)) problems.push(`${which} needs a weight.`);
    if (!positive(p.lengthCm) || !positive(p.widthCm) || !positive(p.heightCm)) {
      problems.push(`${which} needs its length, width and height.`);
    }
    if (!text(p.goodsDescription)) problems.push(`${which} needs a description of the goods.`);
    if (p.dangerousGoods == null) problems.push(`${which} must say whether it holds dangerous goods.`);
    if (p.dangerousGoods && !text(p.batteryType)) problems.push(`${which} is dangerous goods, so it needs a battery type.`);
    if (p.dangerousGoods && text(p.batteryType) && !BATTERY_TYPE_KEYS.includes(text(p.batteryType) as never)) {
      problems.push(`${which} has a battery type we do not recognise.`);
    }
    /**
     * Insurance without a declared value has nothing to insure.
     *
     * Refused rather than quietly charged at zero: somebody who ticks insurance believes the parcel
     * is covered, and the moment to correct that belief is now rather than after a loss.
     */
    if (p.insurance && !positive(p.declaredValue)) {
      problems.push(`${which} is insured, so it needs a declared value — the cover is ${INSURANCE_RATE * 100}% of it.`);
    }

    // The customs line. Checked for shape whenever given; required only across a customs border.
    if (p.quantity != null && String(p.quantity).trim() !== '' && !(Number.isInteger(Number(p.quantity)) && Number(p.quantity) >= 1)) {
      problems.push(`${which} needs a whole-number quantity of 1 or more.`);
    }
    if (text(p.hsCode) && !normaliseHsCode(p.hsCode)) {
      problems.push(`${which} has an HS code that is not one — it is 6 to 10 digits, like 8516.79.`);
    }
    if (text(p.countryOfOrigin) && !/^[A-Za-z]{2}$/.test(text(p.countryOfOrigin))) {
      problems.push(`${which} needs its country of origin chosen from the list.`);
    }
    if (customs) {
      if (!positive(p.declaredValue)) problems.push(`${which} needs a declared value — customs is told what it is worth on a delivery outside the EU.`);
      if (!text(p.hsCode)) problems.push(`${which} needs an HS code for a delivery outside the EU.`);
      if (!text(p.countryOfOrigin)) problems.push(`${which} needs the country the goods were made in, for a delivery outside the EU.`);
    }
  });

  return problems;
}

/** Whether this form could be submitted as it stands. */
export const isComplete = (form: ShipmentForm): boolean => problemsWith(form).length === 0;

/**
 * The form, as the shipments service takes it.
 *
 * Lives here rather than in either caller because both the portal and our own team now file with
 * this same form, and the mapping is where a field quietly goes missing: add one to the form, wire
 * it up in one of the two translations, and the shipment filed by the other route is silently
 * poorer than the one beside it. There is one translation, and it has tests.
 *
 * `ShipmentInput` is imported as a type only, so nothing circular exists at runtime.
 */
export function formToInput(form: ShipmentForm): ShipmentInput {
  const r = form.recipient ?? {};
  const a = form.address ?? {};
  const packages = form.packages ?? [];
  const currency = (form.currency ?? 'EUR').toUpperCase();
  const c: CollectionForm = hasCollection(form.collection) ? form.collection ?? {} : {};

  return {
    customerReference: form.orderReference ?? null,
    serialNumbers: (form.serialNumbers ?? []).map((s) => s.trim()).filter(Boolean),
    goodsDescription: [...new Set(packages.map((p) => (p.goodsDescription ?? '').trim()).filter(Boolean))].join('; ') || null,
    goodsValue: totalDeclaredValue(packages) || null,
    goodsCurrency: currency,
    notes: null,
    deliveryInstructions: r.deliveryInstructions ?? null,
    to: {
      name: r.contactName ?? null,
      company: r.companyName ?? null,
      vatNumber: r.vatNumber ?? null,
      line1: a.line1 ?? null,
      line2: a.line2 ?? null,
      line3: a.line3 ?? null,
      city: a.city ?? null,
      region: a.state ?? null,
      postalCode: a.postalCode ?? null,
      countryIso: a.countryIso ?? null,
      phone: r.phone ?? null,
      email: r.email ?? null,
    },
    /**
     * Always written, even empty: an address cleared on the form must clear on the shipment, and
     * leaving the key out would keep the old collection address under a form that no longer shows it.
     */
    from: {
      name: c.contactName ?? null,
      company: c.companyName ?? null,
      line1: c.line1 ?? null,
      line2: c.line2 ?? null,
      city: c.city ?? null,
      region: c.state ?? null,
      postalCode: c.postalCode ?? null,
      countryIso: c.countryIso ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
    },
    parcels: packages.map((p) => ({
      weightKg: Number(p.weightKg),
      lengthCm: p.lengthCm ?? null,
      widthCm: p.widthCm ?? null,
      heightCm: p.heightCm ?? null,
      goodsDescription: p.goodsDescription ?? null,
      customerReference: p.customerReference ?? null,
      declaredValue: p.declaredValue ?? null,
      insurance: !!p.insurance,
      // Worked out on the server, never taken from the browser: it is a price, and a price the
      // caller could choose is not a price.
      insuranceAmount: insuranceAmount(p.declaredValue, p.insurance),
      dangerousGoods: !!p.dangerousGoods,
      batteryType: p.dangerousGoods ? p.batteryType ?? null : null,
      priorityHandling: !!p.priorityHandling,
      quantity: Number.isInteger(Number(p.quantity)) && Number(p.quantity) >= 1 ? Number(p.quantity) : 1,
      // Stored as the digits FedEx takes, so what we show is what is sent.
      hsCode: normaliseHsCode(p.hsCode) ?? (text(p.hsCode) || null),
      countryOfOrigin: text(p.countryOfOrigin).toUpperCase() || null,
    })),
  };
}

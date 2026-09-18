import { phoneProblem } from './phone-number';
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
}

export interface ShipmentForm {
  orderReference?: string | null;
  serialNumbers?: string[] | null;
  recipient?: RecipientForm;
  address?: AddressForm;
  packages?: PackageForm[];
  currency?: string | null;
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

/**
 * What is wrong with a submitted form, in the words the person filling it in needs.
 *
 * Every message names the field and, where there is more than one of a thing, which one — "Package
 * 2 needs a weight" rather than "weight is required", because a form of four packages with one
 * empty box is otherwise a hunt.
 */
export function problemsWith(form: ShipmentForm): string[] {
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
  });

  return problems;
}

/** Whether this form could be submitted as it stands. */
export const isComplete = (form: ShipmentForm): boolean => problemsWith(form).length === 0;

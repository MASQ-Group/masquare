import type { FormState } from './ShipmentFormFields';
import type { PortalCollection } from '../lib/api';
import { phoneProblem } from './phoneNumber';

/**
 * What the shipment form checks as somebody types, and which sections are ready.
 *
 * The API checks the same things and is the authority — this is what lets the screen say so before
 * the submit rather than after it. Written here rather than shared with the API because the two
 * cannot import from each other; the cost is that a rule changed in one has to be changed in the
 * other, so each rule below names the field it mirrors.
 *
 * Every message says what good looks like. "Invalid email" tells somebody their address is wrong;
 * "An address looks like name@company.com" tells them what to do about it.
 *
 * PURE.
 */

export type SectionKey = 'order' | 'customer' | 'address' | 'collection' | 'packages';

/** Mirrors normaliseHsCode in the API's fedex-customs.ts: 6 to 10 digits once dots and spaces go. */
export const isHsCode = (v: string | null | undefined): boolean => /^\d{6,10}$/.test(String(v ?? '').replace(/[\s.\-]/g, ''));

/** Mirrors hasCollection in the API's shipment-form.ts. Empty means the goods are at our warehouse. */
export function hasCollection(c: PortalCollection | null | undefined): boolean {
  if (!c) return false;
  return [c.companyName, c.contactName, c.phone, c.email, c.countryIso, c.postalCode, c.city, c.state, c.line1, c.line2]
    .some((v) => String(v ?? '').trim() !== '');
}

/**
 * Mirrors customsNeeded in the API's shipment-form.ts: whether each box must carry its customs line.
 * Outside the EU at either end; an empty EU list asks nothing, and the API checks again regardless.
 */
export function customsNeeded(form: Pick<FormState, 'address' | 'collection'>, eu: ReadonlySet<string>): boolean {
  if (eu.size === 0) return false;
  const to = String(form.address.countryIso ?? '').trim().toUpperCase();
  const from = hasCollection(form.collection) ? String(form.collection.countryIso ?? '').trim().toUpperCase() : '';
  if (!to) return false;
  if (from && from === to) return false;
  return !eu.has(to) || (!!from && !eu.has(from));
}

/** Mirrors the email check in the API's shipment-form.ts. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Phone numbers are checked against the country's real numbering plan, in phoneNumber.ts.
 *
 * The first build matched a shape here — an optional +, then six digits or more. It accepted
 * "+357 111111", which is not a Cyprus number and which no courier can dial. A parcel whose
 * contact number does not ring gets left on a doorstep, so the shape check was not good enough.
 */

/**
 * What is wrong with one field, or nothing.
 *
 * `hintIso` is the country a phone number with no prefix of its own should be read against — the
 * delivery country, which is what the API uses too.
 */
export function fieldProblem(
  kind: 'email' | 'phone' | 'required' | 'positive' | 'whole' | 'hs' | 'hsRequired',
  value: string | number | null | undefined,
  hintIso?: string | null,
): string | null {
  const text = String(value ?? '').trim();
  switch (kind) {
    case 'required':
      return text ? null : 'This is needed.';
    case 'email':
      if (!text) return 'This is needed.';
      return EMAIL.test(text) ? null : 'An email address looks like name@company.com';
    case 'phone':
      return phoneProblem(text, hintIso);
    case 'positive': {
      if (!text) return 'This is needed.';
      const n = Number(text.replace(',', '.'));
      if (!Number.isFinite(n)) return 'This should be a number.';
      return n > 0 ? null : 'This should be more than zero.';
    }
    case 'whole': {
      // Optional: an empty quantity is one box of one thing.
      if (!text) return null;
      const n = Number(text);
      return Number.isInteger(n) && n >= 1 ? null : 'A whole number, 1 or more.';
    }
    case 'hs':
      if (!text) return null;
      return isHsCode(text) ? null : 'An HS code is 6 to 10 digits, like 8516.79.';
    case 'hsRequired':
      if (!text) return 'This is needed outside the EU.';
      return isHsCode(text) ? null : 'An HS code is 6 to 10 digits, like 8516.79.';
  }
}

const filled = (v: unknown) => String(v ?? '').trim().length > 0;
const positive = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0;
};

/**
 * Whether each section has everything it needs.
 *
 * Drives the colour on the section header: complete or not, and nothing in between. A section
 * nobody has touched yet reads as incomplete, which is honest — it is.
 */
export function sectionComplete(form: FormState, eu: ReadonlySet<string> = new Set()): Record<SectionKey, boolean> {
  const r = form.recipient;
  const a = form.address;
  const c = form.collection;
  const customs = customsNeeded(form, eu);
  const whole = (v: unknown) => !String(v ?? '').trim() || (Number.isInteger(Number(v)) && Number(v) >= 1);

  return {
    // Nothing in the order section is required; it is complete by existing.
    order: true,
    customer: filled(r.contactName)
      && !fieldProblem('phone', r.phone ?? '', a.countryIso)
      && !fieldProblem('email', r.email ?? ''),
    address: filled(a.countryIso) && filled(a.postalCode) && filled(a.city) && filled(a.line1),
    // Complete when the goods are with us, or when the collection address holds what a courier needs.
    collection: !hasCollection(c) || (
      filled(c.contactName) && !fieldProblem('phone', c.phone ?? '', c.countryIso)
      && filled(c.countryIso) && filled(c.postalCode) && filled(c.city) && filled(c.line1)
    ),
    packages:
      form.packages.length > 0
      && form.packages.every((p) =>
        positive(p.weightKg) && positive(p.lengthCm) && positive(p.widthCm) && positive(p.heightCm)
        && filled(p.goodsDescription)
        && (!p.dangerousGoods || filled(p.batteryType))
        && (!p.insurance || positive(p.declaredValue))
        && whole(p.quantity)
        && (!filled(p.hsCode) || isHsCode(p.hsCode))
        && (!customs || (positive(p.declaredValue) && isHsCode(p.hsCode) && filled(p.countryOfOrigin)))),
  };
}

/** Whether the whole form could be submitted. */
export const formComplete = (form: FormState, eu?: ReadonlySet<string>): boolean => Object.values(sectionComplete(form, eu)).every(Boolean);

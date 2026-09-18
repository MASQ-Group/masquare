import type { FormState } from './ShipmentFormFields';

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

export type SectionKey = 'order' | 'customer' | 'address' | 'packages';

/** Mirrors the email check in the API's shipment-form.ts. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * A phone number, prefix and all — the field stores one string, so that is what is checked.
 *
 * Deliberately loose: an optional leading +, then digits, spaces, brackets and dashes, with six
 * digits or more somewhere in there. Numbering plans differ wildly and a strict pattern would
 * refuse real numbers, which is worse than accepting an odd one — our team can read it and
 * telephone. The digit count is counted rather than matched, because "+357 (0) 99-123456" has
 * plenty of digits and hardly any of them are adjacent.
 */
export const PHONE_SHAPE = /^\+?[0-9\s()\-.]+$/;
export const phoneLooksReal = (text: string): boolean =>
  PHONE_SHAPE.test(text) && (text.match(/\d/g)?.length ?? 0) >= 6;

/** What is wrong with one field, or nothing. */
export function fieldProblem(kind: 'email' | 'phone' | 'required' | 'positive', value: string | number | null | undefined): string | null {
  const text = String(value ?? '').trim();
  switch (kind) {
    case 'required':
      return text ? null : 'This is needed.';
    case 'email':
      if (!text) return 'This is needed.';
      return EMAIL.test(text) ? null : 'An email address looks like name@company.com';
    case 'phone':
      if (!text) return 'This is needed.';
      return phoneLooksReal(text) ? null : 'A phone number is digits, with or without spaces — at least six of them.';
    case 'positive': {
      if (!text) return 'This is needed.';
      const n = Number(text.replace(',', '.'));
      if (!Number.isFinite(n)) return 'This should be a number.';
      return n > 0 ? null : 'This should be more than zero.';
    }
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
export function sectionComplete(form: FormState): Record<SectionKey, boolean> {
  const r = form.recipient;
  const a = form.address;

  return {
    // Nothing in the order section is required; it is complete by existing.
    order: true,
    customer: filled(r.contactName) && !fieldProblem('phone', r.phone ?? '') && !fieldProblem('email', r.email ?? ''),
    address: filled(a.countryIso) && filled(a.postalCode) && filled(a.city) && filled(a.line1),
    packages:
      form.packages.length > 0
      && form.packages.every((p) =>
        positive(p.weightKg) && positive(p.lengthCm) && positive(p.widthCm) && positive(p.heightCm)
        && filled(p.goodsDescription)
        && (!p.dangerousGoods || filled(p.batteryType))
        && (!p.insurance || positive(p.declaredValue))),
  };
}

/** Whether the whole form could be submitted. */
export const formComplete = (form: FormState): boolean => Object.values(sectionComplete(form)).every(Boolean);

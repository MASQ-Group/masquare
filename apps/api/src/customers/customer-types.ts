/**
 * The kinds of customer the platform knows about.
 *
 * A customer is one record however many things we do for them; a type is a service they take from
 * us, and each type switches on the part of the platform that serves it. Logistics is the first. The
 * next one is a new entry here and a module that checks for it, not a second customer table.
 *
 * In code rather than in the database for the same reason as the access catalogue: a type is only
 * meaningful to the code that acts on it, and a type stored as a row could outlive that code and go
 * on looking like it granted something.
 *
 * PURE.
 */

export interface CustomerTypeDef {
  key: string;
  label: string;
  /** What taking this type from us means, shown where the type is chosen. */
  description: string;
}

export const CUSTOMER_TYPES: CustomerTypeDef[] = [
  {
    key: 'logistics',
    label: 'Logistics customer',
    description:
      'We book and track shipments for them. Their people sign in to the customer portal to file shipments and follow them, and every shipment is numbered from their reference prefix.',
  },
];

export const CUSTOMER_TYPE_KEYS = CUSTOMER_TYPES.map((t) => t.key);

export const LOGISTICS = 'logistics';

/** Whether a customer takes this service from us. */
export function hasType(customer: { types?: readonly string[] | null } | null | undefined, key: string): boolean {
  return !!customer?.types?.includes(key);
}

/**
 * The types as they will be stored: known, unique, in catalogue order.
 *
 * Unknown keys are refused rather than dropped. Silently discarding one would save a customer
 * without the service somebody meant to give them, and the first anyone would hear of it is a
 * customer who cannot sign in.
 */
export function normaliseTypes(raw: unknown): { ok: true; types: string[] } | { ok: false; reason: string } {
  if (raw == null) return { ok: true, types: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: 'Customer types must be a list.' };
  const wanted = new Set(raw.map((t) => String(t).trim()).filter(Boolean));
  const unknown = [...wanted].filter((t) => !CUSTOMER_TYPE_KEYS.includes(t));
  if (unknown.length) return { ok: false, reason: `Unknown customer type: ${unknown.join(', ')}.` };
  return { ok: true, types: CUSTOMER_TYPE_KEYS.filter((k) => wanted.has(k)) };
}

/**
 * What a customer with these types still needs before it can be saved.
 *
 * Each type owns its own requirements, which is what keeps a plain customer free of fields that only
 * matter to one service. A logistics customer needs a reference prefix, because every shipment they
 * file is numbered from it; a customer who is not one needs no prefix at all.
 */
export function missingForTypes(types: readonly string[], fields: { referencePrefix?: string | null }): string[] {
  const gaps: string[] = [];
  if (types.includes(LOGISTICS) && !(fields.referencePrefix ?? '').trim()) {
    gaps.push('A logistics customer needs a two-letter reference prefix — their shipments are numbered from it.');
  }
  return gaps;
}

/** The refusal a logistics-only action gives a customer who does not take that service. */
export const NOT_LOGISTICS = 'This customer is not set up as a logistics customer. Add the Logistics customer type to them first.';

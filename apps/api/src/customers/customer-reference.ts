/**
 * How a logistics customer's shipments are numbered.
 *
 * Two letters they choose, then a number that only goes up: `AB-0001`. The prefix is the whole point
 * — a reference is quoted down a telephone far more often than it is typed, and one that says which
 * customer it belongs to can be looked up by the person who answers.
 *
 * Padded to four digits so a list sorts the way it reads, and allowed to grow past four rather than
 * wrapping or refusing: a customer who files ten thousand shipments has earned a fifth digit.
 *
 * PURE.
 */

const PREFIX = /^[A-Za-z]{2}$/;

export type PrefixResult = { ok: true; prefix: string } | { ok: false; reason: string };

/** The prefix as it will be stored: two letters, upper case. */
export function normalisePrefix(raw: string | null | undefined): PrefixResult {
  const value = (raw ?? '').trim();
  if (!value) return { ok: false, reason: 'A two-letter reference prefix is required.' };
  if (!PREFIX.test(value)) {
    return {
      ok: false,
      reason: /[0-9]/.test(value)
        ? 'The reference prefix is two letters — digits belong to the number after it.'
        : 'The reference prefix must be exactly two letters, A to Z.',
    };
  }
  return { ok: true, prefix: value.toUpperCase() };
}

/** The reference for one shipment, from its customer's prefix and its own number. */
export function formatReference(prefix: string, sequence: number): string {
  const n = Math.max(1, Math.floor(sequence));
  return `${prefix.toUpperCase()}-${String(n).padStart(4, '0')}`;
}

/** The customer prefix a reference names, or null when it is not one of ours. */
export function prefixOfReference(reference: string | null | undefined): string | null {
  const m = /^([A-Za-z]{2})-\d{4,}$/.exec((reference ?? '').trim());
  return m ? m[1].toUpperCase() : null;
}

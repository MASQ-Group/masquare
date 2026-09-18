/**
 * How a logistics customer's shipments are numbered.
 *
 * Two letters they choose, then the year and month it was filed, then a number: `AB-2026-09-0001`.
 * The prefix is the whole point — a reference is quoted down a telephone far more often than it is
 * typed, and one that says which customer it belongs to can be looked up by the person who answers.
 * The date says when without anybody opening the record.
 *
 * The number restarts each January and runs on through the year, so the month in the reference says
 * when the shipment was filed without governing the count. `AB-2026-10-0003` follows
 * `AB-2026-09-0002`; the next January starts again at `AB-2027-01-0001`.
 *
 * Padded to four digits so a list sorts the way it reads, and allowed to grow past four rather than
 * wrapping or refusing: a customer who files ten thousand shipments in a year has earned a fifth
 * digit.
 *
 * PURE.
 */

const PREFIX = /^[A-Za-z]{2}$/;

/**
 * Which clock decides the year and month on a reference.
 *
 * Not the server's. A shipment filed at nine in the morning on the first of January is filed in
 * January by everyone who will ever look at it, and UTC would have called it December for the two
 * hours before Cyprus reached midnight — putting the wrong year on the reference and restarting the
 * count a day late. The platform has no timezone setting of its own; when it gets one, this is what
 * should read it.
 */
export const REFERENCE_TIMEZONE = 'Europe/Nicosia';

export type PrefixResult = { ok: true; prefix: string } | { ok: false; reason: string };

/** The year and month a reference is stamped with. */
export interface ReferencePeriod {
  year: number;
  /** 1–12. */
  month: number;
}

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

/**
 * The year and month of an instant, where the business is.
 *
 * Asked of Intl rather than worked out from the offset, because the offset changes twice a year and
 * an hour's error at the turn of a year is a wrong reference that cannot be taken back.
 */
export function periodOf(at: Date = new Date(), timeZone: string = REFERENCE_TIMEZONE): ReferencePeriod {
  // en-CA gives YYYY-MM-DD, which needs no parsing of month names in anybody's language.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(at);
  const [year, month] = parts.split('-').map(Number);
  return { year, month };
}

/** The reference for one shipment, from its customer's prefix, when it was filed and its number. */
export function formatReference(prefix: string, period: ReferencePeriod, sequence: number): string {
  const n = Math.max(1, Math.floor(sequence));
  const month = String(Math.min(12, Math.max(1, Math.floor(period.month)))).padStart(2, '0');
  return `${prefix.toUpperCase()}-${period.year}-${month}-${String(n).padStart(4, '0')}`;
}

/**
 * The customer prefix a reference names, or null when it is not one of ours.
 *
 * Both shapes, because references issued before the date was added are still on real shipments and
 * still get quoted down the telephone. A reader that only understood the current shape would say a
 * perfectly good reference belonged to nobody.
 */
export function prefixOfReference(reference: string | null | undefined): string | null {
  const text = (reference ?? '').trim();
  const m = /^([A-Za-z]{2})-(?:\d{4}-\d{2}-)?\d{4,}$/.exec(text);
  return m ? m[1].toUpperCase() : null;
}

/** When a reference says it was filed, or null for the older shape that does not say. */
export function periodOfReference(reference: string | null | undefined): ReferencePeriod | null {
  const m = /^[A-Za-z]{2}-(\d{4})-(\d{2})-\d{4,}$/.exec((reference ?? '').trim());
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

import { parsePhoneNumberFromString, getExampleNumber, type CountryCode } from 'libphonenumber-js/max';
import examples from 'libphonenumber-js/examples.mobile.json';

/**
 * Whether a telephone number is one somebody could actually answer.
 *
 * Checked against the real numbering plan of the country it belongs to, via libphonenumber — the
 * same data Google's own diallers use. Writing these rules by hand was the alternative and a bad
 * one: every country has its own lengths, prefixes and exceptions, and a pattern simple enough to
 * write from memory refuses real numbers. A courier who cannot telephone the recipient leaves the
 * parcel on a doorstep, so this is worth getting right rather than approximately right.
 *
 * The complaint always shows what a good number looks like for that country, because "invalid
 * phone number" tells somebody their number is wrong and nothing about what to do next.
 *
 * The API holds the same module and is the authority — this is what lets the field say so as the
 * number is typed rather than after the submit. Both call the same library, so the two cannot drift
 * on what a Cyprus number is; only the wording around it is duplicated.
 *
 * PURE.
 */

/**
 * Numbers that are real and dialable but are not a person expecting a parcel.
 *
 * A premium-rate or toll-free line is a company's switchboard for its own customers, not a contact
 * for a courier; a pager or voicemail box cannot be spoken to at all. Everything else valid is
 * accepted, including VoIP and personal numbers — plenty of people give one as their only phone,
 * and refusing a number somebody answers is worse than accepting an unusual one.
 */
const NOT_A_CONTACT = new Set(['PREMIUM_RATE', 'TOLL_FREE', 'SHARED_COST', 'PAGER', 'VOICEMAIL', 'UAN']);

/**
 * Drop the national trunk prefix people write in brackets after the country code.
 *
 * "+44 (0) 20 7946 0000" is how a great many British organisations print their own number, and the
 * (0) is an instruction to callers dialling from inside the country rather than a digit of the
 * number. libphonenumber reads it as a digit and refuses the number — correctly, and uselessly, on
 * a form somebody is copying their letterhead into.
 */
const dropTrunkPrefix = (text: string): string => text.replace(/^(\+\d{1,4})[\s.-]*\(0\)[\s.-]*/, '$1 ');

/** The country's name, for a message somebody has to read. Falls back to the code. */
export function countryName(iso: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

/** What a number for this country looks like, as it would be written locally. */
function exampleFor(iso: string): string | null {
  try {
    return getExampleNumber(iso as CountryCode, examples)?.formatNational() ?? null;
  } catch {
    return null;
  }
}

/**
 * What is wrong with a phone number, or nothing.
 *
 * `hintIso` is the country to read the number against when it carries no `+` prefix of its own —
 * on the shipment form, whatever the prefix picker is showing.
 */
export function phoneProblem(value: string | null | undefined, hintIso?: string | null): string | null {
  const text = String(value ?? '').trim();
  if (!text) return 'This is needed.';

  const hint = (hintIso ?? '').toUpperCase();
  const parsed = parsePhoneNumberFromString(dropTrunkPrefix(text), hint ? (hint as CountryCode) : undefined);

  // Nothing to read it against: no + on the number and no country chosen.
  if (!parsed?.country) {
    const example = hint ? exampleFor(hint) : null;
    return example
      ? `A ${countryName(hint)} number looks like ${example}.`
      : 'Choose the country code first, or start the number with it — for example +357 99123456.';
  }

  const name = countryName(parsed.country);
  if (!parsed.isValid()) {
    const example = exampleFor(parsed.country);
    return example
      ? `That is not a complete ${name} number. One looks like ${example}.`
      : `That is not a valid ${name} number.`;
  }

  const kind = parsed.getType();
  if (kind && NOT_A_CONTACT.has(kind)) {
    return 'We need a landline or mobile number the courier can call about the delivery.';
  }

  return null;
}

/** Just the answer, where the reason is not wanted. */
export const phoneIsUsable = (value: string | null | undefined, hintIso?: string | null): boolean =>
  phoneProblem(value, hintIso) === null;

/**
 * The number as it should be stored: E.164, the one form every carrier's API takes.
 *
 * Returns the text untouched when it cannot be read, so nothing is ever silently mangled — what
 * refused validation is what the person sees when they come back to correct it.
 */
export function normalisePhone(value: string | null | undefined, hintIso?: string | null): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const hint = (hintIso ?? '').toUpperCase();
  const parsed = parsePhoneNumberFromString(dropTrunkPrefix(text), hint ? (hint as CountryCode) : undefined);
  return parsed?.isValid() ? parsed.number : text;
}

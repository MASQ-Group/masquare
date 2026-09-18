import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

/**
 * A telephone number as FedEx's Ship API takes it: digits only.
 *
 * The forms keep what people typed — "+357 99 123456", "(020) 7946 0000" — and FedEx refuses the
 * spaces, brackets and plus sign. Which digits depends on whether the number belongs to the country
 * of the address it sits beside:
 *
 *  - It does: the national number, without the country code. FedEx reads the country from the
 *    address, and its own samples carry numbers this way throughout.
 *  - It does not (a British mobile for a delivery in Germany): the full international number, so the
 *    courier dials the right country.
 *
 * A number that cannot be read is reduced to its digits rather than dropped — the booking gate has
 * already checked it was there, and a courier with a slightly odd number beats one with none.
 *
 * PURE.
 */
export function fedexPhone(raw: string | null | undefined, addressCountryIso?: string | null): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const country = (addressCountryIso ?? '').toUpperCase();
  const parsed = parsePhoneNumberFromString(text, country ? (country as CountryCode) : undefined);
  if (parsed?.isValid()) {
    return parsed.country === country ? parsed.nationalNumber : parsed.number.replace(/\D/g, '');
  }
  const digits = text.replace(/\D/g, '');
  return digits || null;
}

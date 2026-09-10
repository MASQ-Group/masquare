/**
 * Which VAT regime a sale falls under, and whose threshold rule may speak to it.
 *
 * These are scope questions, and getting them wrong is the recurring fault in this area: a rule that
 * belongs to one jurisdiction gets applied to every sale because nothing checks where the goods
 * actually went. It has now happened three times — a marketplace's collection read as global, a
 * threshold read as global, and an export read as a domestic sale.
 */

/** The UK, whose £135 consignment threshold is the rule this platform actually operates. */
const GB = 'GB';

/**
 * Does a channel's VAT threshold rule govern THIS sale?
 *
 * A consignment threshold is a rule of the country the goods are imported INTO. The UK's £135
 * threshold governs imports into the UK; it says nothing about a parcel going to Israel, and using
 * it there produces a 20% rate on a sale that is zero-rated.
 *
 * That is not hypothetical. On production, fourteen Amazon UK orders to Israel, Taiwan, Turkey,
 * Hong Kong, Albania, Mauritius and the Philippines each carry a stored rate of 20% against zero
 * actual VAT — because the threshold fired on value alone and outranked the destination's own rate.
 *
 * Scoped by the channel's HOME country rather than a hardcoded 'GB' so an EU marketplace with its
 * own import threshold behaves correctly without another special case.
 */
export function channelThresholdApplies(input: {
  thresholdEnabled: boolean;
  thresholdAmount: number | null | undefined;
  /** ISO-2 of the channel's own country — the jurisdiction whose threshold this is. */
  channelHomeIso: string | null | undefined;
  /** ISO-2 of where the goods went. */
  destinationIso: string | null | undefined;
}): boolean {
  if (!input.thresholdEnabled || input.thresholdAmount == null) return false;

  const home = (input.channelHomeIso ?? '').trim().toUpperCase();
  const dest = (input.destinationIso ?? '').trim().toUpperCase();

  /**
   * An unknown destination is not an invitation to guess. Applying the threshold would assert a
   * rate; refusing it falls back to the country rate, which for an unknown country is nothing —
   * and a missing figure is a question somebody can answer, where a wrong one is not.
   */
  if (!home || !dest) return false;

  return home === dest;
}

/**
 * The tax regime a destination sits under.
 *
 * `none` is the important one and was missing: goods leaving the VAT area are zero-rated exports,
 * not domestic sales that happen to carry no tax. Returning 'vat' for them made an export
 * indistinguishable from a UK sale whose VAT had simply gone unrecorded — which is exactly the
 * confusion that made forty-one genuinely missing-VAT orders hard to find among fourteen correct
 * ones.
 */
export function taxRegimeFor(c: { isoCode?: string | null; euVatZone?: boolean | null } | null | undefined): string {
  if (!c) return 'none';
  const iso = (c.isoCode ?? '').toUpperCase();
  if (iso === 'JP') return 'jct';          // Japanese Consumption Tax
  if (iso === 'AU') return 'gst';          // Goods and Services Tax
  if (iso === 'US' || iso === 'CA' || iso === 'MX') return 'sales_tax';
  if (iso === GB) return 'vat';
  if (c.euVatZone) return 'vat';
  /**
   * Everywhere else: an export. No VAT is due and none should be recorded, so the regime says so
   * rather than leaving a 'vat' label on a sale that carries none.
   */
  return 'none';
}

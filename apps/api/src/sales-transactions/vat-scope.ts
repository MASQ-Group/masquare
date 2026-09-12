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
  /**
   * Australia and Singapore both run a GST the MARKETPLACE charges on its own storefront and keeps
   * — we are registered in neither, so none of it is ours to remit.
   *
   * Singapore was missing, and the asymmetry was ours rather than the world's: Australia was named
   * here and Singapore fell through to 'none', where a regime of 'none' leaves the tax sitting on
   * our side of the books. 267 orders in the first half of 2026, 708.79 of Amazon's own GST, booked
   * as though we owed it. The figures always matched Amazon to the cent — only the question of
   * whose money it was had never been asked.
   *
   * New Zealand is the same arrangement and turned up the same way — one order, sold through the
   * Australian storefront to a New Zealand address, left holding AUD 14.54 of GST that Amazon had
   * charged and kept. Amazon collects NZ GST on imported goods below the NZD 1,000 threshold as the
   * marketplace operator. This assumes we hold no New Zealand registration, as with the other two;
   * if that is ever wrong, this line is where to correct it.
   */
  if (iso === 'AU' || iso === 'SG' || iso === 'NZ') return 'gst';
  if (iso === 'US' || iso === 'CA' || iso === 'MX') return 'sales_tax';
  if (iso === GB) return 'vat';
  if (c.euVatZone) return 'vat';
  /**
   * Everywhere else: an export. No VAT is due and none should be recorded, so the regime says so
   * rather than leaving a 'vat' label on a sale that carries none.
   */
  return 'none';
}

/**
 * The rate before the destination country's own is consulted, or null to fall through to it.
 *
 * Exists for its ORDER, which is the part that can regress without anybody noticing. Where the
 * marketplace collected and keeps the tax, our rate is zero — and that has to be settled BEFORE the
 * consignment threshold, because the threshold cannot tell the two cases apart:
 *
 *   a UK channel, a UK destination, under £135, VOEC        Amazon's — our rate is 0%
 *   a UK channel, a UK destination, under £135, N. Ireland  ours — 20%
 *
 * Three identical facts, opposite answers. Only the channel's own report separates them. Amazon's
 * VAT report says as much: rate 0 on all 61 UK_VOEC orders in May, 20% on the three Newry and
 * Portadown ones beside them.
 *
 * Returns null rather than a number when neither rule applies, so the caller can keep the country
 * lookup lazy — most saves never need it.
 */
export function rateBeforeCountryFallback(input: {
  collectedByChannel: boolean;
  thresholdPct: number | null;
}): number | null {
  if (input.collectedByChannel) return 0;
  return input.thresholdPct;
}

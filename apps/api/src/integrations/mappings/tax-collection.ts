/**
 * Who owes this order's VAT — the marketplace, or us.
 *
 * Two separate facts, and conflating them is the mistake this file exists to prevent.
 *
 *   1. What the CHANNEL REPORTED. Amazon states it per order item in `TaxCollection.Model`;
 *      `MarketplaceFacilitator` means Amazon charged the buyer, kept the money and remits it. eBay
 *      says the same by returning `ebayCollectAndRemitTaxes`.
 *
 *   2. Whether that makes the VAT theirs RATHER THAN OURS. It does not, on its own. Amazon acts as
 *      facilitator for US sales tax, Australian GST and Japanese consumption tax as well — different
 *      taxes, different regimes, and reading any of them as "the VAT is not ours" is simply wrong.
 *
 * The business rule this platform runs on: the marketplace collects and remits only on UK-destined
 * sales through the UK CHANNELS, under the £135 consignment threshold. Both ends must be the UK —
 * an Amazon DE sale into the UK is deliberately excluded until somebody decides otherwise. Everything shipping into the
 * EU VAT zone carries VAT that WE collect and remit, whatever an API happens to report about it.
 *
 * The first version of this treated the reported flag alone as the answer and would have marked
 * every facilitator order across every marketplace as "not ours" — under-declaring output VAT on EU
 * sales that are entirely our liability. The report is necessary; it is not sufficient.
 */

/** The exact model Amazon uses when it has collected and remits the tax itself. */
export function isMarketplaceFacilitator(item: unknown): boolean {
  const model = (item as { TaxCollection?: { Model?: unknown } })?.TaxCollection?.Model;
  return typeof model === 'string' && model === 'MarketplaceFacilitator';
}

/**
 * `some`, not `every`.
 *
 * The threshold applies to the whole consignment, so in practice every line agrees. But a line that
 * carried no tax at all has no `TaxCollection` block, and requiring unanimity would let one such
 * line — a zero-priced sample, a fully discounted item — silently drop the report from an order
 * Amazon really did collect on.
 */
export function anyMarketplaceFacilitator(items: readonly unknown[]): boolean {
  return items.some(isMarketplaceFacilitator);
}

/** The only destination where a marketplace's VAT collection relieves us of the liability. */
const CHANNEL_REMITS_TO = 'GB';

/**
 * Marketplaces that collect under the UK threshold but tell us nothing about it.
 *
 * OnBuy's order payload has no field for it — there is no equivalent of Amazon's `TaxCollection` or
 * eBay's collect-and-remit lines — so "rely on the report" has nothing to rely on and every OnBuy
 * order would read as our liability. For these, and ONLY these, the threshold stands in for the
 * report that does not exist.
 *
 * Deliberately a list of channels rather than a rule about missing data. A missing report from
 * Amazon means something is wrong with the sync, and inferring from the threshold there would paper
 * over exactly the gap worth noticing. If OnBuy ever starts reporting, take it off this list — until
 * then the assumption stays where it is visible.
 */
const CHANNELS_WITHOUT_A_TAX_REPORT = new Set(['onbuy']);

/**
 * Does the marketplace's collection mean this order's VAT is not ours to declare?
 *
 * The regime and both countries must line up first. Only then does the question of evidence arise:
 * normally the channel must have SAID it collected, never inferred from the value of the goods,
 * because that would make our own threshold configuration decide who owes HMRC. The exception is a
 * channel that has no way of saying so at all — see `CHANNELS_WITHOUT_A_TAX_REPORT`.
 */
export function channelRemitsTheVat(input: {
  /** What the channel's own payload said. */
  reportedByChannel: boolean;
  /** The connector behind this channel: 'amazon' | 'ebay' | 'onbuy'. Null for a channel with no integration. */
  channelConnector: string | null | undefined;
  /** ISO-2 of the SELLING channel's own country. */
  channelHomeIso: string | null | undefined;
  /** ISO-2 of the destination country, as stored on the order. */
  destinationIso: string | null | undefined;
  /** The order's tax regime: vat | gst | jct | sales_tax | none. */
  taxType: string | null | undefined;
  /** Whether the order sits under the channel's own configured consignment threshold. */
  belowChannelThreshold: boolean;
}): boolean {
  const regime = (input.taxType ?? 'vat').trim().toLowerCase();
  const dest = (input.destinationIso ?? '').trim().toUpperCase();
  const home = (input.channelHomeIso ?? '').trim().toUpperCase();
  if (!dest) return false; // nothing may be concluded from an unknown destination

  /**
   * Japan first, and unconditionally. Amazon reports itself facilitator for consumption tax and the
   * SELLER KEEPS IT — "Your earnings" pays out the tax-inclusive amount. ¥76,066 in the first half
   * of 2026, and a flag saying the channel remits it would be a false statement about all of it.
   */
  if (regime === 'jct') return false;

  /**
   * Inside the EU VAT zone the sale is ours under OSS, whatever a marketplace reports. 966 such
   * orders in the same period reconcile to Amazon's own report at €12,431.87 — they are right, and
   * a facilitator flag must not take them away.
   *
   * Read from the regime rather than re-queried: `taxRegimeFor` answers 'vat' only for the UK and
   * for the EU VAT zone, so VAT to somewhere other than the UK IS the EU zone.
   */
  if (regime === 'vat' && dest !== CHANNEL_REMITS_TO) return false;

  /**
   * The UK arrangement, unchanged: a UK CHANNEL as well as a UK destination.
   *
   * Amazon DE shipping into the UK under £135 also collects, and by destination alone it would be
   * caught here. That is deliberately excluded — it is a question about which VAT registration the
   * sale sits under, and the answer is the business's rather than this function's.
   */
  if (dest === CHANNEL_REMITS_TO) {
    if (home !== CHANNEL_REMITS_TO) return false;
    /**
     * And a VAT sale. A UK destination always derives a VAT regime, so this should be unreachable —
     * which is exactly why it is stated: dropping it while widening the rule would have let the UK
     * threshold answer a question about some other tax, and nothing downstream would have objected.
     */
    if (regime !== 'vat') return false;
    if (input.reportedByChannel) return true;
    const connector = (input.channelConnector ?? '').trim().toLowerCase();
    return CHANNELS_WITHOUT_A_TAX_REPORT.has(connector) && input.belowChannelThreshold;
  }

  /**
   * Everywhere else: outside the UK and outside the EU VAT zone, so outside every registration we
   * hold. A marketplace that says it collected there collected under that country's own regime and
   * remits it itself — Amazon's report names the schemes: CH_VOEC for Switzerland, JE_VOEC for
   * Jersey, AU_VOEC, and plain REGULAR where responsibility still reads MARKETPLACE.
   *
   * Seventeen Swiss orders carried 93.10 of Amazon's VAT as ours because this branch did not exist,
   * and the rule could not express the answer its own file had already given.
   */
  return input.reportedByChannel;
}

/**
 * Is this order's channel-charged tax money that never becomes ours — as opposed to tax we collect
 * and hand over ourselves?
 *
 * `salesTaxAmount` records what the channel charged the buyer, whatever the regime, and on its own
 * says nothing about who ends up with it. Reading it as "the marketplace kept this" is wrong in two
 * regimes at once and was being shown that way on every order that carried any tax at all:
 *
 *   vat        ours, unless the channel reported collecting it — an Amazon FR sale into France is
 *              VAT we charge and remit, and the figure is the SAME money already inside the gross;
 *   jct        ours. Japan's consumption tax stays with the seller — Amazon's own "Your earnings"
 *              retains it, which is how the revenue basis treats it;
 *   gst        the channel's. Added at checkout, never part of our price;
 *   sales_tax  the channel's, for the same reason.
 *
 * Kept here with the rest of the regime rules so there is one place that knows this, rather than
 * three screens each deciding for themselves.
 */
export function marketplaceRemitsTax(input: {
  taxType: string | null | undefined;
  vatCollectedByChannel: boolean | null | undefined;
}): boolean {
  const regime = (input.taxType ?? 'vat').trim().toLowerCase();
  if (regime === 'gst' || regime === 'sales_tax') return true;
  if (regime === 'jct') return false;
  return !!input.vatCollectedByChannel;
}

/**
 * Does this destination have a VAT at all?
 *
 * Not "is the VAT ours" — whether the concept exists there. The United States has sales tax and no
 * VAT; Australia, Singapore and New Zealand have GST. A figure sitting in `vatAmount` on an order to
 * any of them is not a disputed amount, it is a misfiled one: there is no tax it could be.
 *
 * That distinction is what lets the repair move such a figure instead of refusing it. Where a VAT
 * genuinely exists and merely lacks a reported total behind it, the amount could still be ours and
 * guessing is not allowed — so this stays false for `vat`, and false for `jct`, which is a real
 * consumption tax that the seller keeps.
 */
export function regimeHasNoVat(taxType: string | null | undefined): boolean {
  const regime = (taxType ?? 'vat').trim().toLowerCase();
  return regime === 'gst' || regime === 'sales_tax';
}

/**
 * Strip tax the channel charged the buyer and keeps, so it is never counted as ours.
 *
 * The line still carries what the buyer paid, because that is what the marketplace reported — but
 * none of it reached us. `netSalesAmount` is untouched and already correct; Amazon's own VAT report
 * agrees with it on every order checked. Only the tax figure is wrong, and only because the order
 * API reports the tax the MARKETPLACE took while the VAT report puts the seller's at zero.
 *
 * It matters beyond tidiness: `sellerBaseNative` is net + VAT + shipping + shipping VAT, and that is
 * what `revenueIncVatEur` and the margin percentage are built from. Left in, it is revenue we never
 * received — 702 orders and £5,175 of it on the UK channels alone.
 *
 * Gated on `marketplaceRemitsTax`, NOT on the channel's facilitator flag. Amazon reports itself as
 * facilitator for Japanese consumption tax too, and the seller KEEPS that — ¥129,306 of it on file.
 * Zeroing on the raw flag would have taken all of it out of revenue.
 *
 * The full figure survives in `salesTaxAmount`, which is what eBay's mapping has always done.
 */
export function withoutChannelCollectedTax<
  T extends { vatAmount?: number | null; shippingAmountVat?: number | null },
>(items: readonly T[], input: {
  taxType: string | null | undefined;
  vatCollectedByChannel: boolean | null | undefined;
}): T[] {
  if (!marketplaceRemitsTax(input)) return [...items];
  return items.map((i) => ({
    ...i,
    ...(i.vatAmount == null ? {} : { vatAmount: 0 }),
    ...(i.shippingAmountVat == null ? {} : { shippingAmountVat: 0 }),
  }));
}

/**
 * Could a marketplace's report possibly relieve us on this order?
 *
 * The repair has to SELECT candidates before it can ask Amazon about them, and its query was written
 * around the only case the rule then knew: UK channel, UK destination. So when the rule learned that
 * Switzerland, Australia and the rest are outside every registration we hold, nothing changed —
 * 26 orders Amazon had plainly called its own were never candidates to begin with.
 *
 * The cheap half of `channelRemitsTheVat`, in other words: everything decidable WITHOUT the report,
 * so a query can narrow to the orders where the report is worth the call.
 */
export function couldChannelRemit(input: {
  channelHomeIso: string | null | undefined;
  destinationIso: string | null | undefined;
  taxType: string | null | undefined;
}): boolean {
  const regime = (input.taxType ?? 'vat').trim().toLowerCase();
  const dest = (input.destinationIso ?? '').trim().toUpperCase();
  const home = (input.channelHomeIso ?? '').trim().toUpperCase();
  if (!dest) return false;
  if (regime === 'jct') return false;
  if (regime === 'vat' && dest !== CHANNEL_REMITS_TO) return false;
  if (dest === CHANNEL_REMITS_TO) return home === CHANNEL_REMITS_TO && regime === 'vat';
  return true;
}

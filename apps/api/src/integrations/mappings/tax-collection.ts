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
  /** ISO-2 of the SELLING channel's own country — the marketplace must be the UK one. */
  channelHomeIso: string | null | undefined;
  /** ISO-2 of the destination country, as stored on the order. */
  destinationIso: string | null | undefined;
  /** The order's tax regime: vat | gst | jct | sales_tax | none. */
  taxType: string | null | undefined;
  /** Whether the order sits under the channel's own configured consignment threshold. */
  belowChannelThreshold: boolean;
}): boolean {
  /**
   * A facilitator report on GST, consumption tax or US sales tax says nothing about VAT. Those are
   * separate regimes the platform accounts for elsewhere, and letting one of them set a VAT flag
   * would put a claim about HMRC into a row describing a sale to Sydney.
   */
  if ((input.taxType ?? 'vat') !== 'vat') return false;

  /**
   * The UK channel, not merely a UK destination.
   *
   * Amazon DE shipping into the UK under £135 also collects, so destination alone would flag it.
   * That is a real case and arguably the same treatment — but it is a question about which VAT
   * registration the sale sits under, and the answer here is the one the business gave: the
   * marketplace relieves us on the UK channels. A rule this narrow is easy to widen later; a rule
   * that silently claimed relief on a German sale would be found by an auditor, not by us.
   */
  if ((input.channelHomeIso ?? '').trim().toUpperCase() !== CHANNEL_REMITS_TO) return false;
  if ((input.destinationIso ?? '').trim().toUpperCase() !== CHANNEL_REMITS_TO) return false;

  // What the channel actually told us always wins.
  if (input.reportedByChannel) return true;

  // Failing that, only where there was never a report to be had.
  const connector = (input.channelConnector ?? '').trim().toLowerCase();
  return CHANNELS_WITHOUT_A_TAX_REPORT.has(connector) && input.belowChannelThreshold;
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

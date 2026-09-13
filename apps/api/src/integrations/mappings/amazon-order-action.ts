/**
 * What the importer should do with one Amazon order, before any of it costs a request.
 *
 * Three of these decisions were inline string comparisons inside a two-hundred-line sync loop, and
 * the ORDER they run in carries meaning that none of them states on its own. Pulled out here so the
 * meaning can be written down once and tested without a marketplace.
 *
 * PURE: the caller supplies the order. No fetching, no database, no clock.
 */

export type AmazonOrderAction = 'skip-mcf' | 'skip-pending' | 'cancelled' | 'import';

export function amazonOrderAction(order: { SalesChannel?: unknown; OrderStatus?: unknown }): AmazonOrderAction {
  const channel = String(order?.SalesChannel ?? '');
  const status = String(order?.OrderStatus ?? '');

  /**
   * Multi-Channel Fulfilment first, and whatever the status.
   *
   * Amazon only SHIPPED these, out of FBA stock; the sale and its revenue belong to the non-Amazon
   * channel it was placed on. Checked before the cancel branch so an MCF cancellation is skipped
   * too — registering it here would put a cancellation against a sale Amazon never made.
   */
  if (channel === 'Non-Amazon') return 'skip-mcf';

  /**
   * Then Pending, which means payment verification has not cleared.
   *
   * Amazon withholds the order's financials while it sits there — `ItemTax` never arrives, and nor
   * does the shipping address — so importing one produces a sale with its VAT at zero, its net
   * overstated by the tax the buyer actually paid, and its destination guessed as the marketplace's
   * own country. It also reserves stock against an order that may never be paid for.
   *
   * Nothing is lost by waiting: incremental syncs filter on `LastUpdatedAfter`, so leaving Pending
   * is itself an update, and the order arrives on the next run complete.
   */
  if (status === 'Pending') return 'skip-pending';

  /**
   * Cancelled AFTER pending, and that order matters.
   *
   * An order cancelled straight out of Pending reports `Canceled`, not `Pending` — Amazon replaces
   * the status rather than keeping both — so this branch still sees it and registers it for
   * reporting. Putting the pending check second is what keeps that true.
   */
  if (status === 'Canceled') return 'cancelled';

  return 'import';
}

/**
 * How an order may change availability. The business's three rules, and nothing else:
 *
 *   1. Stock goes UP only by hand: a person sets a SKU's quantity in Availability and pushes it.
 *   2. An order for a SKU that is in availability lowers it by the units ordered, and the new
 *      figure is pushed to every channel.
 *   3. An order for a SKU that is NOT in availability is ignored. Nothing happens.
 *
 * The rule that makes 2 safe is that it happens ONCE per order and product, decided the first time
 * maSquare sees that order carrying that product, and never revisited. The code this replaces kept
 * a running "units deducted" on each order line and re-derived it on every save, so:
 *
 *   - every re-sync released the line's units and took them again;
 *   - cancelling, deleting or withdrawing an order gave units back — stock rising with nobody
 *     having typed a number, against rule 1;
 *   - an order that arrived before its SKU was in availability was deducted later, the next time it
 *     was saved, against rule 3;
 *   - clearing availability reset every line's count, so old orders deducted again.
 *
 * On 8 September a count of 11 for ATH-NES-CLAS-200G-PO2 was taken to zero within one minute by
 * ~60 August orders that had already been deducted before, and the zero went to every eBay market.
 * Of 774 deductions across the nineteen products zeroed that month, 442 were orders deducted twice.
 *
 * PURE.
 */

/** What was decided for one order and one product. Stored; never recomputed. */
export type OrderAvailabilityOutcome =
  /** The SKU was in availability: its units were taken. */
  | 'deducted'
  /** Rule 3 — the SKU was not in availability when the order arrived. Stays ignored for good. */
  | 'not_in_availability'
  /** Selling through to availability was switched off when the order arrived. */
  | 'sync_off'
  /** The order was already cancelled when it first arrived, so no units were ever sold. */
  | 'cancelled_on_arrival'
  /** Existed before these rules. Whatever it did then, it does nothing now. */
  | 'pre_existing';

/**
 * The identity of an order across re-syncs, deletions and re-imports.
 *
 * Not the transaction's row id: an order deleted and pulled again from the marketplace comes back as
 * a new row, and keying on the row is exactly how a withdrawn Amazon order could be deducted twice.
 * The marketplace's own order number, within the account that imported it, is what stays the same.
 * A hand-entered sale with no reference falls back to its row, which is the best identity it has.
 *
 * Must match the backfill in migration 20260915140000_order_availability_decision exactly.
 */
export function orderKey(t: {
  id: string;
  integrationId?: string | null;
  salesChannelId?: string | null;
  transactionRef?: string | null;
}): string {
  const scope = t.integrationId ?? t.salesChannelId ?? 'manual';
  const ref = (t.transactionRef ?? '').trim().toLowerCase();
  return `${scope}:${ref || t.id}`;
}

/**
 * The decision for one product on an order that has NOT been decided before.
 *
 * `units` is the whole number of units of that product across the order's lines. A caller that
 * finds a decision already stored must not call this at all — that is the whole point.
 */
export function decideOrderLine(input: {
  syncOn: boolean;
  cancelled: boolean;
  inAvailability: boolean;
  units: number;
}): { outcome: OrderAvailabilityOutcome; deduct: number } {
  if (!input.syncOn) return { outcome: 'sync_off', deduct: 0 };
  if (input.cancelled) return { outcome: 'cancelled_on_arrival', deduct: 0 };
  if (!input.inAvailability) return { outcome: 'not_in_availability', deduct: 0 };
  return { outcome: 'deducted', deduct: Math.max(0, Math.trunc(input.units)) };
}

/** Availability after an order: lowered by the units, never below zero, never raised. */
export function availabilityAfterSale(held: number, units: number): number {
  return Math.max(0, held - Math.max(0, Math.trunc(units)));
}

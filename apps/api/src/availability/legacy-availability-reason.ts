/**
 * Re-deriving what the legacy `cancellation` rows in the availability ledger actually were.
 *
 * Until the reason was decided rather than inferred, the sell-through wrote the ledger's reason from
 * the SIGN of the movement: `move > 0 ? 'sale' : 'cancellation'`. Every release therefore landed
 * under `cancellation`, whatever caused it.
 *
 * I said at first that these rows could not be re-derived because their cause was never written
 * down. That was wrong, and each attempt to bound how wrong has been too pessimistic again. The
 * cause was not recorded, but the row carries the ORDER REFERENCE in its note, and the order, its
 * lines and the ledger around it all still hold evidence.
 *
 * (The `refId` column looks like the better key and is not: a channel re-sync recreates transactions
 * with fresh ids, so those references are stale. `transactionRef` survives.)
 *
 * ── The old rule, and what each half leaves behind ──────────────────────────────
 * The release condition was `forceRelease || cancelledBeforeShipment || status !== 'submitted'`.
 *
 * `forceRelease` is not only a delete, which is the thing that took longest to notice. It is set by
 * a delete AND by any update that replaces an order's item rows — so ordinary editing churns
 * availability, and ordinary editing is most of what happens to these orders.
 *
 *   **The order was deleted.** `deletedAt` is set. Nothing else needs to be read.
 *
 *   **The order was edited and the units retaken.** An update returns availability and re-deducts
 *   against the new lines inside the same request, leaving a release and a matching sale for the
 *   same order and product. Measured on real data: every such pair sat within TEN MILLISECONDS,
 *   matched in size, with nothing else within hours of that window.
 *
 *   **The order was edited and the product dropped.** Same release, no retake, and today the order
 *   has no live line for that product. Lines only ever change through an update, so an edit removed
 *   it. This is the case the retake test cannot see, because there is nothing to pair with.
 *
 *   **The order was never submitted.** An order that is STILL a draft was a draft when the row was
 *   written — status only moves draft → submitted — so the third condition held, and it alone forces
 *   the release regardless of the other two.
 *
 * ── What remains unknowable, and why it stays that way ──────────────────────────
 * A release on a live, submitted order that still carries the product and was never retaken could be
 * a draft rule that fired before the order was submitted, or a line that simply shrank. No timestamp
 * separates them.
 *
 * Naming one would be the original mistake in a new costume — and the first version of the ledger
 * view made exactly that mistake, relabelling these rows "Cancelled before shipment" and so
 * asserting, about real shipped orders, something that never happened.
 */
export type LegacyAvailabilityReason =
  /** The order was deleted, so everything it held was force-released. */
  | 'released'
  /** An edit returned the units and took them straight back. Net effect nothing. */
  | 'order_edited'
  /** An edit dropped this product from the order, so the units stayed returned. */
  | 'order_line_removed'
  /** The platform did not count an unsubmitted order as an order. */
  | 'order_not_submitted';

/**
 * How close a retake has to be to prove it belongs to the same request.
 *
 * Every real pair measured came in around ten milliseconds; the nearest unrelated movement was
 * hours away. Five seconds is therefore loose enough to survive a slow request and nowhere near
 * loose enough to sweep in a genuinely separate edit.
 */
export const RETAKE_WINDOW_MS = 5_000;

export function legacyAvailabilityReason(input: {
  /** False when the note matches no order, or matches several that disagree. */
  found: boolean;
  status: string;
  /** The order has been deleted. */
  deleted: boolean;
  /**
   * Milliseconds until a `sale` row for the same order and product retook the SAME quantity.
   * Null when nothing retook it.
   */
  retakenAfterMs: number | null;
  /** The order still carries a live (not soft-deleted) line for this product. */
  hasLiveLine: boolean;
}): LegacyAvailabilityReason | null {
  if (!input.found) return null;

  // Certain, and it subsumes everything below — a deleted order releases all of it regardless.
  if (input.deleted) return 'released';

  /**
   * Checked before the status, because it is evidence about this row rather than about the order.
   *
   * An edit to a draft is still an edit, and "the units were returned and immediately retaken" says
   * more about what the reader is looking at than "the order was not submitted" does.
   */
  if (input.retakenAfterMs != null && input.retakenAfterMs <= RETAKE_WINDOW_MS) return 'order_edited';

  /**
   * The units were deducted against a line for this product, and the order no longer has one. Only
   * an update changes an order's lines, so an edit took it off — and unlike the retake case, the
   * units genuinely stayed returned.
   */
  if (!input.hasLiveLine) return 'order_line_removed';

  // Draft today ⇒ draft then ⇒ the release is fully explained by the draft rule.
  if (input.status === 'draft') return 'order_not_submitted';

  // Live, submitted, still carrying the product, never retaken: draft-then or a shrunken line.
  return null;
}

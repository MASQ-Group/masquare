/**
 * Re-deriving what the legacy `cancellation` rows in the availability ledger actually were.
 *
 * Until the reason was decided rather than inferred, the sell-through wrote the ledger's reason from
 * the SIGN of the movement: `move > 0 ? 'sale' : 'cancellation'`. Every release therefore landed
 * under `cancellation`, whatever caused it.
 *
 * I said at first that those rows could not be re-derived because their cause was never written
 * down. That was wrong twice over. The cause was not written down, but the row carries the ORDER
 * REFERENCE in its note, and what happened next is in the ledger itself.
 *
 * (The `refId` column looks like the better key and is not: a channel re-sync recreates transactions
 * with fresh ids, so those references are stale. `transactionRef` survives.)
 *
 * ── Two provable causes ─────────────────────────────────────────────────────────
 * The old release condition was `forceRelease || cancelledBeforeShipment || status !== 'submitted'`.
 *
 * **The order was edited.** `forceRelease` is not only a delete. Any update that replaces an order's
 * item rows returns their availability first and re-deducts against the new lines immediately after,
 * inside the same request. That leaves an unmistakable pair in the ledger: a release, then a `sale`
 * for the same order and product retaking exactly the same quantity. Measured on real data, all 265
 * such pairs sat within TEN MILLISECONDS of each other and every one matched in size, with nothing
 * else anywhere near that window. Net effect on availability: zero.
 *
 * **The order was never submitted.** An order that is STILL a draft was a draft when the row was
 * written — status only ever moves draft → submitted — so the third condition held, and it alone
 * forces the release regardless of the other two.
 *
 * The second rule alone settles most of a development copy and almost nothing on production, where
 * orders get submitted after the fact. That asymmetry is why the first rule matters: it reads what
 * happened to THIS row rather than the order's state today, so time cannot erode it.
 *
 * ── What remains unknowable ─────────────────────────────────────────────────────
 * A release on a submitted order that was never retaken could be a force-release, a shrunken line,
 * or a draft rule that fired before the order was submitted. Three candidate causes and no timestamp
 * to separate them, so those rows keep the vague label.
 *
 * Naming one would be the original mistake in a new costume — and the first version of the ledger
 * view made exactly that mistake, relabelling these rows "Cancelled before shipment" and so
 * asserting, about real shipped orders, something that never happened.
 */
export type LegacyAvailabilityReason = 'order_edited' | 'order_not_submitted';

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
  /**
   * Milliseconds until a `sale` row for the same order and product retook the SAME quantity.
   * Null when nothing retook it.
   */
  retakenAfterMs: number | null;
}): LegacyAvailabilityReason | null {
  if (!input.found) return null;

  /**
   * Checked before the status, because it is evidence about this row rather than about the order.
   *
   * An edit to a draft is still an edit, and "the units were returned and immediately retaken" says
   * more about what the reader is looking at than "the order was not submitted" does.
   */
  if (input.retakenAfterMs != null && input.retakenAfterMs <= RETAKE_WINDOW_MS) return 'order_edited';

  // Draft today ⇒ draft then ⇒ the release is fully explained by the draft rule.
  if (input.status === 'draft') return 'order_not_submitted';

  // Submitted and never retaken: draft-then or submitted-then is unknowable. Keep the vague label.
  return null;
}

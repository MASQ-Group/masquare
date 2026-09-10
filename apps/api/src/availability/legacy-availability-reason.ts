/**
 * Re-deriving what the 1,683 legacy `cancellation` rows actually were.
 *
 * Until the reason was decided rather than inferred, the sell-through wrote the ledger's reason from
 * the SIGN of the movement: `move > 0 ? 'sale' : 'cancellation'`. Every release therefore landed
 * under `cancellation`, whatever caused it.
 *
 * I said at the time that those rows could not be re-derived because their cause was never written
 * down. That was wrong. The cause was not written down, but the row carries the ORDER REFERENCE in
 * its note, and the order's own record still says what state it is in. For most of them that is
 * enough to settle the question outright.
 *
 * (The `refId` column looks like the better key and is not: a channel re-sync recreates transactions
 * with fresh ids, so those references are stale. `transactionRef` survives.)
 *
 * ── What can be proved ──────────────────────────────────────────────────────────
 * The old release condition was `forceRelease || cancelledBeforeShipment || status !== 'submitted'`.
 *
 * An order that is STILL a draft was a draft when the row was written — status only ever moves
 * draft → submitted. So the third condition held, and it alone forces the release regardless of the
 * other two. Nothing else needs to be known: the units came back because the platform did not count
 * an unsubmitted order as an order. That is provable, not inferred.
 *
 * It is also the case the complaint is about. Product BE-HT15 carries eight of these on one morning,
 * every one a draft with fulfilment `shipped` and channel status `shipped` — orders that went out
 * the door and were never returned or cancelled by anybody.
 *
 * ── What cannot ─────────────────────────────────────────────────────────────────
 * An order that is submitted TODAY may have been a draft when the row was written, so its release
 * could have come from the draft rule, from a force-release, or from the line simply shrinking.
 * Three candidate causes and no timestamp to separate them.
 *
 * Those keep the vague label. Naming one of the three would be the original mistake in a new
 * costume — and the first version of the ledger view made exactly that mistake, relabelling these
 * rows "Cancelled before shipment" and so asserting, about real shipped orders, something that never
 * happened.
 */
export type LegacyAvailabilityReason = 'order_not_submitted';

export function legacyAvailabilityReason(order: {
  /** False when the note matches no order, or matches several that disagree. */
  found: boolean;
  status: string;
}): LegacyAvailabilityReason | null {
  if (!order.found) return null;

  /**
   * Draft today ⇒ draft then ⇒ the release is fully explained by the draft rule.
   *
   * Deliberately not conditioned on `resolution`. A returned or replaced order that is still a draft
   * was released by the draft rule too — the resolution is a second fact about the order, not the
   * cause of this row. Reading it as the cause would be inference again.
   */
  if (order.status === 'draft') return 'order_not_submitted';

  // Submitted: draft-then or submitted-then is unknowable, so the row keeps its vague label.
  return null;
}

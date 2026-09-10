/**
 * Why availability moved — decided, not inferred from which way it went.
 *
 * The sell-through used to pick the ledger's reason from the sign of the movement:
 * `move > 0 ? 'sale' : 'cancellation'`. Anything that gave units back was written down as a
 * cancellation, so the ledger asserted a cause nobody had established.
 *
 * It was wrong in the ordinary case, not a corner. A channel order arrives as a DRAFT, and a draft
 * used to release its units — so every shipped-but-unsubmitted order wrote "cancellation" against
 * itself. Product BE-HT15 carried eight of them in one morning, each naming a real order that had
 * shipped and was never cancelled. Anyone reading that history would conclude their customers were
 * cancelling in numbers.
 *
 * Draft no longer releases anything — it is a completeness tag, not a claim that the order did not
 * happen — so that particular release cannot recur. The lesson stands regardless: a ledger is an
 * account of what happened, and guessing the cause from the arithmetic is the one thing it must
 * not do.
 */
export type AvailabilityMoveReason =
  | 'sale'
  /** Cancelled before the goods left, so the units really are sellable again. */
  | 'order_cancelled'
  /** The order was deleted, or availability was force-released. */
  | 'released'
  /** Still a live order, but for fewer units than before. */
  | 'quantity_reduced';

export function availabilityMoveReason(input: {
  /** desired − alreadyDeducted. Positive takes units, negative gives them back. */
  move: number;
  forceRelease: boolean;
  /** Resolution is 'cancelled' AND the channel has not shipped it. */
  cancelledBeforeShipment: boolean;
}): AvailabilityMoveReason {
  if (input.move > 0) return 'sale';

  /**
   * Ranked by which condition actually produced the release, in the order the caller applies them.
   *
   * A deleted order can also be a cancelled one, so naming the first true condition would make the
   * reason depend on the order of the checks rather than on what happened. This mirrors the caller
   * deliberately, so the two cannot drift.
   */
  if (input.forceRelease) return 'released';
  if (input.cancelledBeforeShipment) return 'order_cancelled';

  // Still live, not cancelled, and holding fewer units than it did — the line shrank.
  return 'quantity_reduced';
}

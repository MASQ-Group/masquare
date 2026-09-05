/** What a sync should do to a channel plan, having looked at whether the listing is there. */
export type PlanTransition =
  /** The channel is carrying it: record the plan as LISTED. */
  | 'confirm'
  /** The submission never became a listing: release the plan so it can be offered again. */
  | 'release'
  /** Nothing to do. */
  | 'none';

/**
 * Submitting is not listing, and only a sync can tell the difference.
 *
 * Amazon accepts an offer and publishes it some minutes later. In between, the plan sits at
 * SUBMITTED and the UI stops offering to list it again — otherwise the same request gets sent
 * twice. Something has to end that wait, and a sync is the only thing that has actually asked the
 * channel.
 *
 * The caller must only apply this where absence is EVIDENCE: a narrow per-product query, or an
 * account pull known to be complete. Releasing a plan on the strength of a truncated pull would
 * undo a submission that in fact succeeded — the same mistake, in a new place, as deleting a
 * listing record because it fell past a paging limit.
 */
export function planTransition(args: { status: string; found: boolean }): PlanTransition {
  if (args.found) {
    // Confirmed by the channel. Worth recording even if this plan is not what created the
    // listing — what matters is that the channel is carrying it now.
    return args.status === 'LISTED' ? 'none' : 'confirm';
  }

  // Only a plan actually waiting on a submission is released. A DRAFT was never waiting, and a
  // LISTED one going missing is a different story that this must not quietly rewrite.
  return args.status === 'SUBMITTED' ? 'release' : 'none';
}

/** What a sync should do to a channel plan, having looked at whether the listing is there. */
export type PlanTransition =
  /** The channel is carrying it: record the plan as LISTED. */
  | 'confirm'
  /** The submission never became a listing: release the plan so it can be offered again. */
  | 'release'
  /** Nothing to do. */
  | 'none';

/**
 * How long a submission is given to appear before its absence means anything.
 *
 * Amazon accepts an offer and publishes it some minutes later — occasionally a good deal longer.
 * Half an hour is comfortably past the usual case without leaving a genuinely failed submission
 * looking pending all day.
 */
export const SUBMISSION_GRACE_MS = 30 * 60 * 1000;

/**
 * Submitting is not listing, and only a sync can tell the difference.
 *
 * Amazon accepts an offer and publishes it some minutes later. In between, the plan sits at
 * SUBMITTED and the UI stops offering to list it again — otherwise the same request gets sent
 * twice. Something has to end that wait, and a sync is the only thing that has actually asked the
 * channel.
 *
 * Absence has to be evidence in TWO ways, and only one of them was checked here before.
 *
 * The first is completeness: a pull that came back short says nothing about what it did not return,
 * so the caller must only apply this to a narrow per-product query or an account pull known to be
 * whole. Releasing a plan on the strength of a truncated pull would undo a submission that in fact
 * succeeded.
 *
 * The second is TIME, and missing it made this rule actively harmful. Listing a product and then
 * syncing — which is the obvious next thing to do, and which the product page invites with a button
 * beside the one that just listed — asks Amazon about an offer it has accepted and not yet
 * published. The honest answer is "not yet"; this read it as "never", released the plan to DRAFT,
 * cleared listedAt, and put the green "List on Amazon" button back. Nothing recorded that a
 * submission had happened at all, so the next person could send it a second time.
 *
 * Production bore this out: 139 plans LISTED, 47 DRAFT, and not one SUBMITTED — every submission
 * had been released before Amazon got round to publishing it.
 *
 * So a submission younger than the grace period is left alone. Not found yet is not the same as
 * not accepted, and the cost of the two mistakes is not symmetric: waiting another half hour costs
 * nothing, while releasing early invites a duplicate offer on a live marketplace.
 */
export function planTransition(args: {
  status: string;
  found: boolean;
  /** When the submission was made. Null means we have no idea, which is treated as long ago. */
  listedAt?: Date | null;
  now?: Date;
}): PlanTransition {
  if (args.found) {
    // Confirmed by the channel. Worth recording even if this plan is not what created the
    // listing — what matters is that the channel is carrying it now.
    return args.status === 'LISTED' ? 'none' : 'confirm';
  }

  // Only a plan actually waiting on a submission is released. A DRAFT was never waiting, and a
  // LISTED one going missing is a different story that this must not quietly rewrite.
  if (args.status !== 'SUBMITTED') return 'none';

  /**
   * Still inside the window Amazon is entitled to take.
   *
   * A null listedAt is treated as long ago rather than as recent: a SUBMITTED plan with no
   * submission time is already inconsistent, and leaving it stuck at SUBMITTED forever would mean
   * the channel could never be offered again.
   */
  if (args.listedAt) {
    const age = (args.now ?? new Date()).getTime() - args.listedAt.getTime();
    if (age < SUBMISSION_GRACE_MS) return 'none';
  }

  return 'release';
}

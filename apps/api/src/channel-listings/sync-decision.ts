/**
 * What a listings sync is allowed to do with the rows it just pulled.
 *
 * The sync replaces a channel's records wholesale, which is right when the pull is complete and
 * destructive when it is not. Two different kinds of incomplete pull have now caused real damage,
 * and they need different answers:
 *
 *  - A COLLAPSE. On 29 Aug 2026 eBay returned 1 SKU where we held 4,710; the replace took that as
 *    the truth and deleted 4,709 records. Nothing about the shape of that answer is trustworthy,
 *    so the sync refuses outright and changes nothing.
 *
 *  - A TRUNCATION. Amazon stops paginating at 1,000 items but still reports the real total, so a
 *    pull of 1,000 against 1,013 is 1,000 correct rows plus 13 we simply could not reach. Refusing
 *    would throw away 1,000 good updates; replacing would delete 13 live listings. So the rows are
 *    written and nothing is deleted.
 *
 * Kept as a pure function because the rule is the part worth testing — the sync around it is
 * network calls and bulk writes.
 */
export type SyncMode =
  /** The pull is trustworthy and complete: delete this channel's rows and write the new set. */
  | 'replace'
  /** Known-partial: write what arrived, delete nothing. Stale beats absent. */
  | 'update-only'
  /** Implausible: change nothing at all. */
  | 'refuse';

/**
 * Below this many rows on record, a proportional collapse test says nothing useful: a genuine
 * small catalogue can legitimately halve between pulls, and refusing there would be noise.
 */
export const MIN_LISTINGS_TO_GUARD = 50;
/** A pull returning less than this share of what we already hold is treated as a collapse. */
export const KEEP_FRACTION = 0.5;

export function syncDecision(args: {
  /** Distinct rows the pull produced. */
  received: number;
  /** What the channel says it holds, when it says. Null means it did not tell us. */
  reportedTotal: number | null;
  /** Rows currently on record for this channel. */
  held: number;
}): { mode: SyncMode; shortBy: number } {
  const { received, reportedTotal, held } = args;

  // A collapse is judged first. A channel that has gone badly wrong may also under-report its
  // total, and "change nothing" is the safer of the two cautious answers.
  if (held >= MIN_LISTINGS_TO_GUARD && received < held * KEEP_FRACTION) {
    return { mode: 'refuse', shortBy: 0 };
  }

  // The channel counted its own listings and we received fewer. Not a judgement call.
  if (reportedTotal != null && received < reportedTotal) {
    return { mode: 'update-only', shortBy: reportedTotal - received };
  }

  return { mode: 'replace', shortBy: 0 };
}

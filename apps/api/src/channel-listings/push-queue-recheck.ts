/**
 * When to look again at a push the queue has given up on.
 *
 * A queue row counts attempts, and the drain only takes rows under the limit. That is right for a
 * marketplace refusing the same write five times — retrying for ever would spin — but it makes the
 * limit permanent. A row at it is never read again, so nothing it says can ever be true again, and
 * nothing anywhere shows it.
 *
 * Which is not hypothetical. Until 15 September a push that deliberately skipped — an automatic run
 * declining to RAISE a quantity, which is a decision rather than a failure — counted as a refusal
 * and burned all five attempts. That was fixed, and the fix could not reach the rows it had already
 * abandoned: seven of them sat at the limit for a week, holding errors that had stopped being true,
 * while two genuine Amazon failures hid among them unnoticed.
 *
 * So an abandoned row is reconsidered, rarely. Once a day is often enough that a fix reaches the
 * rows it should, and rare enough that a genuinely broken product is not hammering a marketplace.
 * The cap is there because a thousand abandoned rows coming back at once is its own incident.
 *
 * PURE.
 */

/** How many times a row is tried before the drain stops taking it in the ordinary way. */
export const PUSH_MAX_ATTEMPTS = 5;

/** How long an abandoned row waits before it is worth another look. */
export const RECHECK_AFTER_HOURS = 24;

/** How many abandoned rows one drain may reconsider. */
export const RECHECK_LIMIT = 50;

/** Rows last attempted before this are due another look. */
export function recheckCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RECHECK_AFTER_HOURS * 3600_000);
}

/**
 * Whether this abandoned row should be tried again now.
 *
 * A row that has never recorded an attempt is treated as due: its attempt count says it has been
 * tried, so a missing timestamp is a gap in the record rather than a reason to leave it for ever.
 */
export function dueForRecheck(
  row: { attempts: number; lastAttemptAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (row.attempts < PUSH_MAX_ATTEMPTS) return false;
  if (!row.lastAttemptAt) return true;
  return new Date(row.lastAttemptAt).getTime() <= recheckCutoff(now).getTime();
}

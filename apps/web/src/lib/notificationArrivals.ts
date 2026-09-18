import type { NotificationRow } from './api';

/**
 * Which notifications are news, and when to say so out loud.
 *
 * The bell polls a count, not a list — cheap enough to ask for every minute. A count cannot be
 * toasted, so the list is fetched only when the count goes up, and these rules decide what of it
 * is actually new to this browser tab.
 *
 * Two things go wrong without them, and both are worse than no toast at all. A tab opened on a
 * mailbox with nine unread would announce all nine at once, which is not news, it is an inbox. And
 * a count that merely re-arrives — a refetch on window focus, a second tab marking something read
 * — would re-announce what has already been seen.
 *
 * PURE.
 */

/** Most that will ever appear at once. Beyond this the badge is the better tool. */
export const MOST_AT_ONCE = 3;

/**
 * Whether a change in the unread count is worth going to look at.
 *
 * `null` for `before` means this tab has not seen a count yet: the first answer establishes what
 * was already waiting rather than announcing it.
 */
export function countRose(before: number | null, now: number): boolean {
  return before !== null && now > before;
}

/**
 * What to announce, given what this tab has already announced.
 *
 * Unread only — something already read elsewhere is not news here either. Newest first, because if
 * several arrived at once the latest is the one somebody is waiting for.
 */
export function newArrivals(seen: ReadonlySet<string>, items: NotificationRow[]): NotificationRow[] {
  return items
    .filter((n) => !n.readAt && !seen.has(n.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MOST_AT_ONCE);
}

import { createHash } from 'node:crypto';

/**
 * Which scope set a stored eBay refresh token actually accepts, remembered.
 *
 * eBay refuses a refresh whose requested scopes aren't a subset of what the token was granted, so
 * `ebayAccessToken` tries the configured set, then read-only, then no scope at all. That fallback
 * works — but it was rediscovered on every single call, and production paid two rejected round-trips
 * and logged two warnings for each eBay request, all day, to reach the same answer as the call
 * before.
 *
 * The answer only changes when the credentials change, so it is remembered against them: the app id,
 * the stored token, and the set we would ask for. A reconnect that grants more scopes, or the write
 * opt-in being switched on, changes the key and is probed again from the top — nothing stays stuck
 * on a narrower token than the seller now has.
 *
 * In memory only, and deliberately: after a deploy the first call per credential re-probes and logs
 * once, which is the reminder an operator wants, at a cost of two round-trips a day.
 *
 * PURE (a map of small integers; no I/O, no clock).
 */
export class EbayScopeMemory {
  private readonly chosen = new Map<string, number>();

  /**
   * Identity of a credential *and* the request we would make with it. The token is hashed rather
   * than kept as a key — it is a secret, and only its sameness matters here.
   */
  static keyOf(appId: string, refreshToken: string, requested: readonly string[]): string {
    return createHash('sha256').update(JSON.stringify([appId, refreshToken, [...requested].sort()])).digest('hex').slice(0, 32);
  }

  /** The candidate to try first: what worked last time for these credentials, else the configured set. */
  firstToTry(key: string): number {
    return this.chosen.get(key) ?? 0;
  }

  /**
   * Record the set eBay accepted. Returns true when that differs from what was remembered — an
   * unseen credential counting as the configured set — so the caller logs the fallback once per
   * token instead of once per call.
   */
  remember(key: string, index: number): boolean {
    const changed = this.firstToTry(key) !== index;
    this.chosen.set(key, index);
    return changed;
  }
}

/** How to name each candidate in a log line an operator has to act on. */
export const EBAY_SCOPE_LABELS = ['the configured', 'the read-only', "the token's own granted"] as const;

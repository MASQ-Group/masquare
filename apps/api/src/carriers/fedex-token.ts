/**
 * FedEx token handling, as pure logic.
 *
 * The token endpoint is throttled far harder than the APIs it unlocks — roughly three requests a
 * second in burst, one sustained, counted PER IP rather than per account — and breaching it earns a
 * ten-minute ban that lengthens on repeat. On a single server that means every carrier account
 * shares one budget, so the naive approach of minting a token per request does not merely waste
 * calls: it takes the whole integration down, for every company at once, for ten minutes.
 *
 * FedEx's own advice is to cache the token and refresh only on seeing a 401, never pre-emptively.
 * That advice is followed here, with one deliberate addition — see `isExpired`.
 *
 * Kept as pure functions so the rules can be tested without a network, an HTTP mock, or a clock.
 */

export interface CachedToken {
  accessToken: string;
  /** Absolute expiry, computed once when the token was minted. */
  expiresAt: Date;
}

/**
 * How much of a token's life we refuse to use.
 *
 * FedEx issues an hour and advises refreshing on 401 rather than on a timer. Taken literally that
 * means every token is used until it fails, and each expiry costs one wasted request. This trims a
 * minute off the end instead: a token about to expire is treated as already gone, which avoids that
 * predictable failure without adding a single extra call in the steady state.
 *
 * The 401 path still exists, because a token can also be revoked, and only the 401 will say so.
 */
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

/** Whether a cached token should still be used. */
export function isExpired(token: CachedToken | null | undefined, now: Date): boolean {
  if (!token?.accessToken) return true;
  return token.expiresAt.getTime() - TOKEN_EXPIRY_SKEW_MS <= now.getTime();
}

/**
 * When a token minted now will be treated as expired.
 *
 * FedEx returns `expires_in` in seconds. A missing or nonsensical value falls back to a
 * conservative five minutes rather than to an hour: guessing short costs one extra token call,
 * guessing long means every request failing until the fallback elapses.
 */
export function expiryFrom(expiresInSeconds: unknown, now: Date): Date {
  const n = Number(expiresInSeconds);
  const seconds = Number.isFinite(n) && n > 0 ? n : 300;
  return new Date(now.getTime() + seconds * 1000);
}

/** Sandbox and production differ in host as well as in credentials. */
export function baseUrlFor(environment: string): string {
  return environment === 'production' ? 'https://apis.fedex.com' : 'https://apis-sandbox.fedex.com';
}

/**
 * How a failed token request should be reported to a person.
 *
 * Three outcomes that look alike in a log and mean completely different things to whoever has just
 * pressed "Test connection":
 *
 *  - 401 — the keys are wrong. Their problem, and fixable on the screen they are looking at.
 *  - 429 — we called too often. OUR problem, and the worst thing they could do is press the button
 *    again, so the message says not to.
 *  - anything else — FedEx or the network. Nobody's keys are wrong; waiting is the right move.
 *
 * A single "connection failed" for all three sends somebody to re-type a perfectly good key, which
 * on a throttled endpoint makes the real cause worse.
 */
export function describeTokenFailure(status: number, body?: string): string {
  if (status === 401 || status === 403) {
    return 'FedEx rejected these credentials. Check the API key and secret, and that they belong to the same environment as the one selected.';
  }
  if (status === 429) {
    return 'FedEx is rate-limiting our token requests. Wait ten minutes before trying again — repeating the attempt extends the block.';
  }
  if (status >= 500) {
    return `FedEx returned ${status}. That is their side, not our credentials — try again shortly.`;
  }
  const detail = (body ?? '').trim().slice(0, 200);
  return detail ? `FedEx refused the token request (${status}): ${detail}` : `FedEx refused the token request (${status}).`;
}

/**
 * The cache key for a token.
 *
 * Per account AND per environment. Two accounts sharing one token would be a billing error waiting
 * to happen, and a sandbox token used against production fails in a way that reads like broken
 * credentials rather than a wrong host.
 */
export function tokenCacheKey(accountId: string, environment: string): string {
  return `${accountId}:${environment}`;
}

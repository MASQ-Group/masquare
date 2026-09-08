import { describe, expect, it } from 'vitest';
import {
  TOKEN_EXPIRY_SKEW_MS,
  baseUrlFor,
  describeTokenFailure,
  expiryFrom,
  isExpired,
  tokenCacheKey,
} from './fedex-token';

/**
 * The FedEx token endpoint is the one place in this integration where getting it wrong takes the
 * whole thing down rather than failing one request.
 *
 * It allows roughly one sustained request per second, counted per IP, and answers a breach with a
 * ten-minute ban that lengthens on repeat. Per IP means every carrier account on the server shares
 * one budget: one badly-behaved loop blocks every company at once. These tests exist because that
 * failure is invisible in development, where nobody makes enough calls to trip it.
 */

const NOW = new Date('2026-09-08T12:00:00Z');
const at = (msFromNow: number) => new Date(NOW.getTime() + msFromNow);

describe('reusing a cached token', () => {
  it('keeps using a token with plenty of life left', () => {
    // The whole point of the cache. A token good for another half hour must not be re-minted.
    expect(isExpired({ accessToken: 't', expiresAt: at(30 * 60_000) }, NOW)).toBe(false);
  });

  it('treats a token in its last minute as already gone', () => {
    // Deliberate divergence from FedEx's "refresh on 401" advice, and the only one. Taken literally
    // that guidance spends one failed request on every expiry. Retiring the token a minute early
    // avoids a wholly predictable failure and costs nothing in the steady state.
    expect(isExpired({ accessToken: 't', expiresAt: at(TOKEN_EXPIRY_SKEW_MS - 1) }, NOW)).toBe(true);
    expect(isExpired({ accessToken: 't', expiresAt: at(TOKEN_EXPIRY_SKEW_MS + 1000) }, NOW)).toBe(false);
  });

  it('treats an absent or empty token as expired rather than throwing', () => {
    expect(isExpired(null, NOW)).toBe(true);
    expect(isExpired({ accessToken: '', expiresAt: at(60 * 60_000) }, NOW)).toBe(true);
  });
});

describe('working out when a new token dies', () => {
  it('uses the seconds FedEx gave us', () => {
    expect(expiryFrom(3600, NOW)).toEqual(at(3600 * 1000));
  });

  it('falls back short, not long, when the answer makes no sense', () => {
    // Guessing short costs one extra token call. Guessing long means every request failing until
    // the guess runs out — with no way to tell that is what is happening.
    for (const bad of [undefined, null, 'soon', 0, -5, NaN]) {
      expect(expiryFrom(bad, NOW)).toEqual(at(300 * 1000));
    }
  });
});

describe('sandbox and production are different places', () => {
  it('sends production to the production host and everything else to sandbox', () => {
    expect(baseUrlFor('production')).toBe('https://apis.fedex.com');
    expect(baseUrlFor('sandbox')).toBe('https://apis-sandbox.fedex.com');
  });

  it('defaults an unrecognised environment to sandbox', () => {
    // Failing safe. An unknown value reaching production would put real shipments and real charges
    // behind a setting nobody meant to make; the same mistake against sandbox costs nothing.
    expect(baseUrlFor('')).toBe('https://apis-sandbox.fedex.com');
    expect(baseUrlFor('staging')).toBe('https://apis-sandbox.fedex.com');
  });

  it('never lets two accounts, or two environments, share one cached token', () => {
    // A shared token is a shipment billed to the wrong account; a sandbox token sent to production
    // fails in a way that reads like a broken credential rather than a wrong host.
    expect(tokenCacheKey('a', 'sandbox')).not.toBe(tokenCacheKey('b', 'sandbox'));
    expect(tokenCacheKey('a', 'sandbox')).not.toBe(tokenCacheKey('a', 'production'));
  });
});

describe('what a person is told when the token request fails', () => {
  it('says the keys are wrong when the keys are wrong', () => {
    expect(describeTokenFailure(401)).toMatch(/credentials/i);
    expect(describeTokenFailure(403)).toMatch(/credentials/i);
  });

  it('mentions the environment on a rejection, which is the commonest cause', () => {
    // A sandbox key against production is rejected exactly like a wrong key. Somebody who is not
    // told to check will re-type a perfectly good secret.
    expect(describeTokenFailure(401)).toMatch(/environment/i);
  });

  it('tells the reader NOT to retry after a throttle', () => {
    // The single most important message here. Pressing the button again is the natural response and
    // is precisely what extends the ban — and the ban is per IP, so it lands on everybody.
    const msg = describeTokenFailure(429);
    expect(msg).toMatch(/ten minutes/i);
    expect(msg).toMatch(/extends the block/i);
  });

  it('does not blame our credentials for their outage', () => {
    // A 503 that reads as "check your keys" sends somebody to break a working configuration.
    expect(describeTokenFailure(503)).toMatch(/their side/i);
    expect(describeTokenFailure(503)).not.toMatch(/check the API key/i);
  });

  it('passes through what FedEx said on anything else, trimmed', () => {
    expect(describeTokenFailure(400, 'grant_type is required')).toContain('grant_type is required');
    expect(describeTokenFailure(400, 'x'.repeat(500)).length).toBeLessThan(300);
  });
});

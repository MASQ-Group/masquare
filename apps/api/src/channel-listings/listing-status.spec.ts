import { describe, expect, it } from 'vitest';
import { deriveListingStatus } from './listing-status';

/**
 * Amazon's answer about whether a listing can be bought must survive into the grid.
 *
 * Found on 5 Sep 2026 while checking IT68277 across the marketplaces: Amazon UK returned an EMPTY
 * status for it — the listing is off — and the Channel Listings grid showed it as **Live**. The
 * buyability test read `if (s && !s.includes('BUYABLE'))`, and the empty string is falsy, so the
 * check skipped itself precisely when the listing was at its most dead.
 *
 * Same family as the bug that started all this: the platform reporting a listing as fine while
 * Amazon says otherwise.
 */
describe('derived listing status', () => {
  const row = (o: Partial<Parameters<typeof deriveListingStatus>[0]>) =>
    deriveListingStatus({ listedQuantity: 10, listingStatus: 'BUYABLE,DISCOVERABLE', fulfilmentChannel: 'FBM', ...o });

  describe('buyability is settled before anything else', () => {
    it('calls an EMPTY Amazon status paused, not live', () => {
      // The regression. `[]` is Amazon saying the listing is off.
      expect(row({ listingStatus: '', listedQuantity: null, fulfilmentChannel: null })).toBe('paused');
      expect(row({ listingStatus: '', listedQuantity: 10 })).toBe('paused');
    });

    it('calls DISCOVERABLE-without-BUYABLE paused', () => {
      // IT68277 on Amazon ES: on the catalogue, cannot be bought, product-safety violation.
      expect(row({ listingStatus: 'DISCOVERABLE' })).toBe('paused');
    });

    it('does not let FBA stock make an unbuyable listing look live', () => {
      // The FBA short-circuit used to run first and return 'live' before status was consulted.
      expect(row({ listingStatus: 'DISCOVERABLE', fulfilmentChannel: 'FBA' })).toBe('paused');
      expect(row({ listingStatus: '', fulfilmentChannel: 'FBA' })).toBe('paused');
    });

    it('does not let an empty status outrank a real out-of-stock', () => {
      // Both are true; "cannot be bought at all" is the more useful thing to say.
      expect(row({ listingStatus: '', listedQuantity: 0 })).toBe('paused');
    });
  });

  describe('a channel that reports no status at all falls through', () => {
    it('treats null as "not told", not as "inactive"', () => {
      // eBay and OnBuy never set listingStatus. Reading null as inactive would paint every one of
      // their rows paused — which is why the check is on null, not on emptiness.
      expect(row({ listingStatus: null, listedQuantity: 10 })).toBe('live');
      expect(row({ listingStatus: null, listedQuantity: 0 })).toBe('oos');
      expect(row({ listingStatus: null, listedQuantity: 3 })).toBe('low');
    });
  });

  describe('a buyable listing is graded on stock', () => {
    it('is live with healthy stock', () => {
      expect(row({ listedQuantity: 10 })).toBe('live');
    });

    it('is out of stock at zero or less', () => {
      expect(row({ listedQuantity: 0 })).toBe('oos');
      expect(row({ listedQuantity: -1 })).toBe('oos');
    });

    it('is low at five or fewer', () => {
      expect(row({ listedQuantity: 5 })).toBe('low');
      expect(row({ listedQuantity: 1 })).toBe('low');
      expect(row({ listedQuantity: 6 })).toBe('live');
    });

    it('is live on FBA regardless of the quantity we hold', () => {
      // Amazon owns that number; ours is not evidence of anything.
      expect(row({ fulfilmentChannel: 'FBA', listedQuantity: 0 })).toBe('live');
    });

    it('is live when the quantity is unknown', () => {
      expect(row({ listedQuantity: null })).toBe('live');
    });
  });

  it('never reports a listing Amazon will not sell as live', () => {
    // Over the space, so no future branch can reintroduce the gap.
    for (const listingStatus of ['', 'DISCOVERABLE', 'discoverable']) {
      for (const fulfilmentChannel of ['FBM', 'FBA', null]) {
        for (const listedQuantity of [null, 0, 3, 99]) {
          expect(deriveListingStatus({ listingStatus, fulfilmentChannel, listedQuantity })).toBe('paused');
        }
      }
    }
  });
});

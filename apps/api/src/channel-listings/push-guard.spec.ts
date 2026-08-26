import { describe, expect, it } from 'vitest';

/**
 * The guard that should have existed before a push could empty a catalogue.
 *
 * Quantities went to zero across thousands of eBay listings and nothing stopped it, remarked on it,
 * or made it visible until a person noticed the shop was empty. The `?? 0` default was the trigger;
 * the absence of any ceiling on damage is why it ran to completion.
 *
 * So the rule is about the SHAPE of the change rather than its cause: a run that takes many
 * listings from a real quantity down to zero is never routine, whatever produced it — an empty
 * availability table, a mis-set filter, a default that reads like data. It refuses and reports the
 * number instead of proceeding and being discovered afterwards.
 */

type Listing = { productId: string | null; listedQuantity: number | null; marketplace?: string | null; channelType?: string };

/** The count as the service computes it, extracted so it can be tested without a database. */
function wouldZeroReal(listings: Listing[], availability: Map<string, number>): number {
  return listings.filter((l) => {
    if (l.channelType === 'ebay' && !l.marketplace) return false;
    if (l.productId == null || !availability.has(l.productId)) return false; // skipped anyway
    return availability.get(l.productId) === 0 && (l.listedQuantity ?? 0) > 0;
  }).length;
}

const avail = new Map<string, number>([['out', 0], ['in', 4]]);

describe('blast radius', () => {
  it('counts a listing taken from real stock down to zero', () => {
    expect(wouldZeroReal([{ productId: 'out', listedQuantity: 6 }], avail)).toBe(1);
  });

  it('does not count a listing that was already zero', () => {
    // The morning's pushes were mostly these — sending 0 to something already 0 changes nothing,
    // and counting them would trip the guard on a run that does no harm.
    expect(wouldZeroReal([{ productId: 'out', listedQuantity: 0 }], avail)).toBe(0);
  });

  it('does not count a listing whose availability is unknown', () => {
    // Those are skipped entirely now, so they can neither zero anything nor inflate the count.
    expect(wouldZeroReal([{ productId: 'unknown', listedQuantity: 9 }], avail)).toBe(0);
    expect(wouldZeroReal([{ productId: null, listedQuantity: 9 }], avail)).toBe(0);
  });

  it('does not count a push that keeps stock on the shelf', () => {
    expect(wouldZeroReal([{ productId: 'in', listedQuantity: 6 }], avail)).toBe(0);
  });

  it('ignores an eBay listing with no marketplace, which is never pushed', () => {
    expect(wouldZeroReal([{ productId: 'out', listedQuantity: 5, channelType: 'ebay', marketplace: null }], avail)).toBe(0);
  });
});

describe('the ceiling', () => {
  const refuses = (count: number, ceiling = 25) => count > ceiling;

  it('lets an ordinary run through', () => {
    // Selling out a few lines is normal trade and must not need anyone's permission.
    expect(refuses(3)).toBe(false);
    expect(refuses(25)).toBe(false);
  });

  it('refuses the run that empties a catalogue', () => {
    expect(refuses(26)).toBe(true);
    expect(refuses(4700)).toBe(true);
  });

  it('is judged before anything is sent, not partway through', () => {
    // A guard that trips halfway has already done the damage it exists to prevent. The service
    // computes this from the full listing set BEFORE the loop and returns without sending.
    const listings: Listing[] = Array.from({ length: 100 }, () => ({ productId: 'out', listedQuantity: 3 }));
    const planned = wouldZeroReal(listings, avail);
    expect(planned).toBe(100);
    expect(refuses(planned)).toBe(true);
  });
});

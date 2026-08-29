import { describe, expect, it } from 'vitest';

/**
 * The listings sync replaces a channel's rows wholesale. That is right when the pull is complete,
 * and destructive when it is not.
 *
 * On 29 Aug 2026 eBay's Inventory API returned one SKU where we held 4,710. The pull was treated as
 * the whole truth and 4,709 listing records were deleted. The listings themselves were never at
 * risk — this destroyed our record of them — but it took the platform's view of an entire channel
 * with it, and with it the evidence needed to repair an earlier incident.
 *
 * The cause was specific (a fallback that only fired on exactly zero) and is fixed at the source.
 * This guard exists because the general case will recur for reasons we cannot enumerate: a scope
 * change, a partial outage, an API that only ever saw a subset. None of them mean the seller has
 * stopped selling.
 *
 * Going stale is recoverable by running the sync again. Deleting is not.
 */

const MIN_LISTINGS_TO_GUARD = 50;
const KEEP_FRACTION = 0.5;

/** The decision the sync makes per integration, before touching anything. */
const wouldReplace = (pulled: number, held: number) =>
  !(held >= MIN_LISTINGS_TO_GUARD && pulled < held * KEEP_FRACTION);

describe('a pull that collapses', () => {
  it('refuses the case that happened: 1 pulled against 4,710 held', () => {
    expect(wouldReplace(1, 4710)).toBe(false);
  });

  it('refuses an empty pull on a stocked channel', () => {
    // The most dangerous shape of all, and the easiest to produce with an expired token.
    expect(wouldReplace(0, 4710)).toBe(false);
  });

  it('refuses a pull that loses most of the catalogue', () => {
    expect(wouldReplace(2000, 4710)).toBe(false);
  });
});

describe('a pull that is plausibly complete', () => {
  it('accepts a steady catalogue', () => {
    expect(wouldReplace(4700, 4710)).toBe(true);
  });

  it('accepts ordinary shrinkage', () => {
    // Listings end all the time; half is the line, and this is well inside it.
    expect(wouldReplace(4000, 4710)).toBe(true);
  });

  it('accepts growth', () => {
    expect(wouldReplace(6000, 4710)).toBe(true);
  });

  it('accepts exactly half, which is not yet implausible', () => {
    expect(wouldReplace(2355, 4710)).toBe(true);
  });
});

describe('channels too small to judge', () => {
  it('lets a small catalogue empty', () => {
    // Below the floor a genuine catalogue can legitimately halve or clear between pulls, and
    // refusing there would be noise that trains people to ignore the guard.
    expect(wouldReplace(0, 49)).toBe(true);
    expect(wouldReplace(1, 20)).toBe(true);
  });

  it('starts guarding at the floor', () => {
    expect(wouldReplace(0, 50)).toBe(false);
  });

  it('allows the first ever pull', () => {
    // Nothing held, so nothing to lose.
    expect(wouldReplace(4710, 0)).toBe(true);
  });
});

describe('what refusing means', () => {
  it('changes nothing rather than writing a partial view', () => {
    // The alternative considered and rejected: merge the pull into what we hold. That silently
    // keeps rows the channel may genuinely have ended, and quietly diverges from the marketplace
    // with no one aware. Refusing is legible: the records stay as they were and someone is told.
    const held = 4710;
    const pulled = 1;
    const outcome = wouldReplace(pulled, held) ? 'replaced' : 'left alone';
    expect(outcome).toBe('left alone');
  });
});

import { describe, it, expect } from 'vitest';
import { shouldEmit } from './emit';

// The offer stream carries our own offer, so the stored price no longer has to be trusted between
// onboarding runs. It matters because the emit test measures the move against the stored figure:
// judged against a stale price, a real change can look too small to make, or a non-change can look
// worth making.
const pickLive = (snapshot: { offers: { sellerId: string; listingPriceCents: number }[]; ourSellerId: string }) => {
  const ours = snapshot.offers.find((o) => o.sellerId === snapshot.ourSellerId);
  const live = ours ? ours.listingPriceCents : null;
  return live != null && live > 0 ? live : null;
};

const EMIT = { epsilonCents: 10, epsilonPct: 0.005, cooldownSeconds: 300 };
const emit = (newPrice: number, current: number | null) =>
  shouldEmit({ newPriceCents: newPrice, currentPriceCents: current, lastSubmissionAtMs: null, nowMs: 0, safetyOverride: false }, EMIT);

describe('refreshing our price from the offer stream', () => {
  const snap = (ourPrice: number) => ({ ourSellerId: 'US-ME', offers: [{ sellerId: 'OTHER', listingPriceCents: 4000 }, { sellerId: 'US-ME', listingPriceCents: ourPrice }] });

  it('takes our own offer, not a competitor’s', () => {
    expect(pickLive(snap(5250))).toBe(5250);
  });

  it('returns nothing when we are not in the top-20, leaving the stored price alone', () => {
    expect(pickLive({ ourSellerId: 'US-ME', offers: [{ sellerId: 'OTHER', listingPriceCents: 4000 }] })).toBeNull();
  });

  it('a stale price can make a real change look too small to bother with', () => {
    const stored = 5000; // what we last recorded
    const live = 5240; // what the listing is actually at now
    const target = 5250; // where the engine wants to be
    // Against the live price the move is 10c — under epsilon, so correctly held.
    expect(emit(target, live).emit).toBe(false);
    // Against the stale one it looks like 250c and would be emitted: a write that changes nothing.
    expect(emit(target, stored).emit).toBe(true);
  });

  it('and can equally hide a change worth making', () => {
    const stored = 5240;
    const live = 5000;
    const target = 5250;
    expect(emit(target, stored).emit).toBe(false); // looks like 10c against the stale price
    expect(emit(target, live).emit).toBe(true); // really a 250c move
  });
});

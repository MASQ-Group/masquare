import { describe, expect, it } from 'vitest';
import { planTransition, SUBMISSION_GRACE_MS } from './plan-transition';

/**
 * What a sync does to a plan that was submitted to a channel.
 *
 * Sending a listing to Amazon and having a listing are not the same event, and there are minutes
 * between them. Through that window the Channel Listings page used to keep offering "+ List on
 * Amazon ES" for a request already in flight, which invites sending it twice.
 *
 * So the plan waits at SUBMITTED and the button stands down. This is the rule that ends the wait —
 * and it can only run where absence is EVIDENCE: a per-product query that named the SKU, or an
 * account pull known to be complete. Applying it to a truncated pull would release a submission
 * that actually worked, which is the paging-limit mistake wearing a different hat.
 */
describe('settling a submitted plan', () => {
  describe('the channel is carrying it', () => {
    it('confirms a plan that was waiting', () => {
      expect(planTransition({ status: 'SUBMITTED', found: true })).toBe('confirm');
    });

    it('confirms one listed outside the platform too', () => {
      // Someone may have listed it in Seller Central. The plan should still catch up with reality
      // rather than sit at DRAFT beside a live listing.
      expect(planTransition({ status: 'DRAFT', found: true })).toBe('confirm');
      expect(planTransition({ status: 'READY', found: true })).toBe('confirm');
    });

    it('does nothing when it is already recorded as listed', () => {
      // No write, so a routine sync does not churn every plan it passes.
      expect(planTransition({ status: 'LISTED', found: true })).toBe('none');
    });
  });

  describe('the channel does not have it', () => {
    it('releases a plan that was waiting, so the button comes back', () => {
      expect(planTransition({ status: 'SUBMITTED', found: false })).toBe('release');
    });

    it('leaves a plan that was never waiting alone', () => {
      expect(planTransition({ status: 'DRAFT', found: false })).toBe('none');
      expect(planTransition({ status: 'READY', found: false })).toBe('none');
    });

    it('does NOT quietly un-list a plan recorded as listed', () => {
      // A listing that has gone missing is a real event worth noticing, not something to paper
      // over by resetting the plan. The listing records already carry that story.
      expect(planTransition({ status: 'LISTED', found: false })).toBe('none');
    });

    it('ignores a status it does not recognise', () => {
      expect(planTransition({ status: 'ARCHIVED', found: false })).toBe('none');
      expect(planTransition({ status: '', found: false })).toBe('none');
    });
  });

  describe('a submission Amazon has not published yet', () => {
    const NOW = new Date('2026-09-06T12:00:00Z');
    const agoMs = (ms: number) => new Date(NOW.getTime() - ms);

    it('leaves a submission made moments ago alone', () => {
      // The bug this exists for. Listing a product and then syncing — the obvious next thing, and
      // the button sits right beside the one that just listed — asks Amazon about an offer it has
      // accepted and not yet published. "Not yet" was being read as "never": the plan went back to
      // DRAFT, the amber "Listing requested" never appeared, and the green button returned, so the
      // same offer could be sent twice.
      expect(planTransition({ status: 'SUBMITTED', found: false, listedAt: agoMs(60_000), now: NOW })).toBe('none');
    });

    it('still releases one that has had its time', () => {
      // The wait cannot be indefinite, or a genuinely failed submission blocks the channel forever.
      expect(planTransition({
        status: 'SUBMITTED', found: false, listedAt: agoMs(SUBMISSION_GRACE_MS + 1_000), now: NOW,
      })).toBe('release');
    });

    it('holds right up to the boundary and releases just past it', () => {
      const inside = planTransition({ status: 'SUBMITTED', found: false, listedAt: agoMs(SUBMISSION_GRACE_MS - 1), now: NOW });
      const outside = planTransition({ status: 'SUBMITTED', found: false, listedAt: agoMs(SUBMISSION_GRACE_MS), now: NOW });
      expect(inside).toBe('none');
      expect(outside).toBe('release');
    });

    it('confirms a fresh submission the moment the channel has it', () => {
      // The grace period delays only the RELEASE. Good news is never held back.
      expect(planTransition({ status: 'SUBMITTED', found: true, listedAt: agoMs(1_000), now: NOW })).toBe('confirm');
    });

    it('treats a missing submission time as long ago, not as recent', () => {
      // A SUBMITTED plan with no listedAt is already inconsistent. Reading it as "just now" would
      // strand the channel at SUBMITTED forever and it could never be offered again.
      expect(planTransition({ status: 'SUBMITTED', found: false, listedAt: null, now: NOW })).toBe('release');
      expect(planTransition({ status: 'SUBMITTED', found: false, now: NOW })).toBe('release');
    });

    it('does not hold a DRAFT just because it has a stale listedAt', () => {
      // Only a plan actually waiting on a submission is subject to any of this.
      expect(planTransition({ status: 'DRAFT', found: false, listedAt: agoMs(1_000), now: NOW })).toBe('none');
    });
  });

  it('only ever releases a plan that was submitted', () => {
    // The property worth stating over the whole space: nothing else can be released, so no other
    // state can be reset by a sync.
    for (const status of ['DRAFT', 'READY', 'LISTED', 'ARCHIVED', 'SUBMITTED', '']) {
      for (const found of [true, false]) {
        if (planTransition({ status, found }) === 'release') {
          expect(status).toBe('SUBMITTED');
          expect(found).toBe(false);
        }
      }
    }
  });
});

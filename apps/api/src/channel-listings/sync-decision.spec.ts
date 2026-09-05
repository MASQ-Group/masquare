import { describe, expect, it } from 'vitest';
import { syncDecision, MIN_LISTINGS_TO_GUARD, KEEP_FRACTION } from './sync-decision';

/**
 * A listings sync may only delete on the strength of an answer it has reason to trust.
 *
 * Both failures this guards actually happened.
 *
 * 5 Sep 2026 — Amazon ES: SKU IT68277 was live on Amazon and Inactive with a product-safety
 * (GPSR) violation, and the platform offered Amazon ES as somewhere we could go and list it.
 * Amazon reported 1,013 listings for the account but stopped paginating at 1,000; the sync read
 * that truncated answer as the whole truth, deleted the 13 it had not seen, and the product read
 * as "not listed there" everywhere downstream. Four other marketplaces were losing listings the
 * same way — 484 in total (ES 13, IT 40, NL 258, PL 171, SE 2).
 *
 * 29 Aug 2026 — eBay: the Inventory API returned 1 SKU where we held 4,710, and the replace
 * deleted 4,709 listing records.
 *
 * The two need different answers, which is the whole point of this function: a truncation still
 * carries a thousand good updates and must not be thrown away, while a collapse is not evidence
 * of anything and must not be acted on.
 */
describe('what a sync may do with what it pulled', () => {
  describe('a complete pull is authoritative', () => {
    it('replaces when the channel confirms we got everything', () => {
      expect(syncDecision({ received: 1013, reportedTotal: 1013, held: 1000 }).mode).toBe('replace');
    });

    it('replaces when the channel does not report a total at all', () => {
      // eBay and OnBuy cannot say. They fall back to the collapse guard alone, which is why that
      // guard stays rather than being replaced by the count check.
      expect(syncDecision({ received: 900, reportedTotal: null, held: 1000 }).mode).toBe('replace');
    });

    it('still replaces when the pull legitimately shrank', () => {
      // Genuinely delisting items is normal and must keep working, or the records never shed
      // anything and every removed listing lingers forever.
      expect(syncDecision({ received: 800, reportedTotal: 800, held: 1000 }).mode).toBe('replace');
    });

    it('replaces when the channel returns MORE than it claimed', () => {
      // A total that lags the item list is Amazon being approximate, not us being short.
      expect(syncDecision({ received: 1005, reportedTotal: 1000, held: 1000 }).mode).toBe('replace');
    });
  });

  describe('a truncated pull updates but never deletes', () => {
    it('is the Amazon ES case: 1,000 received of 1,013', () => {
      const d = syncDecision({ received: 1000, reportedTotal: 1013, held: 1000 });
      expect(d.mode).toBe('update-only');
      expect(d.shortBy).toBe(13); // the 13 that included IT68277
    });

    it('holds for the worst marketplace, where a quarter was unreachable', () => {
      const d = syncDecision({ received: 1000, reportedTotal: 1258, held: 1000 }); // Amazon NL
      expect(d.mode).toBe('update-only');
      expect(d.shortBy).toBe(258);
    });

    it('catches a shortfall of one, because one live listing is one too many', () => {
      expect(syncDecision({ received: 999, reportedTotal: 1000, held: 999 }).mode).toBe('update-only');
    });

    it('would have been the old behaviour: a truncation sails past the collapse guard', () => {
      // 1,000 of 1,013 is 98.7% of what we hold — nowhere near the 50% that triggers a refusal.
      // That is exactly why the count check had to be added: the proportional guard cannot see it.
      const truncated = { received: 1000, held: 1000 };
      expect(truncated.received >= truncated.held * KEEP_FRACTION).toBe(true);
      expect(syncDecision({ ...truncated, reportedTotal: 1013 }).mode).toBe('update-only');
    });
  });

  describe('a collapsed pull changes nothing', () => {
    it('is the eBay case: 1 returned against 4,710 on record', () => {
      expect(syncDecision({ received: 1, reportedTotal: null, held: 4710 }).mode).toBe('refuse');
    });

    it('refuses even when the channel claims that collapse is the true total', () => {
      // A channel that has gone wrong may under-report its total too. Between "change nothing" and
      // "write a suspicious answer", changing nothing is recoverable and the other is not.
      expect(syncDecision({ received: 1, reportedTotal: 1, held: 4710 }).mode).toBe('refuse');
    });

    it('leaves a small channel alone, where proportions mean nothing', () => {
      // 3 of 10 is a collapse in proportion and routine in a channel this size, so the guard does
      // not apply below the threshold.
      expect(syncDecision({ received: 3, reportedTotal: null, held: 10 }).mode).toBe('replace');
      expect(MIN_LISTINGS_TO_GUARD).toBeGreaterThan(10);
    });

    it('draws the collapse line at exactly half', () => {
      expect(syncDecision({ received: 50, reportedTotal: null, held: 100 }).mode).toBe('replace');
      expect(syncDecision({ received: 49, reportedTotal: null, held: 100 }).mode).toBe('refuse');
    });
  });

  it('never deletes on any answer the channel called short', () => {
    // The property that matters, stated once over the whole space rather than case by case.
    for (const held of [0, 60, 1000, 5000]) {
      for (const total of [10, 1000, 1013, 4710]) {
        for (const received of [0, 1, 49, 999, 1000, 1013]) {
          if (received >= total) continue; // not short
          expect(syncDecision({ received, reportedTotal: total, held }).mode).not.toBe('replace');
        }
      }
    }
  });
});

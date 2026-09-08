import { describe, expect, it } from 'vitest';
import { competitionUpdate, type StoredCompetition } from './availability-record';

/**
 * What a check may say about the competition, and — more importantly — what it may erase.
 *
 * Two facts share one row: whether Amazon would accept a listing, and whether we could sell at a
 * profit. They are gathered by different calls at different rates. The catalogue answer is cheap and
 * refreshed nightly; the price read costs a throttled call and is made only when somebody asks. A
 * rule that let the cheap one overwrite the expensive one would quietly discard the expensive one
 * every night.
 */

const NOW = new Date('2026-09-08T09:00:00Z');
const EARLIER = new Date('2026-09-01T09:00:00Z');

const stored = (over: Partial<StoredCompetition> = {}): StoredCompetition => ({
  asin: 'B001',
  competitive: false,
  competitionCheckedAt: EARLIER,
  featuredPriceCents: 7057,
  featuredMarginPct: -0.12,
  currency: 'EUR',
  ...over,
});

describe('a check that priced', () => {
  it('writes what it found, dated now', () => {
    const patch = competitionUpdate(stored(), 'B001', {
      competitive: true, featuredPriceCents: 13299, featuredMarginPct: 0.21, currency: 'EUR',
    }, NOW);
    expect(patch).toEqual({
      competitive: true, competitionCheckedAt: NOW,
      featuredPriceCents: 13299, featuredMarginPct: 0.21, currency: 'EUR',
    });
  });

  it('dates a refusal too, so "asked and got nothing" is not "never asked"', () => {
    // Amazon returned no featured offer, or would not answer. The date is the whole record here:
    // without it the row is indistinguishable from one nobody has ever priced.
    const patch = competitionUpdate(stored(), 'B001', {
      competitive: null, featuredPriceCents: null, featuredMarginPct: null, currency: 'EUR',
    }, NOW);
    expect(patch.competitive).toBeNull();
    expect(patch.competitionCheckedAt).toEqual(NOW);
  });
});

describe('a check that did not price', () => {
  it('leaves a stored verdict alone when the ASIN is unchanged', () => {
    // The nightly sweep runs without pricing. Clearing here would throw away a read somebody spent
    // a throttled call on, every single night, and the grid would never show a verdict for long.
    expect(competitionUpdate(stored(), 'B001', undefined, NOW)).toEqual({});
  });

  it('clears it when the ASIN has changed', () => {
    // Not a stale answer to this question — an answer to a different one. Carrying it over would
    // attach one product's competition to another's.
    const patch = competitionUpdate(stored(), 'B999', undefined, NOW);
    expect(patch).toEqual({
      competitive: null, competitionCheckedAt: null,
      featuredPriceCents: null, featuredMarginPct: null, currency: null,
    });
  });

  it('clears it when the catalogue entry has gone', () => {
    // found: false arrives as a null ASIN. There is nothing left for the verdict to be about.
    expect(competitionUpdate(stored(), null, undefined, NOW).competitive).toBeNull();
  });

  it('writes nothing on a row that was never priced', () => {
    // No stored read to protect and none to clear — the columns should not be touched at all.
    expect(competitionUpdate(stored({ competitionCheckedAt: null, competitive: null }), 'B002', undefined, NOW)).toEqual({});
  });

  it('writes nothing on a brand new row', () => {
    expect(competitionUpdate(null, 'B001', undefined, NOW)).toEqual({});
  });
});

describe('what the grid may claim', () => {
  /**
   * The rendering rule, stated once here because it is the point of the whole feature: only `false`
   * is a warning. Null covers both "never asked" and "Amazon refused", and neither is a verdict.
   */
  const showsNotCompetitive = (canList: boolean, competitive: boolean | null) => canList && competitive === false;

  it('warns only where we actually know we would lose', () => {
    expect(showsNotCompetitive(true, false)).toBe(true);
    expect(showsNotCompetitive(true, true)).toBe(false);
    expect(showsNotCompetitive(true, null)).toBe(false);
  });

  it('says nothing about competition where we cannot list at all', () => {
    // "Needs approval" is the answer that matters there; a price verdict beside it is noise.
    expect(showsNotCompetitive(false, false)).toBe(false);
  });
});

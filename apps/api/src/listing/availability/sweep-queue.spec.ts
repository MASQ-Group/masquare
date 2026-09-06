import { describe, expect, it } from 'vitest';
import { coverage, nextBatch, pairKey, type SweepPair } from './sweep-queue';

const SETTINGS = { batchSize: 3, intervalMinutes: 120, recheckDays: 30 };
const NOW = new Date('2026-09-06T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const pair = (productId: string, integrationId: string, checkedAt: Date | null = null): SweepPair =>
  ({ productId, integrationId, checkedAt });

describe('choosing the next batch', () => {
  it('asks about pairs nobody has ever asked about first', () => {
    // Even when the answered ones are old. A never-asked pair is a hole in the page; an old answer
    // is still an answer.
    const batch = nextBatch(
      [pair('p1', 'i1', daysAgo(200)), pair('p2', 'i1', null), pair('p3', 'i1', daysAgo(100))],
      new Set(),
      SETTINGS,
      NOW,
    );
    expect(batch[0].productId).toBe('p2');
  });

  it('then takes the oldest answers', () => {
    const batch = nextBatch(
      [pair('p1', 'i1', daysAgo(40)), pair('p2', 'i1', daysAgo(200)), pair('p3', 'i1', daysAgo(90))],
      new Set(),
      SETTINGS,
      NOW,
    );
    expect(batch.map((p) => p.productId)).toEqual(['p2', 'p3', 'p1']);
  });

  it('leaves out pairs answered inside the re-check window', () => {
    const batch = nextBatch([pair('p1', 'i1', daysAgo(2))], new Set(), SETTINGS, NOW);
    expect(batch).toEqual([]);
  });

  it('does not ask where we already sell it', () => {
    // The caller's instruction, and the largest single saving: about a third of all pairs are
    // already listed, and the listings table already answers for them.
    const batch = nextBatch(
      [pair('p1', 'i1'), pair('p2', 'i1')],
      new Set([pairKey({ productId: 'p1', integrationId: 'i1' })]),
      SETTINGS,
      NOW,
    );
    expect(batch.map((p) => p.productId)).toEqual(['p2']);
  });

  it('excludes an already-listed pair even when it has never been checked', () => {
    // Never-checked wins the ordering, so if the listed filter ran after the sort rather than
    // before it, this is the pair that would slip through.
    const batch = nextBatch(
      [pair('p1', 'i1', null)],
      new Set([pairKey({ productId: 'p1', integrationId: 'i1' })]),
      SETTINGS,
      NOW,
    );
    expect(batch).toEqual([]);
  });

  it('only excludes that product on that marketplace', () => {
    // Listed on ES says nothing about IT. Keying on the product alone would silently stop checking
    // every marketplace for anything we sell anywhere.
    const batch = nextBatch(
      [pair('p1', 'i1'), pair('p1', 'i2')],
      new Set([pairKey({ productId: 'p1', integrationId: 'i1' })]),
      SETTINGS,
      NOW,
    );
    expect(batch.map((p) => p.integrationId)).toEqual(['i2']);
  });

  it('never returns more than one batch', () => {
    const many = Array.from({ length: 50 }, (_, i) => pair(`p${i}`, 'i1'));
    expect(nextBatch(many, new Set(), SETTINGS, NOW)).toHaveLength(3);
  });

  it('takes nothing when the batch size is zero', () => {
    // A batch of zero is how someone pauses without switching the whole thing off, so it must mean
    // no work rather than fall through to a default.
    expect(nextBatch([pair('p1', 'i1')], new Set(), { ...SETTINGS, batchSize: 0 }, NOW)).toEqual([]);
  });
});

describe('what the configured rate actually achieves', () => {
  it('reports the real length of a full pass', () => {
    // 40 pairs every 2 hours = 480 a day; 16,000 pairs is 34 days.
    const c = coverage(16_000, { batchSize: 40, intervalMinutes: 120, recheckDays: 30 });
    expect(c.pairsPerDay).toBe(480);
    expect(c.fullPassDays).toBe(34);
  });

  it('says so when the rate cannot keep the re-check promise', () => {
    // The setting says 30 days; the numbers say 34. Someone reading "re-check every 30 days" would
    // otherwise never learn the difference.
    expect(coverage(16_000, { batchSize: 40, intervalMinutes: 120, recheckDays: 30 }).behind).toBe(true);
    expect(coverage(16_000, { batchSize: 60, intervalMinutes: 120, recheckDays: 30 }).behind).toBe(false);
  });

  it('does not claim a pass will ever finish at a rate of nothing', () => {
    expect(coverage(16_000, { batchSize: 0, intervalMinutes: 120, recheckDays: 30 }).fullPassDays).toBe(Infinity);
  });
});

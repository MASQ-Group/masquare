import { describe, expect, it } from 'vitest';
import { spanOf, stride, summariseBySku, summarisePeriod, totalsOf, type DailyRow } from './report-fold';

const day = (d: string) => new Date(`2026-09-${d}T00:00:00Z`);

const row = (d: string, over: Partial<DailyRow> = {}): DailyRow => ({
  day: day(d),
  sku: 'SKU-1',
  marketplaceId: 'A1F83G8C2ARO7P',
  evaluations: 0, priced: 0, held: 0, skipped: 0, quarantined: 0, vetoed: 0,
  priceChanges: 0,
  priceOpenCents: null, priceCloseCents: null, priceMinCents: null, priceMaxCents: null,
  buyBoxSamples: 0, buyBoxWon: 0, atFloorSamples: 0,
  unitsSold: 0, revenueCents: 0, profitCents: null, feeBasis: null, unitsAfterChange: 0,
  currency: 'GBP',
  ...over,
});

describe('summarisePeriod — the work done', () => {
  it('adds up the outcomes and the changes', () => {
    const s = summarisePeriod([
      row('01', { evaluations: 10, priced: 2, held: 7, skipped: 1, priceChanges: 2 }),
      row('02', { evaluations: 6, priced: 1, held: 5, vetoed: 1, priceChanges: 1 }),
    ]);
    expect(s).toMatchObject({ days: 2, evaluations: 16, priced: 3, held: 12, skipped: 1, vetoed: 1, priceChanges: 3 });
  });

  it('takes the period from the days it was given, however they arrive', () => {
    const s = summarisePeriod([row('03'), row('01'), row('02')]);
    expect(s.firstDay).toEqual(day('01'));
    expect(s.lastDay).toEqual(day('03'));
  });
});

describe('summarisePeriod — price', () => {
  it('opens at the first price known and closes at the last', () => {
    const s = summarisePeriod([
      row('01', { priceOpenCents: 2600, priceCloseCents: 2500, priceMinCents: 2500, priceMaxCents: 2600 }),
      row('02', { priceOpenCents: 2500, priceCloseCents: 2400, priceMinCents: 2400, priceMaxCents: 2500 }),
    ]);
    expect(s).toMatchObject({ priceOpenCents: 2600, priceCloseCents: 2400, priceMinCents: 2400, priceMaxCents: 2600 });
  });

  /** A quiet final day has no close of its own, and must not erase the price the period ended at. */
  it('ignores days that carried no price', () => {
    const s = summarisePeriod([row('01', { priceOpenCents: 2600, priceCloseCents: 2400 }), row('02', { evaluations: 3 })]);
    expect(s.priceCloseCents).toBe(2400);
  });

  it('shows the move from open to close as a percentage', () => {
    expect(summarisePeriod([row('01', { priceOpenCents: 2000, priceCloseCents: 1800 })]).priceMovePct).toBe(-10);
  });

  it('has no opinion on a move it cannot see both ends of', () => {
    expect(summarisePeriod([row('01', { evaluations: 2 })]).priceMovePct).toBeNull();
  });
});

describe('summarisePeriod — market position', () => {
  it('rates Buy Box wins and floor time against the samples taken', () => {
    const s = summarisePeriod([
      row('01', { buyBoxSamples: 8, buyBoxWon: 6, atFloorSamples: 2 }),
      row('02', { buyBoxSamples: 2, buyBoxWon: 0, atFloorSamples: 0 }),
    ]);
    expect(s).toMatchObject({ buyBoxSamples: 10, buyBoxWon: 6, buyBoxWinPct: 60, atFloorPct: 20 });
  });

  /** Never looking and never winning are different facts; only one is a problem. */
  it('reports no rate at all when nothing was sampled', () => {
    const s = summarisePeriod([row('01', { evaluations: 4 })]);
    expect(s.buyBoxWinPct).toBeNull();
    expect(s.atFloorPct).toBeNull();
  });
});

describe('summarisePeriod — money', () => {
  it('adds sales and works the margin out from the totals', () => {
    const s = summarisePeriod([
      row('01', { unitsSold: 2, revenueCents: 6000, profitCents: 1800, feeBasis: 'actual' }),
      row('02', { unitsSold: 1, revenueCents: 3000, profitCents: 600, feeBasis: 'actual' }),
    ]);
    expect(s).toMatchObject({ unitsSold: 3, revenueCents: 9000, profitCents: 2400, marginPct: 26.7, feeBasis: 'actual' });
  });

  it('reports no profit rather than zero when nothing sold', () => {
    const s = summarisePeriod([row('01', { evaluations: 5 })]);
    expect(s.profitCents).toBeNull();
    expect(s.marginPct).toBeNull();
    expect(s.feeBasis).toBeNull();
  });

  /** Fees settle days later, so a span usually straddles settled and estimated days. Say so. */
  it('says when the span mixes settled and estimated fees', () => {
    const s = summarisePeriod([
      row('01', { unitsSold: 1, revenueCents: 3000, profitCents: 900, feeBasis: 'actual' }),
      row('02', { unitsSold: 1, revenueCents: 3000, profitCents: 800, feeBasis: 'estimated' }),
    ]);
    expect(s.feeBasis).toBe('mixed');
  });

  it('keeps a day that was already mixed mixed', () => {
    const s = summarisePeriod([row('01', { unitsSold: 2, revenueCents: 6000, profitCents: 900, feeBasis: 'mixed' })]);
    expect(s.feeBasis).toBe('mixed');
  });

  it('ignores the fee basis of days that sold nothing', () => {
    const s = summarisePeriod([
      row('01', { unitsSold: 1, revenueCents: 3000, profitCents: 900, feeBasis: 'actual' }),
      row('02', { feeBasis: 'none' }),
    ]);
    expect(s.feeBasis).toBe('actual');
  });
});

describe('summarisePeriod — sales that followed a change', () => {
  it('shows the share of units that sold after one of our changes', () => {
    const s = summarisePeriod([row('01', { unitsSold: 4, unitsAfterChange: 3 })]);
    expect(s.afterChangePct).toBe(75);
  });

  it('has no share to show when nothing sold', () => {
    expect(summarisePeriod([row('01')]).afterChangePct).toBeNull();
  });
});

describe('summariseBySku', () => {
  it('keeps each SKU on each marketplace apart', () => {
    const out = summariseBySku([
      row('01', { sku: 'A', revenueCents: 100 }),
      row('01', { sku: 'A', marketplaceId: 'A1PA6795UKMFR9', revenueCents: 200 }),
      row('02', { sku: 'A', revenueCents: 50 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => [s.sku, s.marketplaceId, s.revenueCents])).toEqual([
      ['A', 'A1PA6795UKMFR9', 200],
      ['A', 'A1F83G8C2ARO7P', 150],
    ]);
  });

  /** A SKU that could end another SKU's name must not be folded into it. */
  it('does not confuse SKUs whose names run together', () => {
    const out = summariseBySku([
      row('01', { sku: 'AB', marketplaceId: 'X', revenueCents: 10 }),
      row('01', { sku: 'B', marketplaceId: 'XA', revenueCents: 20 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('puts what sold at the top, then what was worked on', () => {
    const out = summariseBySku([
      row('01', { sku: 'quiet', evaluations: 1 }),
      row('01', { sku: 'busy', evaluations: 90 }),
      row('01', { sku: 'sold', revenueCents: 1 }),
    ]);
    expect(out.map((s) => s.sku)).toEqual(['sold', 'busy', 'quiet']);
  });
});

describe('totalsOf', () => {
  it('recomputes the rates from the totals, not by averaging the rows', () => {
    // 99 samples at 0%, one at 100%: averaging the two SKUs' rates would claim 50%.
    const t = totalsOf(summariseBySku([
      row('01', { sku: 'many', buyBoxSamples: 99, buyBoxWon: 0 }),
      row('01', { sku: 'one', buyBoxSamples: 1, buyBoxWon: 1 }),
    ]));
    expect(t.buyBoxWinPct).toBe(1);
    expect(t.skus).toBe(2);
  });

  it('adds the money and the work across every SKU', () => {
    const t = totalsOf(summariseBySku([
      row('01', { sku: 'a', evaluations: 3, priced: 1, unitsSold: 1, revenueCents: 2000, profitCents: 500, feeBasis: 'actual' }),
      row('01', { sku: 'b', evaluations: 2, priced: 1, unitsSold: 2, revenueCents: 2000, profitCents: 300, feeBasis: 'actual' }),
    ]));
    expect(t).toMatchObject({ evaluations: 5, priced: 2, unitsSold: 3, revenueCents: 4000, profitCents: 800, marginPct: 20 });
  });

  it('has nothing to report for an empty span', () => {
    expect(totalsOf([])).toMatchObject({ skus: 0, evaluations: 0, revenueCents: 0, profitCents: null, buyBoxWinPct: null });
  });
});

describe('spanOf', () => {
  const now = new Date('2026-09-16T11:30:00Z');

  it('reads the dates it is given as whole UTC days', () => {
    const s = spanOf({ from: '2026-09-01', to: '2026-09-15' }, now);
    expect(s.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(s.to.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('shows the last thirty days when asked for nothing', () => {
    const s = spanOf({}, now);
    expect(s.to.toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(s.from.toISOString()).toBe('2026-08-18T00:00:00.000Z');
  });

  it('ignores a date it cannot read rather than reporting on 1970', () => {
    expect(spanOf({ from: 'last tuesday' }, now).from.toISOString()).toBe('2026-08-18T00:00:00.000Z');
  });

  /** A range typed backwards should show that day, not an empty report the user has to decode. */
  it('reads a backwards range as the single day it names', () => {
    const s = spanOf({ from: '2026-09-15', to: '2026-09-01' }, now);
    expect(s.from).toEqual(s.to);
  });
});

describe('stride', () => {
  it('leaves a short series alone', () => {
    expect(stride([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it('thins a long one evenly', () => {
    const out = stride(Array.from({ length: 100 }, (_, i) => i), 10);
    expect(out.length).toBeLessThanOrEqual(11);
    expect(out[0]).toBe(0);
  });

  /** The newest sample is the one being read as "now", so thinning must never drop it. */
  it('always keeps the last point', () => {
    const out = stride(Array.from({ length: 1000 }, (_, i) => i), 50);
    expect(out[out.length - 1]).toBe(999);
  });
});

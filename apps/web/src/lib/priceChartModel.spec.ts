import { describe, expect, it } from 'vitest';
import { chartModel, stepPath, valueAt, xTicks } from './priceChartModel';
import type { RepricingDailyStat, RepricingPricePoint, RepricingSamplePoint } from './api';

const price = (at: string, priceCents: number, source = 'repricer'): RepricingPricePoint =>
  ({ at, priceCents, previousPriceCents: null, currency: 'GBP', source, decisionId: null });

const sample = (at: string, over: Partial<RepricingSamplePoint> = {}): RepricingSamplePoint => ({
  at, ourPriceCents: null, buyBoxLandedCents: null, weHoldBuyBox: false, competitorCount: 0, lowestCompetitorCents: null, floorCents: null, ...over,
});

const day = (d: string, over: Partial<RepricingDailyStat> = {}): RepricingDailyStat => ({
  day: `2026-09-${d}T00:00:00.000Z`, sku: 'S', marketplaceId: 'M',
  evaluations: 0, priced: 0, held: 0, skipped: 0, quarantined: 0, vetoed: 0, priceChanges: 0,
  priceOpenCents: null, priceCloseCents: null, priceMinCents: null, priceMaxCents: null,
  buyBoxSamples: 0, buyBoxWon: 0, atFloorSamples: 0,
  unitsSold: 0, revenueCents: 0, profitCents: null, feeBasis: null, unitsAfterChange: 0, currency: 'GBP',
  ...over,
});

const EMPTY = { prices: [], samples: [], daily: [] };

describe('chartModel — the price band', () => {
  /** The whole point: a repricer's moves are small, and a zero baseline flattens them to a line. */
  it('shows the prices in play rather than starting at zero', () => {
    const m = chartModel({ ...EMPTY, prices: [price('2026-09-01T09:00:00Z', 2600), price('2026-09-02T09:00:00Z', 2400)] });
    expect(m.lo).toBeGreaterThan(2000);
    expect(m.hi).toBeLessThan(3000);
    expect(m.lo).toBeLessThan(2400);
    expect(m.hi).toBeGreaterThan(2600);
  });

  it('gives a SKU that never moved a band to sit in', () => {
    const m = chartModel({ ...EMPTY, prices: [price('2026-09-01T09:00:00Z', 2600)] });
    expect(m.hi).toBeGreaterThan(2600);
    expect(m.lo).toBeLessThan(2600);
  });

  it('keeps the Buy Box and the floor inside the band', () => {
    const m = chartModel({
      ...EMPTY,
      prices: [price('2026-09-01T09:00:00Z', 2600)],
      samples: [sample('2026-09-01T10:00:00Z', { buyBoxLandedCents: 3100, floorCents: 2100 })],
    });
    expect(m.hi).toBeGreaterThanOrEqual(3100);
    expect(m.lo).toBeLessThanOrEqual(2100);
  });

  it('never drops the band below zero', () => {
    expect(chartModel({ ...EMPTY, prices: [price('2026-09-01T09:00:00Z', 10)] }).lo).toBe(0);
  });
});

describe('chartModel — our price line', () => {
  it('orders the changes in time however they arrive', () => {
    const m = chartModel({ ...EMPTY, prices: [price('2026-09-03T09:00:00Z', 2400), price('2026-09-01T09:00:00Z', 2600)] });
    expect(m.ourLine.map((p) => p.v)).toEqual([2600, 2400]);
  });

  /** A SKU that held one price has no price events; the samples still know what we charged. */
  it('falls back to what the samples saw when no price changed', () => {
    const m = chartModel({ ...EMPTY, samples: [sample('2026-09-01T10:00:00Z', { ourPriceCents: 2500 })] });
    expect(m.ourLine).toEqual([{ t: Date.parse('2026-09-01T10:00:00Z'), v: 2500 }]);
    expect(m.empty).toBe(false);
  });

  it('prefers the recorded changes over the samples when both exist', () => {
    const m = chartModel({
      ...EMPTY,
      prices: [price('2026-09-01T09:00:00Z', 2600)],
      samples: [sample('2026-09-01T10:00:00Z', { ourPriceCents: 2500 })],
    });
    expect(m.ourLine).toHaveLength(1);
    expect(m.ourLine[0].v).toBe(2600);
  });

  it('knows when there is genuinely nothing to draw', () => {
    expect(chartModel(EMPTY).empty).toBe(true);
  });
});

describe('chartModel — days', () => {
  it('carries what each day sold, and how much of it followed a change', () => {
    const m = chartModel({ ...EMPTY, daily: [day('02', { unitsSold: 3, unitsAfterChange: 2, priceChanges: 1 })] });
    expect(m.days[0]).toMatchObject({ units: 3, afterChange: 2, changes: 1 });
    expect(m.maxUnits).toBe(3);
  });

  it('keeps a usable bar scale on a period with no sales', () => {
    expect(chartModel({ ...EMPTY, daily: [day('02')] }).maxUnits).toBe(1);
  });

  it('puts the days in order', () => {
    const m = chartModel({ ...EMPTY, daily: [day('05'), day('01'), day('03')] });
    expect(m.days.map((d) => new Date(d.t).getUTCDate())).toEqual([1, 3, 5]);
  });
});

describe('stepPath', () => {
  const x = (t: number) => t;
  const y = (v: number) => v;

  /** A price holds until it is changed: across, then down — never a diagonal through prices we
   *  never charged. */
  it('goes across at the old price before stepping to the new one', () => {
    expect(stepPath([{ t: 0, v: 100 }, { t: 10, v: 80 }], x, y, 20)).toBe('M0.0,100.0 L10.0,100.0 L10.0,80.0 L20,80.0');
  });

  it('carries the last price to the right edge', () => {
    expect(stepPath([{ t: 0, v: 100 }], x, y, 50)).toBe('M0.0,100.0 L50,100.0');
  });

  it('draws nothing from nothing', () => {
    expect(stepPath([], x, y, 50)).toBe('');
  });
});

describe('valueAt', () => {
  const line = [{ t: 10, v: 100 }, { t: 20, v: 90 }];

  it('reads the price in force at a moment', () => {
    expect(valueAt(line, 15)).toBe(100);
    expect(valueAt(line, 20)).toBe(90);
    expect(valueAt(line, 99)).toBe(90);
  });

  it('has no price before the first one it knows', () => {
    expect(valueAt(line, 5)).toBeNull();
  });
});

describe('xTicks', () => {
  it('spreads whole days across the span', () => {
    const t0 = Date.UTC(2026, 8, 1);
    const ticks = xTicks(t0, Date.UTC(2026, 8, 11));
    expect(ticks).toHaveLength(5);
    expect(new Date(ticks[0]).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(new Date(ticks[4]).toISOString()).toBe('2026-09-11T00:00:00.000Z');
    expect(ticks.every((t) => new Date(t).getUTCHours() === 0)).toBe(true);
  });
});

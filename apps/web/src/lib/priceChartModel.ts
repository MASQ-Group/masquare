import type { RepricingDailyStat, RepricingPricePoint, RepricingSamplePoint } from './api';

/**
 * The geometry behind the price-history chart, separated from the drawing of it.
 *
 * Everything here is a rule about what the chart MEANS — what a price line is, which band of prices
 * to show, when a sale counts as coloured — and rules belong somewhere they can be tested. The
 * component keeps only the SVG.
 *
 * PURE.
 */

export interface Point { t: number; v: number }

export interface ChartModel {
  /** Our price over time. A step series: each price holds until the next one. */
  ourLine: Point[];
  buyBox: Point[];
  floors: Point[];
  days: { t: number; units: number; afterChange: number; changes: number; close: number | null; won: number; samples: number }[];
  /** The price band drawn, padded — never anchored to zero. */
  lo: number;
  hi: number;
  maxUnits: number;
  empty: boolean;
}

export const DAY_MS = 86_400_000;

export function chartModel(input: {
  prices: RepricingPricePoint[];
  samples: RepricingSamplePoint[];
  daily: RepricingDailyStat[];
  floorCents?: number | null;
}): ChartModel {
  const ms = (iso: string) => new Date(iso).getTime();
  const byTime = (a: Point, b: Point) => a.t - b.t;

  const changes: Point[] = input.prices
    .map((p) => ({ t: ms(p.at), v: p.priceCents }))
    .filter((p) => Number.isFinite(p.t))
    .sort(byTime);

  /**
   * A SKU that held one price all period has no price EVENTS, but the market samples still recorded
   * what we were charging. Falling back to them is the difference between a flat line — true — and
   * an empty chart that reads as "nothing was recorded".
   */
  const ourLine = changes.length
    ? changes
    : input.samples
      .filter((s) => s.ourPriceCents != null)
      .map((s) => ({ t: ms(s.at), v: s.ourPriceCents as number }))
      .filter((p) => Number.isFinite(p.t))
      .sort(byTime);

  const buyBox = input.samples
    .filter((s) => s.buyBoxLandedCents != null)
    .map((s) => ({ t: ms(s.at), v: s.buyBoxLandedCents as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort(byTime);

  const floors = input.samples
    .filter((s) => s.floorCents != null)
    .map((s) => ({ t: ms(s.at), v: s.floorCents as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort(byTime);

  const days = input.daily
    .map((d) => ({
      t: ms(d.day),
      units: d.unitsSold,
      afterChange: d.unitsAfterChange,
      changes: d.priceChanges,
      close: d.priceCloseCents,
      won: d.buyBoxWon,
      samples: d.buyBoxSamples,
    }))
    .filter((d) => Number.isFinite(d.t))
    .sort((a, b) => a.t - b.t);

  const values = [...ourLine, ...buyBox, ...floors].map((p) => p.v);
  if (input.floorCents != null) values.push(input.floorCents);

  /**
   * The band is the prices in play, padded — NOT zero to the maximum. A repricer moves a £26 listing
   * between £24 and £27; against a zero baseline that is a flat line and the chart says nothing.
   * A SKU that never moved still gets a band, so its line sits in the middle rather than on an edge.
   */
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const pad = Math.max((hi - lo) * 0.12, Math.max(hi * 0.01, 50));

  return {
    ourLine,
    buyBox,
    floors,
    days,
    lo: Math.max(0, lo - pad),
    hi: hi + pad,
    maxUnits: Math.max(1, ...days.map((d) => d.units)),
    empty: ourLine.length === 0 && buyBox.length === 0 && days.length === 0,
  };
}

/**
 * A step path through the points, carried to the right edge.
 *
 * A price holds until it is changed, so the line goes across and then down; joining two prices with
 * a diagonal would draw every price in between, none of which we ever charged. The last price runs
 * to the edge because it is still the price.
 */
export function stepPath(points: readonly Point[], x: (t: number) => number, y: (v: number) => number, rightEdge: number): string {
  if (points.length === 0) return '';
  let d = `M${x(points[0].t).toFixed(1)},${y(points[0].v).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L${x(points[i].t).toFixed(1)},${y(points[i - 1].v).toFixed(1)} L${x(points[i].t).toFixed(1)},${y(points[i].v).toFixed(1)}`;
  }
  return `${d} L${rightEdge},${y(points[points.length - 1].v).toFixed(1)}`;
}

/** What a step series was showing at a moment: the last point at or before it, else nothing. */
export function valueAt(points: readonly Point[], t: number): number | null {
  let v: number | null = null;
  for (const p of points) {
    if (p.t <= t) v = p.v;
    else break;
  }
  return v;
}

/** Evenly spaced dates across the span, snapped to UTC midnight so the labels read as days. */
export function xTicks(t0: number, t1: number, count = 5): number[] {
  const step = (t1 - t0) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(t0 + i * step);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  });
}

import type { AnalyticsTrendPoint } from '../../lib/api';

const NUM_KEYS: (keyof AnalyticsTrendPoint)[] = ['revenueExVatEur', 'revenueIncVatEur', 'profitEur', 'feesEur', 'orders', 'units'];

/** Re-bucket (Day→Week) and/or accumulate the returned trend for the granularity
 *  and cumulative toggles. AOV is recomputed from the reshaped revenue/orders. */
export function reshapeTrend(points: AnalyticsTrendPoint[], gran: 'day' | 'week', cumulative: boolean): AnalyticsTrendPoint[] {
  let out = points;
  if (gran === 'week' && points.length > 7) {
    const weeks: AnalyticsTrendPoint[] = [];
    for (let i = 0; i < points.length; i += 7) {
      const chunk = points.slice(i, i + 7);
      const p: any = { bucket: `W${weeks.length + 1}`, avgOrderValueEur: 0 };
      for (const k of NUM_KEYS) p[k] = chunk.reduce((s, c) => s + (Number(c[k]) || 0), 0);
      p.avgOrderValueEur = p.orders ? p.revenueExVatEur / p.orders : 0;
      weeks.push(p);
    }
    out = weeks;
  }
  if (cumulative) {
    const acc: Record<string, number> = {};
    out = out.map((pt) => {
      const p: any = { ...pt };
      for (const k of NUM_KEYS) p[k] = acc[k as string] = (acc[k as string] ?? 0) + (Number(pt[k]) || 0);
      p.avgOrderValueEur = p.orders ? p.revenueExVatEur / p.orders : 0;
      return p;
    });
  }
  return out;
}

/** Five evenly-spaced x-axis tick labels derived from the bucket keys. */
export function xLabelsFor(points: AnalyticsTrendPoint[]): string[] {
  if (points.length === 0) return [];
  const idx = [...new Set([0, Math.floor(points.length / 4), Math.floor(points.length / 2), Math.floor((points.length * 3) / 4), points.length - 1])];
  return idx.map((i) => {
    const b = points[i].bucket;
    return b.length > 7 ? b.slice(5) : b;
  });
}

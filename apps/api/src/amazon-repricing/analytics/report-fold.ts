import { combineFeeBasis, type FeeBasis } from './sale-line-profit';

/**
 * Daily statistics folded into the rows a report shows.
 *
 * The nightly job already reduced raw events to one row per SKU per marketplace per day; this
 * reduces a span of those days to one row per SKU, and a page of SKUs to one set of totals. Every
 * rule about what a rate means lives here, tested, rather than being re-derived in the table and
 * again in the spreadsheet and again in the chart's header.
 *
 * The rule that matters most: a rate with no denominator is null, never zero. "We won the Buy Box
 * 0% of the time" and "we never looked" are different facts, and only one of them is a problem.
 *
 * PURE.
 */

export interface DailyRow {
  day: Date;
  sku: string;
  marketplaceId: string;
  evaluations: number;
  priced: number;
  held: number;
  skipped: number;
  quarantined: number;
  vetoed: number;
  priceChanges: number;
  priceOpenCents: number | null;
  priceCloseCents: number | null;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  buyBoxSamples: number;
  buyBoxWon: number;
  atFloorSamples: number;
  unitsSold: number;
  revenueCents: number;
  profitCents: number | null;
  feeBasis: string | null;
  unitsAfterChange: number;
  currency: string | null;
}

export interface PeriodSummary {
  sku: string;
  marketplaceId: string;
  /** Days that produced a row at all — the SKU was being evaluated, or sold, on this many of them. */
  days: number;
  firstDay: Date | null;
  lastDay: Date | null;

  evaluations: number;
  priced: number;
  held: number;
  skipped: number;
  quarantined: number;
  vetoed: number;
  priceChanges: number;

  priceOpenCents: number | null;
  priceCloseCents: number | null;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  /** Close against open, as a percentage. Null unless both ends are known. */
  priceMovePct: number | null;

  buyBoxSamples: number;
  buyBoxWon: number;
  buyBoxWinPct: number | null;
  atFloorSamples: number;
  atFloorPct: number | null;

  unitsSold: number;
  revenueCents: number;
  profitCents: number | null;
  marginPct: number | null;
  feeBasis: StoredBasis;

  unitsAfterChange: number;
  /** Of everything sold, the share that sold inside the window after one of our price changes. */
  afterChangePct: number | null;

  currency: string | null;
}

type StoredBasis = 'actual' | 'estimated' | 'mixed' | 'none' | null;

/**
 * The fee basis of a span, from the bases the days were stored with.
 *
 * A stored day may already say "mixed"; that is not one of the three things a single sale line can
 * be, so it cannot go through combineFeeBasis and is answered directly — one mixed day makes the
 * whole span mixed.
 */
export function combineStoredBasis(bases: readonly (string | null)[]): StoredBasis {
  const seen = new Set(bases.filter((b): b is string => !!b));
  if (seen.has('mixed')) return 'mixed';
  return combineFeeBasis([...seen].filter((b): b is FeeBasis => b === 'actual' || b === 'estimated' || b === 'none'));
}

const sum = <T>(rows: readonly T[], f: (r: T) => number) => rows.reduce((n, r) => n + f(r), 0);
const rate = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

function extent(values: readonly (number | null)[], pick: (a: number, b: number) => number): number | null {
  const known = values.filter((v): v is number => v != null);
  // Reduced with an explicit call: passing Math.min straight to reduce hands it the index and the
  // array as well, and the answer comes back NaN.
  return known.length ? known.reduce((a, b) => pick(a, b)) : null;
}

/** One SKU on one marketplace, over the days given. Rows may arrive in any order. */
export function summarisePeriod(rows: readonly DailyRow[]): PeriodSummary {
  const byDay = [...rows].sort((a, b) => a.day.getTime() - b.day.getTime());
  const first = byDay[0] ?? null;
  const last = byDay[byDay.length - 1] ?? null;

  // A day the SKU did not trade has no open or close; the price the period started at is the first
  // one we actually knew, and the price it ended at the last — not null because the final day was
  // quiet.
  const opened = byDay.find((r) => r.priceOpenCents != null)?.priceOpenCents ?? null;
  const closed = [...byDay].reverse().find((r) => r.priceCloseCents != null)?.priceCloseCents ?? null;

  const revenueCents = sum(byDay, (r) => r.revenueCents);
  const unitsSold = sum(byDay, (r) => r.unitsSold);
  const withProfit = byDay.filter((r) => r.profitCents != null);
  const profitCents = withProfit.length ? sum(withProfit, (r) => r.profitCents as number) : null;
  const buyBoxSamples = sum(byDay, (r) => r.buyBoxSamples);

  return {
    sku: first?.sku ?? '',
    marketplaceId: first?.marketplaceId ?? '',
    days: byDay.length,
    firstDay: first?.day ?? null,
    lastDay: last?.day ?? null,

    evaluations: sum(byDay, (r) => r.evaluations),
    priced: sum(byDay, (r) => r.priced),
    held: sum(byDay, (r) => r.held),
    skipped: sum(byDay, (r) => r.skipped),
    quarantined: sum(byDay, (r) => r.quarantined),
    vetoed: sum(byDay, (r) => r.vetoed),
    priceChanges: sum(byDay, (r) => r.priceChanges),

    priceOpenCents: opened,
    priceCloseCents: closed,
    priceMinCents: extent(byDay.map((r) => r.priceMinCents), Math.min),
    priceMaxCents: extent(byDay.map((r) => r.priceMaxCents), Math.max),
    priceMovePct: opened != null && closed != null && opened > 0 ? round1(((closed - opened) / opened) * 100) : null,

    buyBoxSamples,
    buyBoxWon: sum(byDay, (r) => r.buyBoxWon),
    buyBoxWinPct: rate(sum(byDay, (r) => r.buyBoxWon), buyBoxSamples),
    atFloorSamples: sum(byDay, (r) => r.atFloorSamples),
    atFloorPct: rate(sum(byDay, (r) => r.atFloorSamples), buyBoxSamples),

    unitsSold,
    revenueCents,
    profitCents,
    marginPct: profitCents != null && revenueCents > 0 ? round1((profitCents / revenueCents) * 100) : null,
    feeBasis: combineStoredBasis(byDay.filter((r) => r.unitsSold > 0).map((r) => r.feeBasis)),

    unitsAfterChange: sum(byDay, (r) => r.unitsAfterChange),
    afterChangePct: rate(sum(byDay, (r) => r.unitsAfterChange), unitsSold),

    currency: byDay.find((r) => r.currency)?.currency ?? null,
  };
}

/** Every SKU in the span, busiest first: what sold, then what was worked on, then by name. */
export function summariseBySku(rows: readonly DailyRow[]): PeriodSummary[] {
  const groups = new Map<string, DailyRow[]>();
  for (const r of rows) {
    // The marketplace id first: it is a fixed token with no separator in it, so the key stays
    // unambiguous whatever a SKU happens to contain.
    const key = `${r.marketplaceId}|${r.sku}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.values()]
    .map(summarisePeriod)
    .sort((a, b) => b.revenueCents - a.revenueCents || b.evaluations - a.evaluations || a.sku.localeCompare(b.sku));
}

/**
 * The page's headline figures.
 *
 * Counts add up across SKUs; prices do not — a minimum price across a hundred SKUs is the cheapest
 * product, not a fact about pricing — so the price fields are deliberately absent, and every rate is
 * recomputed from the totals rather than averaged from the rows (an average of percentages weights
 * a SKU seen twice the same as one seen ten thousand times).
 */
export function totalsOf(summaries: readonly PeriodSummary[]) {
  const buyBoxSamples = sum(summaries, (s) => s.buyBoxSamples);
  const buyBoxWon = sum(summaries, (s) => s.buyBoxWon);
  const atFloorSamples = sum(summaries, (s) => s.atFloorSamples);
  const unitsSold = sum(summaries, (s) => s.unitsSold);
  const revenueCents = sum(summaries, (s) => s.revenueCents);
  const withProfit = summaries.filter((s) => s.profitCents != null);
  const profitCents = withProfit.length ? sum(withProfit, (s) => s.profitCents as number) : null;
  const unitsAfterChange = sum(summaries, (s) => s.unitsAfterChange);

  return {
    skus: summaries.length,
    evaluations: sum(summaries, (s) => s.evaluations),
    priced: sum(summaries, (s) => s.priced),
    held: sum(summaries, (s) => s.held),
    skipped: sum(summaries, (s) => s.skipped),
    quarantined: sum(summaries, (s) => s.quarantined),
    vetoed: sum(summaries, (s) => s.vetoed),
    priceChanges: sum(summaries, (s) => s.priceChanges),
    buyBoxSamples,
    buyBoxWon,
    buyBoxWinPct: rate(buyBoxWon, buyBoxSamples),
    atFloorSamples,
    atFloorPct: rate(atFloorSamples, buyBoxSamples),
    unitsSold,
    revenueCents,
    profitCents,
    marginPct: profitCents != null && revenueCents > 0 ? round1((profitCents / revenueCents) * 100) : null,
    unitsAfterChange,
    afterChangePct: rate(unitsAfterChange, unitsSold),
    feeBasis: combineStoredBasis(summaries.filter((s) => s.unitsSold > 0).map((s) => s.feeBasis)),
  };
}

/** The span a report covers, defaulting to the last 30 days. Days are UTC, as the stored days are. */
export function spanOf(q: { from?: string; to?: string }, now: Date = new Date()): { from: Date; to: Date } {
  const parse = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  const to = parse(q.to) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = parse(q.from) ?? new Date(to.getTime() - 29 * 86_400_000);
  // A range typed backwards asks for nothing; read it as the single day it names rather than
  // returning an empty report the user has to work out for themselves.
  return { from: from > to ? to : from, to };
}

/**
 * At most `max` of them, evenly spaced, with the last one always kept.
 *
 * A quarter of market samples is thousands of points drawn on a chart a few hundred pixels wide;
 * thinning them changes nothing anyone can see, and the newest sample is the one being read as
 * "now", so it survives the thinning.
 */
export function stride<T>(rows: readonly T[], max: number): T[] {
  if (rows.length <= max) return [...rows];
  const step = rows.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(rows[Math.floor(i * step)]);
  const last = rows[rows.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

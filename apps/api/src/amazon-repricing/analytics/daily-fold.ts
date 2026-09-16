import { combineFeeBasis, type FeeBasis } from './sale-line-profit';

/**
 * One day of a SKU on one marketplace, folded into the row a report reads.
 *
 * Pure, and deliberately so: the rollup job does the reading and the writing, and every rule about
 * what counts as a price change, a Buy Box win or a sale that followed a reprice lives here, where
 * it can be tested without a database. Recomputing a day must give the same row every time —
 * backfills and late-settling fees simply rewrite it.
 *
 * PURE.
 */

export interface DecisionEvent {
  at: Date;
  outcome: string;
  /** The safety layer's verdict, when the writer got that far. */
  vetoed: boolean;
}

export interface PriceEvent {
  at: Date;
  priceCents: number;
  /** Ours, or somebody else's — both are price history, only ours count as repricer changes. */
  source: string;
}

export interface MarketSampleEvent {
  at: Date;
  ourPriceCents: number | null;
  weHoldBuyBox: boolean;
  floorCents: number | null;
}

export interface SaleEvent {
  at: Date;
  units: number;
  revenueCents: number;
  profitCents: number;
  feeBasis: FeeBasis;
}

export interface DayFold {
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
  feeBasis: 'actual' | 'estimated' | 'mixed' | 'none' | null;
  unitsAfterChange: number;
}

/** How long after a price change a sale still counts as having followed it. */
export const DEFAULT_ATTRIBUTION_HOURS = 24;

export function foldDay(input: {
  decisions: readonly DecisionEvent[];
  prices: readonly PriceEvent[];
  samples: readonly MarketSampleEvent[];
  sales: readonly SaleEvent[];
  /** The last price known before this day started, so a day with no change still has a price. */
  priceBeforeDayCents?: number | null;
  /** Price changes from earlier that still count for sales early today. */
  changesBeforeDay?: readonly PriceEvent[];
  attributionHours?: number;
}): DayFold {
  const { decisions, prices, samples, sales } = input;
  const windowMs = (input.attributionHours ?? DEFAULT_ATTRIBUTION_HOURS) * 60 * 60 * 1000;

  const count = (o: string) => decisions.filter((d) => d.outcome === o).length;
  const byTime = [...prices].sort((a, b) => a.at.getTime() - b.at.getTime());
  const cents = byTime.map((p) => p.priceCents);
  const opened = input.priceBeforeDayCents ?? cents[0] ?? null;
  const seen = opened == null ? cents : [opened, ...cents];

  /**
   * A change the repricer made, not every price we recorded: a listing sync that merely confirms
   * yesterday's price is not a change, and someone editing the price in Seller Central is a change
   * but not one of ours — it is kept in history and counted separately by the report, not here.
   */
  const ourChanges = byTime.filter((p) => p.source === 'repricer');
  const changeTimes = [...(input.changesBeforeDay ?? []), ...ourChanges].map((p) => p.at.getTime());

  const unitsAfterChange = sales
    .filter((s) => changeTimes.some((t) => s.at.getTime() >= t && s.at.getTime() - t <= windowMs))
    .reduce((n, s) => n + s.units, 0);

  const withFloor = samples.filter((s) => s.ourPriceCents != null && s.floorCents != null);

  return {
    evaluations: decisions.length,
    priced: count('PRICED'),
    held: count('HELD'),
    skipped: count('SKIPPED'),
    quarantined: count('QUARANTINED'),
    vetoed: decisions.filter((d) => d.vetoed).length,

    priceChanges: ourChanges.length,
    priceOpenCents: opened,
    priceCloseCents: cents.length ? cents[cents.length - 1] : opened,
    priceMinCents: seen.length ? Math.min(...seen) : null,
    priceMaxCents: seen.length ? Math.max(...seen) : null,

    buyBoxSamples: samples.length,
    buyBoxWon: samples.filter((s) => s.weHoldBuyBox).length,
    atFloorSamples: withFloor.filter((s) => (s.ourPriceCents as number) <= (s.floorCents as number)).length,

    unitsSold: sales.reduce((n, s) => n + s.units, 0),
    revenueCents: sales.reduce((n, s) => n + s.revenueCents, 0),
    profitCents: sales.length ? sales.reduce((n, s) => n + s.profitCents, 0) : null,
    feeBasis: combineFeeBasis(sales.map((s) => s.feeBasis)),
    unitsAfterChange,
  };
}

/** The UTC day a moment belongs to, as the date the row is keyed by. */
export function dayOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * What eBay actually charges us, worked out from orders it has already settled.
 *
 * The pricing screen was using eBay's published rate card — 12.8% plus 30p. Published rates are a
 * starting point and rarely the truth: they vary by category, by shop subscription, by promotional
 * discounts and by whatever an account has negotiated. A margin built on the wrong rate is wrong on
 * every listing, quietly, in the same direction.
 *
 * So the rate is measured instead. eBay's fee has the shape `fee = percentage × order total + a
 * fixed amount per order`, which is a straight line, so fitting a line through real orders recovers
 * both numbers at once: the slope is the percentage and the intercept is the fixed fee.
 *
 * The fit is only believed when it is believable. Too few orders, order totals that barely vary, a
 * line the data does not actually follow, or a rate outside anything eBay plausibly charges — each
 * is reported as a refusal with its reason, and the caller falls back to the published rates rather
 * than pricing a catalogue off a number derived from eleven orders.
 *
 * PURE.
 */

export interface SettledOrder {
  /** What the buyer paid in total: goods, postage and tax. eBay charges its fee on all of it. */
  grossCents: number;
  /** What eBay took for the sale. */
  feeCents: number;
}

export type FeeModel =
  | {
    ok: true;
    feePct: number;
    fixedFeeCents: number;
    sampleSize: number;
    /** How closely the orders follow the line. 1 is exact. */
    fit: number;
    /** True when the measured fixed fee came out negative and was held at zero. */
    fixedHeldAtZero: boolean;
  }
  | { ok: false; reason: string; sampleSize: number };

/** Below this, one unusual order moves the answer more than the evidence does. */
export const MIN_ORDERS = 30;
/** eBay's fee has never been near either end of this; outside it, something else was measured. */
const PCT_RANGE = { min: 0.01, max: 0.3 };
const MAX_FIXED_CENTS = 500;
/** Real fees follow the line closely. Anything looser means the fee is not what we think it is. */
const MIN_FIT = 0.7;

export function fitFeeModel(orders: readonly SettledOrder[]): FeeModel {
  /** Refunds, cancellations and bad rows would each pull the line somewhere untrue. */
  const usable = orders.filter((o) =>
    Number.isFinite(o.grossCents) && Number.isFinite(o.feeCents)
    && o.grossCents > 0 && o.feeCents > 0 && o.feeCents < o.grossCents);

  const n = usable.length;
  if (n < MIN_ORDERS) {
    return { ok: false, reason: `only ${n} settled eBay orders carry a fee, and at least ${MIN_ORDERS} are needed to measure a rate`, sampleSize: n };
  }

  const meanX = usable.reduce((s, o) => s + o.grossCents, 0) / n;
  const meanY = usable.reduce((s, o) => s + o.feeCents, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (const o of usable) {
    const dx = o.grossCents - meanX;
    sxx += dx * dx;
    sxy += dx * (o.feeCents - meanY);
  }
  /**
   * Every order the same size tells us the total fee but not how it splits between a percentage and
   * a fixed amount — infinitely many lines pass through one point.
   */
  if (sxx <= 0) {
    return { ok: false, reason: 'every settled order is the same size, so the percentage and the fixed fee cannot be told apart', sampleSize: n };
  }

  let slope = sxy / sxx;
  let intercept = meanY - slope * meanX;
  let fixedHeldAtZero = false;

  /**
   * A negative fixed fee would mean eBay pays us something per order. It happens when the fee really
   * is a flat percentage, and the line then tilts to compensate — so the line is refitted through
   * the origin rather than reported as nonsense.
   */
  if (intercept < 0) {
    const sumXX = usable.reduce((s, o) => s + o.grossCents * o.grossCents, 0);
    const sumXY = usable.reduce((s, o) => s + o.grossCents * o.feeCents, 0);
    slope = sumXY / sumXX;
    intercept = 0;
    fixedHeldAtZero = true;
  }

  // How much of the variation in fees the line accounts for.
  let ssRes = 0;
  let ssTot = 0;
  for (const o of usable) {
    const predicted = slope * o.grossCents + intercept;
    ssRes += (o.feeCents - predicted) ** 2;
    ssTot += (o.feeCents - meanY) ** 2;
  }
  const fit = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  /**
   * The fit is checked FIRST, and the order matters for the message rather than the verdict. When
   * fees are scattered the line through them is meaningless, and its slope is meaningless with it —
   * reporting "the fee works out at -0.3%" would send somebody looking for a rate problem when what
   * they have is data that follows no rate at all.
   */
  if (fit < MIN_FIT) {
    return { ok: false, reason: `eBay's fees on these orders do not follow a single rate closely enough to measure one (fit ${fit.toFixed(2)})`, sampleSize: n };
  }
  if (slope < PCT_RANGE.min || slope > PCT_RANGE.max) {
    return { ok: false, reason: `the measured fee works out at ${(slope * 100).toFixed(1)}% of the order, which is not a rate eBay charges`, sampleSize: n };
  }
  if (intercept > MAX_FIXED_CENTS) {
    return { ok: false, reason: `the measured fixed fee works out at ${(intercept / 100).toFixed(2)} an order, which is too high to believe`, sampleSize: n };
  }

  return {
    ok: true,
    // Kept at four decimals: 12.8% is 0.128, and more precision than that is noise.
    feePct: Math.round(slope * 10000) / 10000,
    fixedFeeCents: Math.round(intercept),
    sampleSize: n,
    fit: Math.round(fit * 100) / 100,
    fixedHeldAtZero,
  };
}

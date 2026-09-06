/**
 * How many decimal places a currency actually has.
 *
 * Most of ours have two. Yen has none, and Amazon JP refuses a price that carries any:
 *
 *   Value '5687.57' for attribute 'Your Price' has too many decimal places.
 *   It has 2 decimal places but the maximum allowed is '0'.
 *
 * The platform holds every price in minor units, which is right for euros and pounds and wrong in
 * one specific way for yen: 568757 does not mean 5687.57 yen, it means a number of yen with two
 * digits that cannot exist. So the conversion out — to the number a marketplace is sent, and to the
 * number a person is shown — is where the currency's own precision has to be applied.
 *
 * ISO 4217 defines the minor unit per currency; this lists the zero-decimal ones we can actually
 * reach. Anything not named here has two, which is the safe default: quoting two decimals where a
 * currency has none is a rejected write, and it is visible immediately.
 */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD']);

/** True when this currency has no minor unit at all — 100 yen is 100, not 1.00. */
export function isZeroDecimal(currency: string | null | undefined): boolean {
  return ZERO_DECIMAL.has((currency ?? '').toUpperCase());
}

/** Decimal places a price in this currency may carry. */
export function decimalsFor(currency: string | null | undefined): 0 | 2 {
  return isZeroDecimal(currency) ? 0 : 2;
}

/**
 * The smallest step a price may move in, in the minor units we store.
 *
 * 1 for a two-decimal currency, 100 for yen — because a yen price stored in minor units must be a
 * whole multiple of 100 to be expressible at all.
 */
export function priceStepCents(currency: string | null | undefined): number {
  return isZeroDecimal(currency) ? 100 : 1;
}

/**
 * Round a stored price to something the currency can express.
 *
 * The direction matters and differs by what the number is for:
 *
 * - `up` for a floor, a breakeven or a suggested price. Rounding a floor down puts it below the
 *   floor, which is the one thing a floor exists to prevent. At most 99 minor units — under a yen —
 *   but a floor that is under by any amount is not a floor.
 * - `nearest` for a price somebody chose. It is their number, and moving it further than necessary
 *   is presumptuous.
 */
export function roundPriceCents(
  cents: number,
  currency: string | null | undefined,
  mode: 'up' | 'nearest' = 'nearest',
): number {
  const step = priceStepCents(currency);
  if (step === 1) return Math.round(cents);
  return mode === 'up' ? Math.ceil(cents / step) * step : Math.round(cents / step) * step;
}

/**
 * A stored price as the decimal number a marketplace is sent.
 *
 * The single conversion from our minor units to a marketplace's number, so the rounding cannot be
 * forgotten at one of the several places that make this call.
 */
export function priceAmountFor(cents: number, currency: string | null | undefined): number {
  const rounded = roundPriceCents(cents, currency, 'nearest');
  return isZeroDecimal(currency) ? Math.round(rounded / 100) : Math.round(rounded) / 100;
}

/** True when a stored price can be expressed in this currency without losing anything. */
export function isExpressible(cents: number, currency: string | null | undefined): boolean {
  return Number.isInteger(cents) && cents % priceStepCents(currency) === 0;
}

import { describe, expect, it } from 'vitest';
import { isExpressible, priceAmountFor, roundPriceCents } from '../../common/currency-precision';

/**
 * Amazon JP refuses a price carrying decimals:
 *
 *   Value '5687.57' for attribute 'Your Price' has too many decimal places.
 *   It has 2 decimal places but the maximum allowed is '0'.
 *
 * The platform holds every price in minor units, so a yen price is a number that cannot exist until
 * something rounds it. These pin the three places that has to happen: what a marketplace is sent,
 * what a floor is stored as, and what a person is allowed to type.
 */
describe('a price bound for Amazon JP', () => {
  it('is a whole number by the time it reaches the marketplace', () => {
    // The exact figure from the rejection.
    expect(priceAmountFor(568757, 'JPY')).toBe(5688);
    expect(Number.isInteger(priceAmountFor(568757, 'JPY'))).toBe(true);
  });

  it('is left alone in every other marketplace', () => {
    // The fix must not reach beyond the currency that needs it — rounding a euro price to whole
    // euros would be a far bigger error than the one being fixed.
    expect(priceAmountFor(568757, 'EUR')).toBe(5687.57);
    expect(priceAmountFor(568757, 'GBP')).toBe(5687.57);
  });

  it('rounds a JP floor up, so it stays a floor', () => {
    // A breakeven rounded down is below breakeven. Under a yen, but a floor under by any amount is
    // not a floor, and the repricer prices against it.
    expect(roundPriceCents(568701, 'JPY', 'up')).toBe(568800);
  });

  it('recognises a price the marketplace would reject', () => {
    // What updatePrice checks before sending, so the refusal names the currency rather than
    // arriving from Amazon as a sentence about decimal places.
    expect(isExpressible(568757, 'JPY')).toBe(false);
    expect(isExpressible(568800, 'JPY')).toBe(true);
  });

  it('holds for every price across a wide range, not just the reported one', () => {
    for (let cents = 1; cents < 2_000_000; cents += 7919) {
      expect(Number.isInteger(priceAmountFor(cents, 'JPY')), `${cents}`).toBe(true);
      expect(roundPriceCents(cents, 'JPY', 'up') % 100, `${cents}`).toBe(0);
      // Rounding up must never move a price down.
      expect(roundPriceCents(cents, 'JPY', 'up')).toBeGreaterThanOrEqual(cents);
    }
  });
});

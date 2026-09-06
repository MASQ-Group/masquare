import { describe, expect, it } from 'vitest';
import { decimalsFor, isExpressible, isZeroDecimal, priceAmountFor, priceStepCents, roundPriceCents } from './currency-precision';

describe('which currencies have a minor unit', () => {
  it('knows yen has none', () => {
    expect(isZeroDecimal('JPY')).toBe(true);
    expect(decimalsFor('JPY')).toBe(0);
    expect(priceStepCents('JPY')).toBe(100);
  });

  it('treats every currency we trade in as two-decimal unless named', () => {
    for (const c of ['EUR', 'GBP', 'USD', 'CAD', 'AUD', 'SEK', 'PLN', 'AED', 'SAR', 'MXN', 'SGD', 'TRY']) {
      expect(decimalsFor(c), c).toBe(2);
      expect(priceStepCents(c), c).toBe(1);
    }
  });

  it('is not fooled by case or by a missing currency', () => {
    expect(isZeroDecimal('jpy')).toBe(true);
    // Unknown defaults to two decimals: quoting two where a currency has none is a rejected write
    // and shows up at once, which is the failure worth having.
    expect(decimalsFor(null)).toBe(2);
    expect(decimalsFor(undefined)).toBe(2);
  });
});

describe('rounding a stored price to something the currency can express', () => {
  it('sends whole yen', () => {
    // The price Amazon JP rejected: 5687.57.
    expect(priceAmountFor(568757, 'JPY')).toBe(5688);
    expect(priceAmountFor(568700, 'JPY')).toBe(5687);
  });

  it('leaves two-decimal currencies exactly as they are', () => {
    expect(priceAmountFor(568757, 'EUR')).toBe(5687.57);
    expect(priceAmountFor(1, 'GBP')).toBe(0.01);
  });

  it('rounds a floor UP, never down', () => {
    // A floor rounded down is below the floor, which is the one thing a floor exists to prevent.
    // Under a yen, but a floor that is under by any amount is not a floor.
    expect(roundPriceCents(568701, 'JPY', 'up')).toBe(568800);
    expect(roundPriceCents(568700, 'JPY', 'up')).toBe(568700);
  });

  it('rounds a chosen price to the nearest, not away from it', () => {
    // It is their number; moving it further than necessary is presumptuous.
    expect(roundPriceCents(568740, 'JPY', 'nearest')).toBe(568700);
    expect(roundPriceCents(568760, 'JPY', 'nearest')).toBe(568800);
  });

  it('never returns a yen price with a fraction', () => {
    for (const cents of [1, 99, 100, 12345, 568757, 999999]) {
      const amount = priceAmountFor(cents, 'JPY');
      expect(Number.isInteger(amount), `${cents} -> ${amount}`).toBe(true);
    }
  });

  it('never returns more than two decimals anywhere else', () => {
    for (const cents of [1, 99, 100, 12345, 568757, 999999]) {
      const amount = priceAmountFor(cents, 'EUR');
      expect(Math.round(amount * 100), `${cents}`).toBeCloseTo(amount * 100, 9);
    }
  });
});

describe('checking a price before it is sent', () => {
  it('accepts a whole yen figure and refuses a fractional one', () => {
    expect(isExpressible(568700, 'JPY')).toBe(true);
    expect(isExpressible(568757, 'JPY')).toBe(false);
  });

  it('accepts any whole minor unit in a two-decimal currency', () => {
    expect(isExpressible(568757, 'EUR')).toBe(true);
    expect(isExpressible(568757.5, 'EUR')).toBe(false);
  });
});

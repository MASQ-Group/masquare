import { describe, expect, it } from 'vitest';
import { toEbayOutcome } from './ebay-pricing';

/** £1 = €1.1644, as on the day IT33248 was priced. */
const RATE = 1.1644;

describe('toEbayOutcome', () => {
  it('turns the platform economics into the listing currency, lines adding up to the price', () => {
    // IT33248 at £188.94 on eBay UK: over the £135 line, so no VAT; 15% fee, €97 cost, €46 shipping.
    const priceEur = 188.94 * RATE;
    const feeEur = priceEur * 0.15;
    const profitEur = priceEur - feeEur - 97 - 46;
    const out = toEbayOutcome(18894, {
      profitEur, marginPct: Math.round((profitEur / priceEur) * 10000) / 100, loss: false,
      priceEur, costEur: 97, shippingEur: 46, feeEur, vatEur: 0,
    })!;
    expect(out.vatCents).toBe(0);
    expect(out.costCents).toBe(Math.round((97 / RATE) * 100));
    expect(out.shippingCents).toBe(Math.round((46 / RATE) * 100));
    expect(out.marginPct).toBeCloseTo(20, 1);
    const lines = out.vatCents + out.feesCents + out.shippingCents + out.costCents + out.profitCents;
    expect(Math.abs(lines - out.priceCents)).toBeLessThanOrEqual(2); // rounding, a penny a line at most
  });

  it('has nothing to say without economics', () => {
    expect(toEbayOutcome(1000, undefined)).toBeNull();
    expect(toEbayOutcome(1000, { profitEur: null, marginPct: null, loss: false })).toBeNull();
  });
});

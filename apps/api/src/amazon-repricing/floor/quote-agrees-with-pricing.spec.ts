import { describe, expect, it } from 'vitest';
import { netRevenueCents, type FloorInputs } from './floor-solver';

/**
 * A quoted profit must equal the profit Individual Pricing shows for the same sale.
 *
 * The listing quote read 38.9% where Individual Pricing read 40.9% on the same SKU, price and
 * channel. The whole gap was a 2% returns allowance: the floor engine deducts one, and Individual
 * Pricing — like a booked sale — does not.
 *
 * A floor keeps its returns allowance, because a floor is a safety line for automated pricing. A
 * quoted profit answers "what does this sale earn", and a sale either is returned or is not.
 *
 * These tests pin the arithmetic of that decision. They work in EUR cents; the real quote runs in
 * the marketplace's own currency, which does not change the shape.
 */

/** The Amazon MX case that exposed it: MXN 599.03 ≈ €30.34, 15% referral, 0% VAT. */
const base: FloorInputs = {
  vatRate: 0,
  referralBrackets: [{ minCents: 1, maxCents: 100_000_00, pct: 0.15 }],
  cogsLandedCents: 799,
  fixedPerUnitCents: 540,
  fbaFulfillmentFeeCents: 0,
  closingFeeCents: 0,
  refundAdminFeeCents: 0,
  storagePerUnitCents: 0,
  adCostPerUnitCents: 0,
  returnsRate: 0,
};

const PRICE = 3034;

describe('a quoted profit', () => {
  it('matches Individual Pricing: price less VAT, channel fee, cost and shipping', () => {
    // 30.34 − 4.55 fee − 7.99 cost − 5.40 shipping = 12.40
    expect(netRevenueCents(PRICE, base)).toBe(1240);
    expect(Math.round((1240 / PRICE) * 1000) / 10).toBe(40.9);
  });

  it('carries no returns allowance — that belongs to a floor', () => {
    const withReturns = netRevenueCents(PRICE, { ...base, returnsRate: 0.02 });
    // The old behaviour, kept here so the difference stays visible rather than mysterious.
    expect(withReturns).toBe(1179);
    expect(Math.round((withReturns / PRICE) * 1000) / 10).toBe(38.9);

    // Two points of margin is precisely the 2% allowance, which is what made the two screens
    // disagree — and why the returns rate must be zero in a quote.
    expect(netRevenueCents(PRICE, base) - withReturns).toBe(Math.round(PRICE * 0.02));
  });

  it('still deducts everything a sale genuinely pays', () => {
    const noFee = netRevenueCents(PRICE, { ...base, referralBrackets: [{ minCents: 1, maxCents: 100_000_00, pct: 0 }] });
    expect(noFee).toBe(1240 + 455);

    const noShipping = netRevenueCents(PRICE, { ...base, fixedPerUnitCents: 0 });
    expect(noShipping).toBe(1240 + 540);

    const withVat = netRevenueCents(PRICE, { ...base, vatRate: 0.16 });
    expect(withVat).toBeLessThan(1240);
  });
});

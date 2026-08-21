import { describe, it, expect } from 'vitest';
import { readAmount, readOrderMoney } from './ebay-money-diagnostic';

// eBay's Amount type reports BOTH sides of a conversion: `value`/`currency` is the CONVERTED
// figure, `convertedFromValue`/`convertedFromCurrency` the original. Reading only `value` and
// assuming the order's currency converts a second time when eBay has already converted.

describe('reading an eBay Amount', () => {
  it('sees a plain amount as unconverted', () => {
    const a = readAmount({ value: '245.94', currency: 'USD' });
    expect(a).toMatchObject({ value: 245.94, currency: 'USD', converted: false });
  });

  it('reports both sides when eBay converted', () => {
    const a = readAmount({ value: '197.81', currency: 'EUR', convertedFromValue: '238.39', convertedFromCurrency: 'USD' });
    expect(a).toMatchObject({ value: 197.81, currency: 'EUR', convertedFromValue: 238.39, convertedFromCurrency: 'USD', converted: true });
  });

  it('does not call it a conversion when both sides are the same currency', () => {
    expect(readAmount({ value: '10', currency: 'EUR', convertedFromValue: '10', convertedFromCurrency: 'EUR' }).converted).toBe(false);
  });
});

describe('diagnosing one order', () => {
  const order = (fee: any) => ({
    orderId: '26-15031-86756',
    lineItems: [{ listingMarketplaceId: 'EBAY_US', total: { value: '1398.14', currency: 'USD' } }],
    pricingSummary: { total: { value: '1398.14', currency: 'USD' }, priceSubtotal: { value: '1398.14', currency: 'USD' } },
    totalMarketplaceFee: fee,
  });

  it('flags a fee eBay has already converted, which we would convert again', () => {
    const d = readOrderMoney(order({ value: '197.81', currency: 'EUR', convertedFromValue: '238.39', convertedFromCurrency: 'USD' }));
    expect(d.orderCurrency).toBe('USD');
    expect(d.interpretation.feeAlreadyConverted).toBe(true);
    expect(d.interpretation.mismatch).toContain('converts again');
    expect(d.interpretation.ebayImpliedRate).toBeCloseTo(0.8298, 3);
  });

  it('stays quiet when the fee is in the order currency, where our FX is the right thing to apply', () => {
    const d = readOrderMoney(order({ value: '245.94', currency: 'USD' }));
    expect(d.interpretation.mismatch).toBeNull();
    expect(d.interpretation.feeAlreadyConverted).toBe(false);
    expect(d.interpretation.ebayImpliedRate).toBeNull();
  });
});

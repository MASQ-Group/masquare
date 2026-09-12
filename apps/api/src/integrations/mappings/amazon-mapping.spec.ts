import { describe, expect, it } from 'vitest';
import { mapAmazonOrder } from './amazon-mapping';

describe('tax provenance', () => {
  const order = (extra: Record<string, unknown> = {}) => ({
    AmazonOrderId: '203-1', PurchaseDate: '2026-09-12T10:00:00Z', OrderStatus: 'Unshipped',
    FulfillmentChannel: 'MFN', OrderTotal: { CurrencyCode: 'GBP', Amount: '79.00' },
    ShippingAddress: { CountryCode: 'GB' }, ...extra,
  });
  const item = (extra: Record<string, unknown> = {}) => ({
    SellerSKU: 'MR-100134', QuantityOrdered: 1, ItemPrice: { CurrencyCode: 'GBP', Amount: '79.00' }, ...extra,
  });

  /**
   * The whole point of storing this. `money()` turns an absent ItemTax and a reported zero into the
   * same 0, and 182 orders carrying no tax cannot be explained while those look identical.
   */
  it('keeps "no tax reported" distinguishable from "tax reported as zero"', () => {
    const absent = mapAmazonOrder(order(), [item()], 'GB');
    const zero = mapAmazonOrder(order(), [item({ ItemTax: { CurrencyCode: 'GBP', Amount: '0.00' } })], 'GB');

    expect(absent.items[0].payload.vatAmount).toBe(0);
    expect(zero.items[0].payload.vatAmount).toBe(0);

    expect((absent.items[0].payload.channelTaxRaw as any).ItemTax).toBeNull();
    expect((zero.items[0].payload.channelTaxRaw as any).ItemTax).toEqual({ CurrencyCode: 'GBP', Amount: '0.00' });
  });

  it('carries TaxCollection through even when the tax is nil', () => {
    const m = mapAmazonOrder(order(), [item({ TaxCollection: { Model: 'MarketplaceFacilitator', ResponsibleParty: 'Amazon Services' } })], 'GB');
    expect((m.items[0].payload.channelTaxRaw as any).TaxCollection.Model).toBe('MarketplaceFacilitator');
  });

  /** Null, not false: eBay and OnBuy never report it, and Amazon sometimes has no opinion either. */
  it('reports a business order only when Amazon actually says', () => {
    expect(mapAmazonOrder(order({ IsBusinessOrder: true }), [item()], 'GB').payload.isBusinessOrder).toBe(true);
    expect(mapAmazonOrder(order({ IsBusinessOrder: false }), [item()], 'GB').payload.isBusinessOrder).toBe(false);
    expect(mapAmazonOrder(order(), [item()], 'GB').payload.isBusinessOrder).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { mapEbayOrder } from './ebay-mapping';

/**
 * Who owes the VAT on an eBay sale, and therefore whether `lineItem.total` is net or gross.
 *
 * eBay reports one number for the line either way, so the number alone cannot tell the two apart.
 * Getting it wrong is not a rounding problem: treating a gross total as net books the VAT as
 * revenue, overstates profit by the whole tax, and leaves nothing registered to remit.
 */

const vatRates: Record<string, { euVatZone: boolean; vatRate: number }> = {
  DE: { euVatZone: true, vatRate: 19 },
  GR: { euVatZone: true, vatRate: 24 },
  CY: { euVatZone: true, vatRate: 19 },
  GB: { euVatZone: false, vatRate: 0 }, // post-Brexit: outside the EU VAT zone
  US: { euVatZone: false, vatRate: 0 },
};
const lookup = (iso: string) => vatRates[iso] ?? null;

/** One-line eBay order: `total` is whatever eBay paid out for the goods. */
const order = (opts: { dest: string; total: number; shipping?: number; collected?: number }) => ({
  orderId: 'ORD-1',
  creationDate: '2026-08-20T10:00:00.000Z',
  pricingSummary: { total: { value: String(opts.total), currency: 'EUR' } },
  fulfillmentStartInstructions: [{ shippingStep: { shipTo: { contactAddress: { countryCode: opts.dest } } } }],
  totalMarketplaceFee: { value: '0', currency: 'EUR' },
  lineItems: [{
    sku: 'SKU-1',
    quantity: 1,
    listingMarketplaceId: 'EBAY_DE',
    total: { value: String(opts.total), currency: 'EUR' },
    deliveryCost: { shippingCost: { value: String(opts.shipping ?? 0), currency: 'EUR' } },
    ebayCollectAndRemitTaxes: opts.collected ? [{ amount: { value: String(opts.collected), currency: 'EUR' } }] : [],
  }],
});

const line = (o: any, l = lookup) => mapEbayOrder(o, l).items[0].payload as any;

describe('eBay VAT: who owes it decides whether the total is net or gross', () => {
  it('extracts the destination VAT when eBay did not collect it', () => {
    // €119.00 gross at 19% → €100.00 net + €19.00 VAT.
    const p = line(order({ dest: 'DE', total: 119 }));
    expect(p.netSalesAmount).toBe(100);
    expect(p.vatAmount).toBe(19);
  });

  it('uses the DESTINATION rate, not the marketplace rate', () => {
    // Placed on eBay DE but shipped to Greece: 24%, not Germany's 19%.
    // €124.00 gross at 24% → €100.00 net. At 19% it would wrongly read €104.20.
    const p = line(order({ dest: 'GR', total: 124 }));
    expect(p.netSalesAmount).toBe(100);
    expect(p.vatAmount).toBe(24);
  });

  it('leaves the total alone when eBay collected and remitted the VAT', () => {
    // eBay adds its collected tax ON TOP of our price, so the total is already net and we owe
    // nothing. The collected amount is recorded for reporting only.
    const p = line(order({ dest: 'GB', total: 62.5, collected: 12.5 }));
    expect(p.netSalesAmount).toBe(62.5);
    expect(p.vatAmount).toBe(0);
    expect(p.salesTaxAmount).toBe(12.5);
  });

  it('does not extract twice when eBay collected on an EU destination', () => {
    // An IOSS-collected import into the EU is settled by eBay. Extracting as well would book a
    // VAT liability we do not have and understate revenue.
    const p = line(order({ dest: 'DE', total: 100, collected: 19 }));
    expect(p.netSalesAmount).toBe(100);
    expect(p.vatAmount).toBe(0);
    expect(p.salesTaxAmount).toBe(19);
  });

  it('extracts nothing for a destination outside the EU VAT zone', () => {
    const p = line(order({ dest: 'US', total: 100 }));
    expect(p.netSalesAmount).toBe(100);
    expect(p.vatAmount).toBe(0);
  });

  it('extracts nothing when the destination country is unknown to us', () => {
    // A guessed rate is worse than a visible zero — it would silently misstate the liability.
    const p = line(order({ dest: 'ZZ', total: 119 }));
    expect(p.netSalesAmount).toBe(119);
    expect(p.vatAmount).toBe(0);
  });

  it('extracts nothing when no lookup is supplied at all', () => {
    const p = (mapEbayOrder(order({ dest: 'DE', total: 119 })).items[0].payload as any);
    expect(p.netSalesAmount).toBe(119);
    expect(p.vatAmount).toBe(0);
  });

  it('splits buyer-paid shipping too, at the same rate', () => {
    // Shipping the buyer paid is part of the same taxable supply; leaving it gross would leave
    // VAT unremitted on it and overstate revenue.
    const p = line(order({ dest: 'DE', total: 119, shipping: 11.9 }));
    expect(p.shippingAmount).toBe(10);
    expect(p.shippingAmountVat).toBe(1.9);
  });

  it('reconciles: net + VAT always equals what the buyer paid', () => {
    // Derived by subtraction rather than computed independently, so no cent goes missing on
    // amounts that do not divide cleanly.
    for (const total of [9.99, 19.95, 21.88, 44.52, 151.05, 305.44, 0.01]) {
      const p = line(order({ dest: 'DE', total }));
      expect(Math.round((p.netSalesAmount + p.vatAmount) * 100) / 100).toBe(total);
    }
  });

  it('handles a zero total without dividing by anything odd', () => {
    const p = line(order({ dest: 'DE', total: 0 }));
    expect(p.netSalesAmount).toBe(0);
    expect(p.vatAmount).toBe(0);
  });
});

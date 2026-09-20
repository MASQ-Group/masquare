import { describe, expect, it } from 'vitest';
import { ebayOfferRows } from './ebay-offer-rows';

const item = { sku: 'LAG-612676', title: 'Victorinox card wallet', quantity: 3 };

/** What eBay answers for a SKU eBaymag has republished: one offer per site. */
const offers = [
  { marketplaceId: 'EBAY_GB', availableQuantity: 3, status: 'PUBLISHED', pricingSummary: { price: { value: '69.00', currency: 'GBP' } }, listing: { listingId: '267790041287' } },
  { marketplaceId: 'EBAY_DE', availableQuantity: 2, status: 'PUBLISHED', pricingSummary: { price: { value: '79.00', currency: 'EUR' } }, listing: { listingId: '267790041288' } },
  { marketplaceId: 'EBAY_FR', status: 'PUBLISHED', pricingSummary: { price: { value: '79.00', currency: 'EUR' } }, listing: { listingId: '267790041289' } },
];

describe('an eBay SKU across its marketplaces', () => {
  /**
   * The bug this exists for: the account-wide sync kept offers[0], so a product listed in four
   * countries was recorded as listed in Britain alone — and then deleted the other three, because
   * that sync replaces a channel's rows with what it found.
   */
  it('gives one row per marketplace, not one row for the SKU', () => {
    const rows = ebayOfferRows(item, offers);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.marketplace)).toEqual(['GB', 'DE', 'FR']);
    expect(rows.map((r) => r.externalId)).toEqual(['267790041287', '267790041288', '267790041289']);
  });

  it('carries each market’s own price, currency and stock', () => {
    const [gb, de] = ebayOfferRows(item, offers);
    expect(gb).toMatchObject({ price: 69, currency: 'GBP', quantity: 3, status: 'PUBLISHED' });
    expect(de).toMatchObject({ price: 79, currency: 'EUR', quantity: 2 });
  });

  /** An offer that states no quantity of its own falls back to the item's. */
  it('falls back to the item’s quantity where an offer states none', () => {
    expect(ebayOfferRows(item, offers)[2].quantity).toBe(3);
  });

  /** eBay manages the SKU; it is simply offered nowhere. Recording nothing would lose it. */
  it('still records a SKU with no offers', () => {
    const rows = ebayOfferRows(item, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sku: 'LAG-612676', marketplace: null, price: null, externalId: null, quantity: 3 });
  });

  it('is safe on an answer missing the parts it reads', () => {
    const rows = ebayOfferRows({ sku: 'X', title: null, quantity: null }, [{ marketplaceId: 'EBAY_IT' }]);
    expect(rows[0]).toMatchObject({ marketplace: 'IT', price: null, currency: null, status: null, externalId: null, quantity: null });
  });
});

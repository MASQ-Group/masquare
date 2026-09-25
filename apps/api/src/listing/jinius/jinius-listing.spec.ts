import { describe, expect, it } from 'vitest';
import {
  JINIUS_STATE_NEW, jiniusNewOfferBody, jiniusOfferIdentity, missingForJiniusListing, warningsForJiniusListing,
  type JiniusListingInput,
} from './jinius-listing';

const input = (o: Partial<JiniusListingInput> = {}): JiniusListingInput => ({
  sku: 'IT49693', productId: '9312432024686', productIdType: 'EAN', price: 129.95, stock: 4,
  condition: 'NEW', alreadyListed: false, ...o,
});

describe('what stops a Jinius offer being created', () => {
  it('lets a complete one through', () => {
    expect(missingForJiniusListing(input())).toEqual([]);
  });

  /**
   * "They do not carry it" is not a field somebody forgot to fill in — it is a fact about their
   * catalogue, and it leads to a product import rather than to an edit. Said in those words.
   */
  it('names a product their catalogue does not hold', () => {
    expect(missingForJiniusListing(input({ productId: null }))[0]).toContain('does not carry this product');
  });

  it('refuses without a SKU or a price, and refuses to create one that exists', () => {
    expect(missingForJiniusListing(input({ sku: null }))[0]).toContain('No SKU');
    expect(missingForJiniusListing(input({ price: 0 }))[0]).toContain('No price');
    expect(missingForJiniusListing(input({ alreadyListed: true }))[0]).toContain('already exists');
  });

  /** No stock is worth saying and not worth refusing over: the push corrects it when there is some. */
  it('warns about an empty shelf rather than blocking on it', () => {
    expect(missingForJiniusListing(input({ stock: 0 }))).toEqual([]);
    expect(warningsForJiniusListing(input({ stock: 0 }))[0]).toContain('nothing to sell');
    expect(warningsForJiniusListing(input())).toEqual([]);
  });
});

describe('the offer we would send', () => {
  it('creates rather than updates, and carries only what we decided', () => {
    expect(jiniusNewOfferBody(input()).offers[0]).toEqual({
      shop_sku: 'IT49693', product_id: '9312432024686', product_id_type: 'EAN',
      price: 129.95, quantity: 4, state_code: JINIUS_STATE_NEW, update_delete: 'new',
    });
  });

  it('sends whole, never-negative units and a price rounded to the cent', () => {
    const o = jiniusNewOfferBody(input({ stock: -2, price: 19.999 })).offers[0];
    expect(o).toMatchObject({ quantity: 0, price: 20 });
  });
});

describe('what an offer is attached to', () => {
  /**
   * Jinius answers a lookup in a shape of its own, so their product id is often not in it. The
   * barcode we asked with is then the honest identifier: it is the one their catalogue matched on,
   * because it is what found the product at all.
   */
  it('prefers their own product id, and falls back to the barcode that found it', () => {
    expect(jiniusOfferIdentity({ productId: 'JIN-55', productIdType: 'SHOP_SKU' }, '123'))
      .toEqual({ productId: 'JIN-55', productIdType: 'SHOP_SKU' });
    expect(jiniusOfferIdentity({ productId: null, productIdType: null }, '9312432024686'))
      .toEqual({ productId: '9312432024686', productIdType: 'EAN' });
    expect(jiniusOfferIdentity(null, null)).toEqual({ productId: null, productIdType: null });
  });
});

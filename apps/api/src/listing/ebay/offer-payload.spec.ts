import { describe, expect, it } from 'vitest';
import { buildInventoryItem, buildOffer, ebaySafeSku, missingForPublish, type EbayOfferInput } from './offer-payload';

const base: EbayOfferInput = {
  sku: '3G08437824100',
  title: 'Pioneer DEH-S320BT 1-DIN CD Tuner with Bluetooth',
  descriptionHtml: '<p>A car stereo.</p>',
  imageUrls: ['https://example.com/a.jpg'],
  brand: 'Pioneer',
  mpn: 'DEH-S320BT',
  ean: '4988028345678',
  condition: 'NEW',
  quantity: 1,
  priceValue: 129.99,
  currency: 'GBP',
  marketplaceId: 'EBAY_GB',
  categoryId: '32819',
  merchantLocationKey: 'MAIN',
  fulfillmentPolicyId: '242255725017',
  paymentPolicyId: '242220055017',
  returnPolicyId: '242211912017',
};

describe('ebaySafeSku', () => {
  it('strips what eBay refuses', () => {
    // Real SKUs from the catalogue. eBay allows alphanumerics only.
    expect(ebaySafeSku('3G-084-378-24-100/0')).toBe('3G084378241000');
    expect(ebaySafeSku('4B-DEH-S320BT')).toBe('4BDEHS320BT');
    expect(ebaySafeSku('RE-MB4120')).toBe('REMB4120');
  });

  it('cuts at 50 characters, because eBay rejects longer', () => {
    expect(ebaySafeSku('A'.repeat(80))).toHaveLength(50);
  });

  it('can collide, which is why the mapping is stored and not recomputed', () => {
    // These are different products and the same eBay SKU. Nothing here can prevent that; the
    // listing row records which SKU was actually used so the collision is visible, not silent.
    expect(ebaySafeSku('AB-12')).toBe(ebaySafeSku('A-B12'));
  });
});

describe('missingForPublish', () => {
  it('is silent when everything eBay needs is present', () => {
    expect(missingForPublish(base)).toEqual([]);
  });

  it('reports everything at once rather than one 400 at a time', () => {
    const bare = { ...base, title: null, descriptionHtml: null, imageUrls: [], categoryId: null, merchantLocationKey: null };
    const keys = missingForPublish(bare).map((m) => m.key);
    expect(keys).toContain('title');
    expect(keys).toContain('description');
    expect(keys).toContain('images');
    expect(keys).toContain('categoryId');
    expect(keys).toContain('merchantLocationKey');
  });

  it('treats a zero price as missing but a zero quantity as real', () => {
    // Out of stock is a legitimate state to list in. Free is never intentional.
    expect(missingForPublish({ ...base, priceValue: 0 }).map((m) => m.key)).toContain('price');
    expect(missingForPublish({ ...base, quantity: 0 }).map((m) => m.key)).not.toContain('quantity');
    expect(missingForPublish({ ...base, quantity: null }).map((m) => m.key)).toContain('quantity');
  });

  it('demands every policy, because eBay refuses the publish without them', () => {
    for (const k of ['fulfillmentPolicyId', 'paymentPolicyId', 'returnPolicyId'] as const) {
      expect(missingForPublish({ ...base, [k]: null }).map((m) => m.key)).toContain(k);
    }
  });
});

describe('buildInventoryItem', () => {
  it('truncates the title at 80, which is eBay’s hard limit', () => {
    const long = 'x'.repeat(200);
    expect(buildInventoryItem({ ...base, title: long }).product.title).toHaveLength(80);
  });

  it('caps bullet points at five and 500 characters each', () => {
    const item = buildInventoryItem({ ...base, keyFeatures: Array.from({ length: 9 }, () => 'y'.repeat(900)) });
    expect(item.product.bulletPoints).toHaveLength(5);
    expect(item.product.bulletPoints![0]).toHaveLength(500);
  });

  it('sends the quantity as a whole number', () => {
    // Availability is an integer to eBay; a fractional quantity is not a thing it will accept.
    expect(buildInventoryItem({ ...base, quantity: 2.7 }).availability.shipToLocationAvailability.quantity).toBe(2);
    expect(buildInventoryItem({ ...base, quantity: -5 }).availability.shipToLocationAvailability.quantity).toBe(0);
  });
});

describe('buildOffer', () => {
  it('carries the price as a string, which is what eBay expects', () => {
    const offer = buildOffer(base);
    expect(offer.pricingSummary.price).toEqual({ value: '129.99', currency: 'GBP' });
  });

  it('names the marketplace and the policies on the offer, not the item', () => {
    // One inventory item can carry an offer per marketplace, each with its own price and policies.
    const offer = buildOffer(base);
    expect(offer.marketplaceId).toBe('EBAY_GB');
    expect(offer.listingPolicies.fulfillmentPolicyId).toBe('242255725017');
    expect(offer.format).toBe('FIXED_PRICE');
  });
});

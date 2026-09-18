import { describe, expect, it } from 'vitest';
import { buildInventoryItem, buildOffer, ebaySafeSku, itemDescription, missingForPublish, offerUpdateBody, type EbayOfferInput } from './offer-payload';

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
  it('sends the product SKU exactly as it is, punctuation and all', () => {
    // Stripping these made orders for them arrive belonging to no product. 4,508 of the account's
    // 4,762 eBay listings already carry a hyphen, so eBay is not the one objecting.
    expect(ebaySafeSku('LE-83306')).toBe('LE-83306');
    expect(ebaySafeSku('3G-084-378-24-100/0')).toBe('3G-084-378-24-100/0');
    expect(ebaySafeSku('RE-MB4120')).toBe('RE-MB4120');
  });

  it('trims the ends, which are never part of a SKU', () => {
    expect(ebaySafeSku('  LE-83306 ')).toBe('LE-83306');
  });

  it('cuts at 50 characters, the one limit eBay documents', () => {
    expect(ebaySafeSku('A'.repeat(80))).toHaveLength(50);
  });

  it('no longer merges two products into one eBay SKU', () => {
    // Stripping made these the same SKU. Two products listed under one SKU is a listing that sells
    // the wrong goods; sending them as they are keeps them apart.
    expect(ebaySafeSku('AB-12')).not.toBe(ebaySafeSku('A-B12'));
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

describe('required item specifics', () => {
  it('sends Model, because a category can require it and only says so on refusal', () => {
    // Table Top Blenders (133704) has exactly one required aspect: Model. The publish failed with
    // "The item specific Model is missing" after the item and offer had both been accepted — so
    // this is not something a payload check can catch, only a category can tell you.
    const aspects = buildInventoryItem(base).product.aspects as Record<string, string[]>;
    expect(aspects.Model).toEqual(['DEH-S320BT']);
    expect(aspects.Brand).toEqual(['Pioneer']);
    expect(aspects.MPN).toEqual(['DEH-S320BT']);
  });

  it('lets the caller override a default when the category means something else by it', () => {
    const aspects = buildInventoryItem({ ...base, extraAspects: { Model: ['NBP003NBL'], Capacity: ['0.5 L'] } })
      .product.aspects as Record<string, string[]>;
    expect(aspects.Model).toEqual(['NBP003NBL']);
    expect(aspects.Capacity).toEqual(['0.5 L']);
    expect(aspects.Brand).toEqual(['Pioneer']); // untouched defaults survive
  });

  it('ignores an empty override rather than sending an empty aspect', () => {
    const aspects = buildInventoryItem({ ...base, extraAspects: { Colour: [] } }).product.aspects as Record<string, string[]>;
    expect(aspects.Colour).toBeUndefined();
  });

  it('omits Model when there is no part number to derive it from', () => {
    const aspects = buildInventoryItem({ ...base, mpn: null }).product.aspects as Record<string, string[]>;
    expect(aspects.Model).toBeUndefined();
    expect(aspects.MPN).toBeUndefined();
  });
});

describe('the description in both payloads', () => {
  /** The refusal: "Invalid value for description. The length should be between 1 and 4000 characters." */
  it('keeps the inventory item inside the 4000 characters eBay allows', () => {
    const long = `<p>${'A well made watch. '.repeat(400)}</p>`;
    const item = buildInventoryItem({ ...base, descriptionHtml: long });
    expect(item.product.description.length).toBeLessThanOrEqual(4000);
    expect(item.product.description.endsWith('…')).toBe(true);
    // Cut between words, not through one.
    expect(item.product.description).not.toMatch(/A well made watc…$/);
  });

  it('leaves a short description exactly as it reads, without markup', () => {
    expect(buildInventoryItem(base).product.description).toBe('A car stereo.');
  });

  /** Buyers read the offer's description, so the house design must survive in full. */
  it('sends the designed html on the offer, whether or not a handling time is set', () => {
    const html = `<div style="font:14px Inter">${'<p>Words.</p>'.repeat(500)}</div>`;
    expect(buildOffer({ ...base, descriptionHtml: html }).listingDescription).toBe(html);
    expect(buildOffer({ ...base, descriptionHtml: html, handlingTimeDays: 2 }).listingDescription).toBe(html);
    expect(buildInventoryItem({ ...base, descriptionHtml: html }).product.description.length).toBeLessThanOrEqual(4000);
  });

  it('sends no listing description rather than an empty one', () => {
    expect(buildOffer({ ...base, descriptionHtml: null })).not.toHaveProperty('listingDescription');
    expect(buildOffer({ ...base, descriptionHtml: '   ' })).not.toHaveProperty('listingDescription');
  });
});

describe('itemDescription', () => {
  it('reads as text, not markup', () => {
    expect(itemDescription('<p>Water resistant to 50&nbsp;m</p><ul><li>Alarm</li></ul>'))
      .toBe('Water resistant to 50 m\n\nAlarm');
  });

  it('is empty when there is nothing to say', () => {
    expect(itemDescription(null)).toBe('');
    expect(itemDescription('<p></p>')).toBe('');
  });
});

describe('offerUpdateBody', () => {
  /** The refusal that would not go away: a reused offer kept its first description. */
  it('carries the current description and price to an offer eBay already holds', () => {
    const body = offerUpdateBody(buildOffer({ ...base, descriptionHtml: '<p>New words</p>', priceValue: 99.5 }));
    expect(body.listingDescription).toBe('<p>New words</p>');
    expect(body.pricingSummary.price.value).toBe('99.5');
    expect(body.listingPolicies.fulfillmentPolicyId).toBe(base.fulfillmentPolicyId);
  });

  it('leaves out what identifies the offer, which the update call does not accept', () => {
    const body = offerUpdateBody(buildOffer(base)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('sku');
    expect(body).not.toHaveProperty('marketplaceId');
    expect(body).not.toHaveProperty('format');
  });
});

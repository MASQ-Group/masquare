import { describe, expect, it } from 'vitest';
import { buildOfferAttributes, CONDITION_CODES, type OfferInput } from './offer-payload';

const base: OfferInput = {
  asin: 'B00ABCDEFG',
  marketplaceId: 'A1F83G8C2ARO7P',
  currency: 'GBP',
  priceCents: 4999,
  quantity: 12,
  handlingTimeDays: 2,
};

describe('buildOfferAttributes', () => {
  it('carries the four things an offer cannot go without', () => {
    const { attributes, missing } = buildOfferAttributes(base);
    expect(missing).toEqual([]);
    expect(attributes.merchant_suggested_asin).toEqual([{ marketplace_id: base.marketplaceId, value: 'B00ABCDEFG' }]);
    expect(attributes.condition_type).toEqual([{ marketplace_id: base.marketplaceId, value: 'new_new' }]);
    expect(attributes.purchasable_offer).toEqual([
      { marketplace_id: base.marketplaceId, currency: 'GBP', our_price: [{ schedule: [{ value_with_tax: 49.99 }] }] },
    ]);
    expect(attributes.fulfillment_availability).toEqual([
      { fulfillment_channel_code: 'DEFAULT', quantity: 12, lead_time_to_ship_max_days: 2 },
    ]);
  });

  it('names what is missing instead of sending a half-built offer', () => {
    const { missing } = buildOfferAttributes({ ...base, asin: '', priceCents: null, quantity: null, handlingTimeDays: null });
    expect(missing.map((m) => m.key).sort()).toEqual(['asin', 'handlingTime', 'price', 'quantity']);
  });

  it('treats zero quantity as an answer and zero price as a mistake', () => {
    const zeroQty = buildOfferAttributes({ ...base, quantity: 0 });
    expect(zeroQty.missing).toEqual([]);
    expect(zeroQty.attributes.fulfillment_availability).toEqual([
      { fulfillment_channel_code: 'DEFAULT', quantity: 0, lead_time_to_ship_max_days: 2 },
    ]);

    // A zero price is never intended, and Amazon would accept it.
    const zeroPrice = buildOfferAttributes({ ...base, priceCents: 0 });
    expect(zeroPrice.missing.map((m) => m.key)).toContain('price');
    expect(zeroPrice.attributes.purchasable_offer).toBeUndefined();
  });

  it('stamps every marketplace-scoped attribute, because an unstamped value applies to nothing', () => {
    const { attributes } = buildOfferAttributes({ ...base, countryOfOrigin: 'de', warrantyText: '2 years' });
    for (const key of ['merchant_suggested_asin', 'condition_type', 'purchasable_offer', 'country_of_origin', 'warranty_description']) {
      const value = attributes[key] as Array<Record<string, unknown>>;
      expect(value[0].marketplace_id, `${key} is not stamped`).toBe(base.marketplaceId);
    }
    // Fulfilment availability is per listing, not per marketplace — it must NOT be stamped.
    expect((attributes.fulfillment_availability as Array<Record<string, unknown>>)[0].marketplace_id).toBeUndefined();
  });

  it('sends measurements with their units', () => {
    const { attributes } = buildOfferAttributes({
      ...base, packageWeightKg: 1.234, packageLengthCm: 30.5, packageWidthCm: 20, packageHeightCm: 10,
    });
    expect(attributes.item_package_weight).toEqual([{ marketplace_id: base.marketplaceId, value: 1.23, unit: 'kilograms' }]);
    expect(attributes.item_package_dimensions).toEqual([{
      marketplace_id: base.marketplaceId,
      length: { value: 30.5, unit: 'centimeters' },
      width: { value: 20, unit: 'centimeters' },
      height: { value: 10, unit: 'centimeters' },
    }]);
  });

  it('omits dimensions unless all three are known', () => {
    const { attributes } = buildOfferAttributes({ ...base, packageLengthCm: 30, packageWidthCm: 20, packageHeightCm: null });
    expect(attributes.item_package_dimensions).toBeUndefined();
  });

  it('states "not dangerous goods" positively rather than by omission', () => {
    const none = buildOfferAttributes({ ...base, hazmatCode: 'NONE' });
    expect(none.attributes.supplier_declared_dg_hz_regulation).toEqual([
      { marketplace_id: base.marketplaceId, value: 'not_applicable' },
    ]);

    const lithium = buildOfferAttributes({ ...base, hazmatCode: 'UN3481' });
    expect(lithium.attributes.supplier_declared_dg_hz_regulation).toEqual([
      { marketplace_id: base.marketplaceId, value: 'un3481' },
    ]);

    // Not stated at all stays absent — silence and "not regulated" are different claims.
    const unstated = buildOfferAttributes(base);
    expect(unstated.attributes.supplier_declared_dg_hz_regulation).toBeUndefined();
  });

  it('keeps false battery_required, which is a claim and not an empty value', () => {
    const { attributes } = buildOfferAttributes({ ...base, batteryRequired: false });
    expect(attributes.batteries_required).toEqual([{ marketplace_id: base.marketplaceId, value: false }]);
  });

  it('maps our conditions onto Amazon codes', () => {
    expect(CONDITION_CODES.NEW).toBe('new_new');
    const openBox = buildOfferAttributes({ ...base, conditionType: CONDITION_CODES.OPEN_BOX });
    expect(openBox.attributes.condition_type).toEqual([{ marketplace_id: base.marketplaceId, value: 'used_like_new' }]);
  });

  it('rounds money to two places so Amazon does not reject a floating tail', () => {
    const { attributes } = buildOfferAttributes({ ...base, priceCents: 1999 });
    const offer = (attributes.purchasable_offer as any)[0];
    expect(offer.our_price[0].schedule[0].value_with_tax).toBe(19.99);
  });
});

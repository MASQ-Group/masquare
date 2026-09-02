import { describe, expect, it } from 'vitest';
import { buildOfferAttributes, mergeOverLiveAttributes, type OfferInput } from './offer-payload';

/**
 * A submission is a PUT, and PUT REPLACES the whole listing item. For a new listing that is right.
 * For a SKU Amazon already holds — which is what a re-list to repair a broken listing is — sending
 * our plan alone silently deletes everything the plan has no opinion about.
 *
 * Diffing the payload our plan builds against what Amazon actually held for 4B-DEH-S320BT on
 * Amazon UK showed the PUT would have:
 *   - DROPPED merchant_shipping_group entirely, losing the seller's shipping template
 *   - CUT fulfillment_availability from seven entries to one, wiping DEFAULT_SA, DEFAULT_JP,
 *     DEFAULT_NA, DEFAULT_AU, DEFAULT_AE and DEFAULT_SG — the remote-fulfilment channels serving
 *     the other marketplaces, each holding a quantity of 1
 *
 * Amazon reports none of that back. The listing simply loses the attributes.
 *
 * These pin the merge against the live attributes as they were read that day.
 */

const MARKETPLACE_UK = 'A1F83G8C2ARO7P';

/** The attributes Amazon held for 4B-DEH-S320BT, trimmed to the ones the diff flagged. */
const liveAttributes: Record<string, unknown> = {
  merchant_suggested_asin: [{ marketplace_id: MARKETPLACE_UK, value: 'B01BM58XJQ' }],
  condition_type: [{ marketplace_id: MARKETPLACE_UK, value: 'new_new' }],
  merchant_shipping_group: [{ marketplace_id: MARKETPLACE_UK, value: 'legacy-template-id' }],
  purchasable_offer: [
    {
      marketplace_id: MARKETPLACE_UK,
      currency: 'GBP',
      audience: 'ALL',
      our_price: [{ schedule: [{ value_with_tax: 199.99 }] }],
    },
  ],
  fulfillment_availability: [
    { fulfillment_channel_code: 'DEFAULT', quantity: 3, lead_time_to_ship_max_days: 2 },
    { fulfillment_channel_code: 'DEFAULT_SA', quantity: 1 },
    { fulfillment_channel_code: 'DEFAULT_JP', quantity: 1 },
    { fulfillment_channel_code: 'DEFAULT_NA', quantity: 1 },
    { fulfillment_channel_code: 'DEFAULT_AU', quantity: 1 },
    { fulfillment_channel_code: 'DEFAULT_AE', quantity: 1 },
    { fulfillment_channel_code: 'DEFAULT_SG', quantity: 1 },
  ],
  // Catalogue attributes the plan has never modelled, and which we would nonetheless have replaced.
  item_name: [{ marketplace_id: MARKETPLACE_UK, value: 'Dehumidifier S320BT' }],
  brand: [{ marketplace_id: MARKETPLACE_UK, value: '4B' }],
};

/** What our plan builds for the same SKU: an offer, and nothing else. */
const plan: OfferInput = {
  asin: 'B01BM58XJQ',
  marketplaceId: MARKETPLACE_UK,
  currency: 'GBP',
  priceCents: 18398,
  quantity: 5,
  handlingTimeDays: 2,
};

describe('re-listing a SKU Amazon already holds', () => {
  const ours = buildOfferAttributes(plan).attributes;
  const merged = mergeOverLiveAttributes(liveAttributes, ours);

  it('keeps the shipping template the plan knows nothing about', () => {
    // The plan had no delivery template set, so its payload omits the attribute — which under a PUT
    // means "delete it", not "leave it alone".
    expect(ours.merchant_shipping_group).toBeUndefined();
    expect(merged.attributes.merchant_shipping_group).toEqual([
      { marketplace_id: MARKETPLACE_UK, value: 'legacy-template-id' },
    ]);
    expect(merged.carriedForward).toContain('merchant_shipping_group');
  });

  it('keeps the six remote-fulfilment channels and updates only our own', () => {
    const entries = merged.attributes.fulfillment_availability as Array<Record<string, unknown>>;
    const byChannel = new Map(entries.map((e) => [e.fulfillment_channel_code as string, e]));

    expect([...byChannel.keys()].sort()).toEqual([
      'DEFAULT', 'DEFAULT_AE', 'DEFAULT_AU', 'DEFAULT_JP', 'DEFAULT_NA', 'DEFAULT_SA', 'DEFAULT_SG',
    ]);
    // Ours wins on the channel we publish: the new quantity, not the stale 3.
    expect(byChannel.get('DEFAULT')).toEqual({
      fulfillment_channel_code: 'DEFAULT', quantity: 5, lead_time_to_ship_max_days: 2,
    });
    // And the other six survive exactly as Amazon holds them, quantity 1 each.
    for (const code of ['DEFAULT_SA', 'DEFAULT_JP', 'DEFAULT_NA', 'DEFAULT_AU', 'DEFAULT_AE', 'DEFAULT_SG']) {
      expect(byChannel.get(code)).toEqual({ fulfillment_channel_code: code, quantity: 1 });
    }
    expect([...merged.carriedFulfilmentChannels].sort()).toEqual([
      'DEFAULT_AE', 'DEFAULT_AU', 'DEFAULT_JP', 'DEFAULT_NA', 'DEFAULT_SA', 'DEFAULT_SG',
    ]);
  });

  it('keeps catalogue attributes the plan has never modelled', () => {
    expect(merged.attributes.item_name).toEqual(liveAttributes.item_name);
    expect(merged.attributes.brand).toEqual(liveAttributes.brand);
    expect(merged.carriedForward).toEqual(['brand', 'item_name', 'merchant_shipping_group']);
  });

  it('still replaces the price outright, because that is the only way to clear a stale currency', () => {
    // PATCH merges purchasable_offer by currency and refuses an empty value, so a EUR price left on
    // a GBP listing can only be removed by replacing the attribute. Merging it would keep the fault.
    expect(merged.attributes.purchasable_offer).toEqual([
      {
        marketplace_id: MARKETPLACE_UK,
        currency: 'GBP',
        our_price: [{ schedule: [{ value_with_tax: 183.98 }] }],
      },
    ]);
  });

  it('clears an offer in the wrong currency instead of leaving it beside the right one', () => {
    // The live UK listing carried a EUR price alongside the GBP one — Amazon had accepted it and
    // had no way to sell at it. One offer goes out, in the marketplace's own currency.
    const withStaleEur = {
      ...liveAttributes,
      purchasable_offer: [
        { marketplace_id: MARKETPLACE_UK, currency: 'EUR', our_price: [{ schedule: [{ value_with_tax: 210 }] }] },
        ...(liveAttributes.purchasable_offer as unknown[]),
      ],
    };
    const offers = mergeOverLiveAttributes(withStaleEur, ours).attributes.purchasable_offer as Array<Record<string, unknown>>;
    expect(offers).toHaveLength(1);
    expect(offers[0].currency).toBe('GBP');
  });

  it('leaves the ASIN binding and condition to the plan, which is authoritative on both', () => {
    expect(merged.attributes.merchant_suggested_asin).toEqual(ours.merchant_suggested_asin);
    expect(merged.attributes.condition_type).toEqual(ours.condition_type);
  });

  it('reports nothing carried forward when the live listing matches the plan exactly', () => {
    const same = mergeOverLiveAttributes(ours, ours);
    expect(same.attributes).toEqual(ours);
    expect(same.carriedForward).toEqual([]);
    expect(same.carriedFulfilmentChannels).toEqual([]);
  });

  it('does not mutate the live attributes it was handed', () => {
    // The caller keeps the live read for reporting; a merge that edited it in place would make the
    // "what did we carry forward" answer agree with itself no matter what happened.
    const live: Record<string, unknown> = { ...liveAttributes, fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: 3 }] };
    mergeOverLiveAttributes(live, ours);
    expect(live.fulfillment_availability).toEqual([{ fulfillment_channel_code: 'DEFAULT', quantity: 3 }]);
    expect(live.merchant_shipping_group).toEqual(liveAttributes.merchant_shipping_group);
  });
});

describe('a first listing, where there is nothing to merge', () => {
  it('sends the plan unchanged when Amazon holds no attributes for the SKU', () => {
    const ours = buildOfferAttributes(plan).attributes;
    const merged = mergeOverLiveAttributes({}, ours);
    expect(merged.attributes).toEqual(ours);
    expect(merged.carriedForward).toEqual([]);
    expect(merged.carriedFulfilmentChannels).toEqual([]);
  });

  it('does not invent a fulfilment list when our plan has no quantity to publish', () => {
    // Quantity missing is caught before submission; the merge must not turn it into a payload that
    // quietly drops Amazon's channels on the way through.
    const noQty = buildOfferAttributes({ ...plan, quantity: null }).attributes;
    const merged = mergeOverLiveAttributes(liveAttributes, noQty);
    expect(merged.attributes.fulfillment_availability).toEqual(liveAttributes.fulfillment_availability);
  });
});

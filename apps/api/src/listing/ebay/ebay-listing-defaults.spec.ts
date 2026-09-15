import { describe, expect, it } from 'vitest';
import { EMPTY_DEFAULTS, ebayListingDefaults, withEbayListingDefaults } from './ebay-listing-defaults';

describe('ebayListingDefaults', () => {
  it('reads the four choices out of the integration config', () => {
    const config = {
      sellerId: 'masquare',
      ebayListingDefaults: {
        merchantLocationKey: 'WAREHOUSE_1',
        fulfillmentPolicyId: '6100',
        paymentPolicyId: '6200',
        returnPolicyId: '6300',
      },
    };
    expect(ebayListingDefaults(config)).toEqual({
      merchantLocationKey: 'WAREHOUSE_1',
      fulfillmentPolicyId: '6100',
      paymentPolicyId: '6200',
      returnPolicyId: '6300',
    });
  });

  /** A channel nobody has set up yet must read as "not chosen", so the gate can say so. */
  it('reads anything missing or unreadable as not chosen', () => {
    expect(ebayListingDefaults(null)).toEqual(EMPTY_DEFAULTS);
    expect(ebayListingDefaults({})).toEqual(EMPTY_DEFAULTS);
    expect(ebayListingDefaults({ ebayListingDefaults: 'nonsense' })).toEqual(EMPTY_DEFAULTS);
    expect(ebayListingDefaults({ ebayListingDefaults: { fulfillmentPolicyId: '   ' } }).fulfillmentPolicyId).toBeNull();
  });
});

describe('withEbayListingDefaults', () => {
  it('keeps everything else in the config', () => {
    const out = withEbayListingDefaults({ sellerId: 'masquare', siteIds: ['EBAY_GB'] }, { paymentPolicyId: '6200' });
    expect(out.sellerId).toBe('masquare');
    expect(out.siteIds).toEqual(['EBAY_GB']);
  });

  it('leaves a choice alone when the change does not mention it', () => {
    const before = withEbayListingDefaults({}, { merchantLocationKey: 'WAREHOUSE_1', returnPolicyId: '6300' });
    const after = withEbayListingDefaults(before, { returnPolicyId: '6399' });
    expect(ebayListingDefaults(after)).toMatchObject({ merchantLocationKey: 'WAREHOUSE_1', returnPolicyId: '6399' });
  });

  /** Clearing one has to be possible: a policy deleted at eBay must be removable here. */
  it('clears a choice that is sent as empty', () => {
    const before = withEbayListingDefaults({}, { paymentPolicyId: '6200' });
    expect(ebayListingDefaults(withEbayListingDefaults(before, { paymentPolicyId: '' })).paymentPolicyId).toBeNull();
    expect(ebayListingDefaults(withEbayListingDefaults(before, { paymentPolicyId: null })).paymentPolicyId).toBeNull();
  });
});

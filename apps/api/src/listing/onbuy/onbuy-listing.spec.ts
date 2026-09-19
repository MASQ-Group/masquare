import { describe, expect, it } from 'vitest';
import {
  buildOnbuyActivateBody, buildOnbuyCreateBody, missingForOnbuyListing, onbuyCondition, onbuyErrorMessage, onbuyIdentity,
  parseOnbuyDeliveryTemplates, parseOnbuySearch, readOnbuyCreateResult, type OnbuyListingInput,
} from './onbuy-listing';

// Shapes from OnBuy's published API collection examples.
const SEARCH = {
  results: [
    { opc: 'PDN59RX', name: 'Double Sink Bathroom Vanity', url: 'https://www.onbuy.com/gb/p/x~p1/', thumbnail_url: 'https://cdn.onbuy.com/t.png', product_codes: ['4255664862990'] },
    { opc: 'P7279P', name: 'Something else', product_codes: ['9788876665264', '8876665269'] },
    { opc: 'PLONGER', name: 'Contains our digits', product_codes: ['14255664862990'] },
  ],
};

describe('finding the product on OnBuy', () => {
  it('offers only catalogue products that carry one of our barcodes exactly', () => {
    const c = parseOnbuySearch(SEARCH, ['4255664862990']);
    expect(c.map((x) => x.opc)).toEqual(['PDN59RX']);
    expect(c[0]).toMatchObject({ name: 'Double Sink Bathroom Vanity', matchedCode: '4255664862990', thumbnailUrl: 'https://cdn.onbuy.com/t.png' });
  });

  it('compares barcodes as digits, whatever spacing they were stored with', () => {
    expect(parseOnbuySearch(SEARCH, ['4 255664 862990']).map((x) => x.opc)).toEqual(['PDN59RX']);
  });

  it('returns nothing for a reply with no results rather than failing', () => {
    expect(parseOnbuySearch(null, ['4255664862990'])).toEqual([]);
    expect(parseOnbuySearch({ results: [] }, ['4255664862990'])).toEqual([]);
  });
});

describe('delivery templates', () => {
  it('groups OnBuy’s one-row-per-region list into templates, default first', () => {
    const t = parseOnbuyDeliveryTemplates({
      results: [
        { seller_delivery_template_id: 300, template_name: 'Heavy', country_sub_region: 'Mainland UK', delivery_charge_type: 'Fixed', delivery_time: '2-3 Days' },
        { seller_delivery_template_id: 245, template_name: 'Default', is_default_template: true, country_sub_region: 'Isles of Scilly', delivery_charge_type: 'Free Delivery', delivery_time: '3-5 Days' },
        { seller_delivery_template_id: 245, template_name: 'Default', is_default_template: true, country_sub_region: 'Mainland UK', delivery_charge_type: 'Free Delivery', delivery_time: '3-5 Days' },
      ],
    });
    expect(t.map((x) => x.id)).toEqual(['245', '300']);
    expect(t[0]).toMatchObject({ name: 'Default', isDefault: true });
    expect(t[0].summary).toEqual(['Isles of Scilly: Free Delivery, 3-5 Days', 'Mainland UK: Free Delivery, 3-5 Days']);
  });
});

const ready: OnbuyListingInput = {
  opc: 'PDN59RX', sku: 'LE-83306', condition: 'NEW', price: 24.99, stock: 5,
  deliveryTemplateId: '245', handlingTimeDays: 1, boostPct: 0,
};

describe('what a listing still needs', () => {
  it('needs nothing when every piece is there', () => {
    expect(missingForOnbuyListing(ready)).toEqual([]);
  });

  it('names each gap', () => {
    const gaps = missingForOnbuyListing({ ...ready, opc: null, price: 0, stock: 0, deliveryTemplateId: 'Default', boostPct: 7 });
    expect(gaps).toEqual([
      'the product found on OnBuy (step 1)',
      'a price',
      'stock above zero on the Availability page',
      'an OnBuy delivery template',
      'a boost of 0, 5, 10, 15, 20, 30%',
    ]);
  });

  it('lists new only', () => {
    expect(onbuyCondition('NEW')).toBe('new');
    expect(onbuyCondition('USED_GOOD')).toBeNull();
    expect(missingForOnbuyListing({ ...ready, condition: 'USED_GOOD' })[0]).toContain('condition New');
  });
});

describe('the requests', () => {
  it('creates one listing against the OPC with OnBuy’s field names', () => {
    expect(buildOnbuyCreateBody({ ...ready, price: 24.999 })).toEqual({
      listings: [{
        opc: 'PDN59RX', sku: 'LE-83306', condition: 'new', price: 25, stock: 5,
        delivery_template_id: 245, handling_time: 1, boost_marketing_commission: 0,
      }],
    });
  });

  it('leaves handling time out when none was set', () => {
    expect(buildOnbuyCreateBody({ ...ready, handlingTimeDays: null }).listings[0]).not.toHaveProperty('handling_time');
  });

  it('activates with price, stock and the chosen terms by SKU', () => {
    expect(buildOnbuyActivateBody(ready)).toEqual({ listings: [{ sku: 'LE-83306', price: 24.99, stock: 5, delivery_template_id: 245, boost_marketing_commission: 0 }] });
  });

  it('leaves the template out when none is chosen, so OnBuy uses the account default', () => {
    expect(buildOnbuyCreateBody({ ...ready, deliveryTemplateId: null, stock: 0 }).listings[0]).not.toHaveProperty('delivery_template_id');
    expect(buildOnbuyActivateBody({ ...ready, deliveryTemplateId: null }).listings[0]).not.toHaveProperty('delivery_template_id');
  });
});

describe('what the price check needs', () => {
  it('needs neither stock nor a template — only what places a listing', () => {
    expect(missingForOnbuyListing({ ...ready, stock: 0, deliveryTemplateId: null }, { forPriceCheck: true })).toEqual([]);
  });

  it('still needs the product, SKU and a provisional price', () => {
    expect(missingForOnbuyListing({ ...ready, opc: null, price: null, deliveryTemplateId: null }, { forPriceCheck: true }))
      .toEqual(['the product found on OnBuy (step 1)', 'a price']);
  });

  it('still refuses a template typed as free text', () => {
    expect(missingForOnbuyListing({ ...ready, deliveryTemplateId: 'Default' }, { forPriceCheck: true })[0]).toContain('delivery template');
  });

  it('is unchanged for the real listing, which needs both', () => {
    expect(missingForOnbuyListing({ ...ready, stock: 0, deliveryTemplateId: null })).toEqual([
      'stock above zero on the Availability page', 'an OnBuy delivery template',
    ]);
  });
});

describe('reading OnBuy’s replies', () => {
  it('reads the per-listing result of a create', () => {
    expect(readOnbuyCreateResult({ success: true, results: [{ success: true, created: true, product_listing_id: '144083098', opc: 'PDN59RX', sku: 'LE-83306' }] }, 'LE-83306'))
      .toEqual({ ok: true, created: true, listingId: '144083098', opc: 'PDN59RX', message: null });
  });

  it('reports a per-listing refusal even when the request as a whole succeeded', () => {
    expect(readOnbuyCreateResult({ success: true, results: [{ success: false, sku: 'LE-83306', message: 'Invalid delivery template' }] }, 'LE-83306'))
      .toMatchObject({ ok: false, message: 'Invalid delivery template' });
  });

  it('uses OnBuy’s own words for a refusal where it gave some', () => {
    expect(onbuyErrorMessage({ error: { message: 'Access denied' } }, 403)).toBe('Access denied');
    expect(onbuyErrorMessage(null, 502)).toBe('OnBuy answered 502');
  });
});

describe('whether to create', () => {
  it('creates when the SKU is not in use', () => {
    expect(onbuyIdentity({ sku: 'LE-83306', opc: 'PDN59RX', planStatus: 'READY', existing: [] }).action).toBe('create');
  });

  it('says it is done when the SKU is already on this product', () => {
    expect(onbuyIdentity({ sku: 'LE-83306', opc: 'PDN59RX', planStatus: 'READY', existing: [{ sku: 'LE-83306', opc: 'PDN59RX' }] }).action).toBe('listed');
  });

  it('refuses, naming the product, when the SKU is on a different one', () => {
    const r = onbuyIdentity({ sku: 'LE-83306', opc: 'PDN59RX', planStatus: 'READY', existing: [{ sku: 'LE-83306', opc: 'POTHER' }] });
    expect(r).toEqual({ action: 'refuse', reason: expect.stringContaining('POTHER') });
  });
});

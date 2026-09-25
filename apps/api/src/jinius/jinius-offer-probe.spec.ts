import { describe, expect, it } from 'vitest';
import { readJiniusOfferDetail, readOfferQuantityVerdict } from './jinius-offer-probe';

/** OF21's answer for one offer, with a second quantity-ish field of the operator's own. */
const page = {
  offers: [
    { offer_id: 1, shop_sku: 'OTHER', quantity: 9 },
    {
      offer_id: 2, shop_sku: '65-16567828', product_title: 'Fujifilm INSTAX Mini Film',
      quantity: 3, available_quantity: 1, price: 12.5, active: true, state_code: '11',
      logistic_class: { code: 'STD', label: 'Standard' },
    },
  ],
};

describe('one offer, as Jinius describes it', () => {
  it('finds the offer by our own SKU, whatever case it was asked in', () => {
    expect(readJiniusOfferDetail(page, ' 65-16567828 ')?.shopSku).toBe('65-16567828');
    expect(readJiniusOfferDetail(page, 'nothing-like-it')).toBeNull();
  });

  /**
   * The whole point is to find a field nobody anticipated, so nothing is dropped: anything whose
   * name suggests stock comes first, nested objects are kept, and the rest stays in their order.
   */
  it('puts every field that could be a stock figure first, and keeps the rest', () => {
    const d = readJiniusOfferDetail(page, '65-16567828')!;
    expect(d.fields.slice(0, 2).map((f) => f.name)).toEqual(['quantity', 'available_quantity']);
    expect(d.fields.find((f) => f.name === 'logistic_class.code')?.value).toBe('STD');
    expect(d.fields.some((f) => f.name === 'price')).toBe(true);
  });

  it('states the comparison rather than leaving it to be made from a field list', () => {
    const d = readJiniusOfferDetail(page, '65-16567828');
    const said = readOfferQuantityVerdict(d, 3, '65-16567828');
    expect(said).toContain('quantity = 3');
    expect(said).toContain('available_quantity = 1');
    expect(said).toContain('platform holds 3');
  });

  /** Not found is an answer too, and it says how hard we looked. */
  it('says plainly when Jinius returned no such offer', () => {
    expect(readOfferQuantityVerdict(null, null, 'X-1')).toContain('no offer with shop SKU X-1');
  });
});

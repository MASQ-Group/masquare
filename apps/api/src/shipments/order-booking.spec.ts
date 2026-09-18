import { describe, expect, it } from 'vitest';
import { orderCustomsItems, originIso, suggestedParcelKg, type OrderLineForBooking } from './order-booking';

const names = new Map([['china', 'CN'], ['germany', 'DE']]);

const line = (over: Partial<OrderLineForBooking> = {}): OrderLineForBooking => ({
  sku: 'LE-83306',
  quantity: '2.000',
  netSalesAmount: 59.9,
  product: { title: 'Handheld massager', hsCode: '9019.10.10', countryOfOrigin: 'CN', packageWeightKg: '0.750', productWeightKg: '0.500' },
  ...over,
});

describe('a country of origin', () => {
  it('passes two letters through in capitals', () => {
    expect(originIso('cn', names)).toBe('CN');
  });

  it('reads a name from our countries table', () => {
    expect(originIso('China', names)).toBe('CN');
  });

  it('leaves what it cannot read empty for a person, rather than guessing', () => {
    expect(originIso('Made in PRC', names)).toBeNull();
    expect(originIso(null, names)).toBeNull();
  });
});

describe('an order as customs lines', () => {
  it('takes description, quantity, net value, weight, origin and HS code from the order and catalogue', () => {
    const [item] = orderCustomsItems([line()], 'gbp', names);
    expect(item).toEqual({
      sku: 'LE-83306', description: 'Handheld massager', quantity: 2, value: 59.9, currency: 'GBP',
      weightKg: 1.5, weightKnown: true, countryOfOrigin: 'CN', hsCode: '90191010',
    });
  });

  it('weighs by the product itself when there is no package weight', () => {
    const [item] = orderCustomsItems([line({ product: { ...line().product!, packageWeightKg: null } })], 'EUR', names);
    expect(item.weightKg).toBe(1);
  });

  it('says so when the catalogue has no weight at all, rather than weighing it at nothing silently', () => {
    const [item] = orderCustomsItems([line({ product: { ...line().product!, packageWeightKg: null, productWeightKg: null } })], 'EUR', names);
    expect(item).toMatchObject({ weightKg: 0, weightKnown: false });
  });

  it('keeps a fractional quantity for the export gate to refuse, rather than rounding it', () => {
    const [item] = orderCustomsItems([line({ quantity: '1.500' })], 'EUR', names);
    expect(item.quantity).toBe(1.5);
  });

  it('falls back to the SKU where the line has no product', () => {
    const [item] = orderCustomsItems([line({ product: null })], null, names);
    expect(item).toMatchObject({ description: 'LE-83306', currency: 'EUR', hsCode: null, countryOfOrigin: null });
  });
});

describe('the first parcel suggested', () => {
  it('weighs what the lines weigh, so the two agree from the start', () => {
    expect(suggestedParcelKg([{ weightKg: 1.5 }, { weightKg: 0.25 }])).toBe(1.75);
    expect(suggestedParcelKg([{ weightKg: 0 }])).toBeNull();
  });
});

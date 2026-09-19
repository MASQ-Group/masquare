import { describe, expect, it } from 'vitest';
import { parseOnbuyWinning, priceToBeat } from './onbuy-winning';

describe('reading Check Winning', () => {
  it('reads OnBuy’s documented shape, prices as numbers', () => {
    const rows = parseOnbuyWinning({ success: true, results: [
      { sku: 'LE-83306', price: '41.99', item_price: '41.99', delivery_price: '0.00', lead_price: '40.41', lead_item_price: '40.41', lead_delivery_price: '0.00', winning: false },
      { sku: 'SM-test123', price: '79.99', item_price: null, delivery_price: null, lead_price: null, lead_item_price: null, lead_delivery_price: null, winning: false },
    ] });
    expect(rows[0]).toEqual({ sku: 'LE-83306', price: 41.99, itemPrice: 41.99, deliveryPrice: 0, leadPrice: 40.41, leadItemPrice: 40.41, leadDeliveryPrice: 0, winning: false });
    expect(rows[1].leadPrice).toBeNull();
  });

  it('returns nothing for a reply with no results', () => {
    expect(parseOnbuyWinning(null)).toEqual([]);
  });
});

const base = { sku: 'LE-83306', price: 41.99, itemPrice: 41.99, deliveryPrice: 0, leadPrice: 40.41, leadItemPrice: 40.41, leadDeliveryPrice: 0, winning: false };

describe('the price to beat', () => {
  it('is a penny under the winning total — OnBuy’s own £40.41 → £40.40', () => {
    expect(priceToBeat(base)).toEqual({ beat: 40.4, match: 40.41, reason: null });
  });

  it('takes our own delivery charge off, since OnBuy compares totals', () => {
    expect(priceToBeat({ ...base, deliveryPrice: 3.99 })).toEqual({ beat: 36.41, match: 36.42, reason: null });
  });

  it('suggests nothing when we are already winning', () => {
    expect(priceToBeat({ ...base, winning: true })).toMatchObject({ beat: null, match: null, reason: 'Our offer is the winning one.' });
  });

  it('suggests nothing when OnBuy gave no winning price', () => {
    expect(priceToBeat({ ...base, leadPrice: null }).beat).toBeNull();
  });

  it('suggests nothing sensible when our delivery alone exceeds the winner', () => {
    expect(priceToBeat({ ...base, leadPrice: 2, deliveryPrice: 3.99 })).toMatchObject({ beat: null, match: null });
  });
});

import { describe, expect, it } from 'vitest';
import { holdsStock, isDead, readJiniusOrders, unitsToHold } from './jinius-orders';
import { buildLocalSaleDraft, jiniusSaleRef, jiniusTransactionLines, type JiniusSaleLineIn } from './jinius-local-sale';

/** OR11's documented shape, as Mirakl returns it. */
const PAGE = {
  total_count: 1,
  orders: [{
    order_id: 'JIN-0001-A',
    commercial_id: 'JIN-0001',
    created_date: '2026-09-18T09:15:00Z',
    order_state: 'SHIPPED',
    currency_iso_code: 'EUR',
    order_tax_mode: 'TAX_INCLUDED',
    price: 120,
    shipping_price: 4,
    total_commission: 18,
    total_price: 124,
    order_lines: [
      {
        order_line_id: 'JIN-0001-A-1', offer_sku: 'LAG-612676', product_title: 'Card wallet', quantity: 2,
        price: 80, price_unit: 40, shipping_price: 0, total_commission: 12, order_line_state: 'SHIPPED',
        taxes: [{ amount: 12.77, code: 'VAT' }],
      },
      {
        order_line_id: 'JIN-0001-A-2', offer_sku: 'LE-83306', product_title: 'Airer', quantity: 1,
        price: 40, price_unit: 40, commission_fee: 5, commission_taxes: [{ amount: 0.95 }], order_line_state: 'SHIPPED',
      },
      // No offer_sku: matches no product here, so it is not kept.
      { order_line_id: 'JIN-0001-A-3', product_sku: 'MP-77', quantity: 1, price: 10 },
    ],
  }],
};

describe('reading Jinius orders', () => {
  it('keeps the order, its money and its lines, dropping a line with no SKU of ours', () => {
    const [order] = readJiniusOrders(PAGE);
    expect(order).toMatchObject({
      orderId: 'JIN-0001-A', commercialId: 'JIN-0001', state: 'SHIPPED', currency: 'EUR',
      taxMode: 'TAX_INCLUDED', priceTotal: 120, shippingPrice: 4, totalCommission: 18, totalPrice: 124,
    });
    expect(order.orderedAt?.toISOString()).toBe('2026-09-18T09:15:00.000Z');
    expect(order.lines).toHaveLength(2);
    expect(order.lines[0]).toMatchObject({ offerSku: 'LAG-612676', quantity: 2, price: 80, totalCommission: 12, taxAmount: 12.77 });
  });

  /** Where Mirakl gives only the fee and its taxes, they add up to what Jinius keeps. */
  it('adds the commission taxes to the fee when no total is given', () => {
    expect(readJiniusOrders(PAGE)[0].lines[1].totalCommission).toBeCloseTo(5.95, 2);
  });

  it('is safe on an answer that carries nothing', () => {
    expect(readJiniusOrders(null)).toEqual([]);
    expect(readJiniusOrders({ orders: [{ order_id: 'x' }] })).toEqual([]); // no date: not an order we can file
  });
});

describe('which orders hold stock', () => {
  it('holds units once the order is ours to send', () => {
    expect(holdsStock('SHIPPED')).toBe(true);
    expect(holdsStock('SHIPPING')).toBe(true);
    expect(holdsStock('RECEIVED')).toBe(true);
  });

  /** A promise is not a sale: deducting these would eat availability every other channel is told. */
  it('holds nothing for an order still waiting, refused or cancelled', () => {
    expect(holdsStock('WAITING_ACCEPTANCE')).toBe(false);
    expect(isDead('CANCELED')).toBe(true);
    expect(unitsToHold({ quantity: 3, state: 'SHIPPED' }, 'SHIPPED')).toBe(3);
    expect(unitsToHold({ quantity: 3, state: 'SHIPPED' }, 'WAITING_ACCEPTANCE')).toBe(0);
    expect(unitsToHold({ quantity: 3, state: 'CANCELED' }, 'SHIPPED')).toBe(0);
  });
});

describe('the local invoice for a batch', () => {
  const when = new Map([['JIN-1', new Date('2026-09-17T10:00:00Z')], ['JIN-2', new Date('2026-09-18T10:00:00Z')]]);
  const line = (over: Partial<JiniusSaleLineIn> = {}): JiniusSaleLineIn => ({
    orderId: 'JIN-1', orderLineId: 'L1', sku: 'LAG-612676', title: 'Card wallet', productId: 'p1',
    quantity: 1, price: 119, totalCommission: 19, vatPct: 19, ...over,
  });

  it('invoices the money that actually arrives, VAT split out of it', () => {
    const d = buildLocalSaleDraft([line()], when);
    // 119.00 − 19.00 = 100.00 gross, which at 19% is 84.03 + 15.97.
    expect(d.lines[0]).toMatchObject({ grossAmount: 100, netSalesAmount: 84.03, vatAmount: 15.97, vatPct: 19 });
    expect(d.commissionTotal).toBe(19);
  });

  it('keeps one line per order line, and dates the invoice from the newest order', () => {
    const d = buildLocalSaleDraft([line(), line({ orderId: 'JIN-2', orderLineId: 'L2', price: 60, totalCommission: 10 })], when);
    expect(d.lines.map((l) => l.orderId)).toEqual(['JIN-1', 'JIN-2']);
    expect(d.date?.toISOString()).toBe('2026-09-18T10:00:00.000Z');
    expect(d.grossTotal).toBe(150);
  });

  it('uses each product’s own VAT rate, not one rate for the batch', () => {
    const d = buildLocalSaleDraft([line({ vatPct: 5, price: 105, totalCommission: 0 })], when);
    expect(d.lines[0]).toMatchObject({ grossAmount: 105, netSalesAmount: 100, vatAmount: 5 });
  });

  it('refuses a line it cannot invoice honestly, and says why', () => {
    const d = buildLocalSaleDraft([
      line({ productId: null }),
      line({ orderLineId: 'L2', vatPct: null }),
      line({ orderLineId: 'L3', price: 10, totalCommission: 12 }),
    ], when);
    expect(d.lines).toHaveLength(0);
    expect(d.problems[0]).toContain('matches no product');
    expect(d.problems[1]).toContain('no VAT class');
    expect(d.problems[2]).toContain('after Jinius');
  });

  it('suggests a reference a person can replace with their invoice number', () => {
    expect(jiniusSaleRef(new Date('2026-09-18T10:00:00Z'), 3)).toBe('JINIUS-2026-09-18-3ord');
  });
});

describe('a Jinius order as a sales transaction', () => {
  const line = { sku: 'LAG-612676', productId: 'p1', quantity: 2, price: 119, shippingPrice: 0, totalCommission: 17.85, taxAmount: 0 };

  /** The sale is reported whole: the fee is the channel fee, not something netted off the price. */
  it('reports the price the buyer paid, with the commission as the selling fee', () => {
    const [l] = jiniusTransactionLines([line], 19);
    expect(l).toEqual({
      sku: 'LAG-612676', productId: 'p1', quantity: 2,
      netSalesAmount: 100, vatAmount: 19, shippingAmount: 0, salesChannelSalesFeeAmount: 17.85,
    });
  });

  it('uses the tax Jinius itself reported when it gave one', () => {
    const [l] = jiniusTransactionLines([{ ...line, taxAmount: 12.77 }], 19);
    expect(l.vatAmount).toBe(12.77);
    expect(l.netSalesAmount).toBe(106.23);
  });

  it('carries the shipping the buyer paid', () => {
    expect(jiniusTransactionLines([{ ...line, shippingPrice: 3.5 }], 19)[0].shippingAmount).toBe(3.5);
  });
});

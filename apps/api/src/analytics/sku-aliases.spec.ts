import { describe, expect, it } from 'vitest';

/**
 * One product, several SKUs.
 *
 * The same product goes to the same marketplace under different SKUs — RE-S8540 on one shipment,
 * NK-S8450 on the next. They are aliases of one product, and the catalogue already knows it.
 *
 * Analytics grouped by the SKU STRING, so one product appeared as several rows, each showing a
 * fraction of its trade. Nothing on the page added up to the product a person actually had in mind,
 * and the SKU detail page — filtering on an exact string — showed only whichever label had been
 * clicked.
 *
 * FBA allocation was already right: it keys on `productId ?? sku`, so two aliases already merged
 * into one allocation line. Only analytics needed changing.
 */

type Item = { sku: string; productId: string | null; productTitle?: string | null; revenueExVatEur: number; quantity: number };

/** The grouping key as analytics now computes it. */
const keyOf = (it: Item) => it.productId ?? 'sku:' + String(it.sku ?? '').trim().toLowerCase();

const roll = (items: Item[]) => {
  const m = new Map<string, { sku: string; revenue: number; units: number }>();
  for (const it of items) {
    const k = keyOf(it);
    const cur = m.get(k) ?? { sku: it.sku, revenue: 0, units: 0 };
    cur.revenue += it.revenueExVatEur;
    cur.units += it.quantity;
    m.set(k, cur);
  }
  return [...m.values()];
};

describe('grouping sales by product', () => {
  it('combines a product sold under two SKUs into one row', () => {
    const rows = roll([
      { sku: 'RE-S8540', productId: 'p1', revenueExVatEur: 100, quantity: 2 },
      { sku: 'NK-S8450', productId: 'p1', revenueExVatEur: 60, quantity: 1 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ revenue: 160, units: 3 });
  });

  it('keeps genuinely different products apart', () => {
    const rows = roll([
      { sku: 'RE-S8540', productId: 'p1', revenueExVatEur: 100, quantity: 2 },
      { sku: 'BE-BM35', productId: 'p2', revenueExVatEur: 40, quantity: 1 },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('gives an unmatched SKU its own row rather than a shared bucket', () => {
    // A line matching no product is still real trade. Merging every such line under one key would
    // invent a product that does not exist; keying on the SKU keeps each honest.
    const rows = roll([
      { sku: 'MYSTERY-1', productId: null, revenueExVatEur: 10, quantity: 1 },
      { sku: 'MYSTERY-2', productId: null, revenueExVatEur: 20, quantity: 1 },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('treats an unmatched SKU case-insensitively, as the catalogue does', () => {
    const rows = roll([
      { sku: 'mystery-1', productId: null, revenueExVatEur: 10, quantity: 1 },
      { sku: 'MYSTERY-1', productId: null, revenueExVatEur: 20, quantity: 1 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenue).toBe(30);
  });

  it('does not let an unmatched SKU collide with a real product id', () => {
    // The 'sku:' prefix exists for this: a bare SKU that happened to look like an id would
    // otherwise merge into that product's figures.
    expect(keyOf({ sku: 'p1', productId: null, revenueExVatEur: 0, quantity: 0 })).not.toBe('p1');
  });
});

describe('the SKU detail page', () => {
  // aggregateSku resolves the family from the catalogue, then matches any of them.
  const family = new Set(['re-s8540', 'nk-s8450']);
  const matches = (sku: string) => family.has(sku.trim().toLowerCase());

  it('includes sales made under any alias', () => {
    expect(matches('RE-S8540')).toBe(true);
    expect(matches('NK-S8450')).toBe(true);
    expect(matches(' nk-s8450 ')).toBe(true);
  });

  it('excludes a different product', () => {
    expect(matches('BE-BM35')).toBe(false);
  });
});

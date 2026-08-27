import { describe, expect, it } from 'vitest';

/**
 * One product, several SKUs, one pool of inbound cost.
 *
 * A product ships to Amazon AU under RE-NE3150-FBA and sells there under NK-NE3150-FBA. They are
 * aliases of one product and the catalogue already knows it.
 *
 * The SALE side was already right: buildFbaAverageMap indexes FBA lines by product AND by SKU, and
 * fbaUnitCost tries the product first — so a sale under one alias already drew on cost recorded
 * under another. That is also why unlinked shipment lines mattered so much: with no product key,
 * only an exact string match could ever find them.
 *
 * The Allocated Cost LIST disagreed with that. It grouped on the SKU string, so one product became
 * two rows with two averages, and it looked as though cost recorded under one label did not apply
 * to the other. The list was wrong about what the profit calculation was already doing.
 */

type Item = { sku: string; productId: string | null; channelId: string; qty: number; cost: number };

/** The list's grouping key, as the service now computes it. */
const keyOf = (it: Item) =>
  it.productId ? `p:${it.productId}::${it.channelId}` : `s:${it.sku.trim().toLowerCase()}::${it.channelId}`;

/** The sale-side lookup: product first, then the SKU string. */
const unitCost = (map: Map<string, number>, sku: string, productId: string | null, channelId: string) =>
  (productId ? map.get(`p:${productId}:${channelId}`) : undefined)
  ?? map.get(`s:${sku.trim().toLowerCase()}:${channelId}`)
  ?? 0;

describe('the allocated cost list', () => {
  const AU = 'ch-au';

  it('combines aliases of one product on one channel', () => {
    const items: Item[] = [
      { sku: 'RE-NE3150-FBA', productId: 'p1', channelId: AU, qty: 4, cost: 8 },
      { sku: 'NK-NE3150-FBA', productId: 'p1', channelId: AU, qty: 6, cost: 12 },
    ];
    const keys = new Set(items.map(keyOf));
    expect(keys.size).toBe(1);

    // And the average is over the whole pool, not one label's share of it.
    const totalQty = items.reduce((s, i) => s + i.qty, 0);
    const totalCost = items.reduce((s, i) => s + i.cost, 0);
    expect(totalCost / totalQty).toBe(2);
  });

  it('keeps the same product apart on different channels', () => {
    // Inbound cost to Australia says nothing about inbound cost to Germany.
    const a = keyOf({ sku: 'RE-NE3150-FBA', productId: 'p1', channelId: AU, qty: 1, cost: 1 });
    const b = keyOf({ sku: 'RE-NE3150-FBA', productId: 'p1', channelId: 'ch-de', qty: 1, cost: 1 });
    expect(a).not.toBe(b);
  });

  it('keeps different products apart', () => {
    const a = keyOf({ sku: 'RE-NE3150-FBA', productId: 'p1', channelId: AU, qty: 1, cost: 1 });
    const b = keyOf({ sku: 'BE-BM35-FBA', productId: 'p2', channelId: AU, qty: 1, cost: 1 });
    expect(a).not.toBe(b);
  });

  it('gives an unlinked line its own row rather than a shared bucket', () => {
    const a = keyOf({ sku: 'MYSTERY-1', productId: null, channelId: AU, qty: 1, cost: 1 });
    const b = keyOf({ sku: 'MYSTERY-2', productId: null, channelId: AU, qty: 1, cost: 1 });
    expect(a).not.toBe(b);
  });

  it('cannot confuse an unlinked SKU with a product id', () => {
    // The p:/s: prefixes exist for this: a SKU that happens to read like an id must not merge into
    // that product's costs.
    expect(keyOf({ sku: 'p1', productId: null, channelId: AU, qty: 1, cost: 1 }))
      .not.toBe(keyOf({ sku: 'anything', productId: 'p1', channelId: AU, qty: 1, cost: 1 }));
  });
});

describe('what a sale picks up', () => {
  const AU = 'ch-au';
  // Cost recorded on the shipment under RE-NE3150-FBA, indexed both ways.
  const map = new Map<string, number>([
    ['p:p1:ch-au', 2],
    ['s:re-ne3150-fba:ch-au', 2],
  ]);

  it('finds cost recorded under a different alias, via the product', () => {
    expect(unitCost(map, 'NK-NE3150-FBA', 'p1', AU)).toBe(2);
  });

  it('still finds it by SKU when the sale line has no product', () => {
    // The fallback that keeps an unlinked shipment line's cost visible at all.
    expect(unitCost(map, 'RE-NE3150-FBA', null, AU)).toBe(2);
  });

  it('finds nothing under an alias when neither side resolved to a product', () => {
    // The gap the recalculate exists to close: no product on either side means only an exact string
    // match can work, and two different aliases never match each other.
    expect(unitCost(map, 'NK-NE3150-FBA', null, AU)).toBe(0);
  });

  it('does not borrow another channel’s cost', () => {
    expect(unitCost(map, 'NK-NE3150-FBA', 'p1', 'ch-de')).toBe(0);
  });
});

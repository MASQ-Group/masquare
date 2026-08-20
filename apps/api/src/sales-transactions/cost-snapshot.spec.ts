import { describe, it, expect } from 'vitest';

// Point-in-time costing: a sale is valued with the product data in place when it happened, so a
// later purchase-cost change applies forward only and never restates profit already reported.
type Item = { unitNetCostEur?: number | null; unitCostSnapshotEur?: number | null; product?: { averageCostEur?: number | null; purchaseCostAmount?: number | null } };

const costSourceOf = (it: Item) =>
  it.unitNetCostEur != null ? 'override'
  : it.unitCostSnapshotEur != null ? 'snapshot'
  : Number(it.product?.averageCostEur ?? 0) > 0 ? 'average'
  : it.product?.purchaseCostAmount != null ? 'catalogue' : 'none';

const unitCostOf = (it: Item) => {
  switch (costSourceOf(it)) {
    case 'override': return Number(it.unitNetCostEur);
    case 'snapshot': return Number(it.unitCostSnapshotEur);
    case 'average': return Number(it.product!.averageCostEur);
    case 'catalogue': return Number(it.product!.purchaseCostAmount);
    default: return 0;
  }
};

describe('point-in-time COGS', () => {
  it('a recorded sale keeps its cost when the product is re-costed', () => {
    const sale: Item = { unitCostSnapshotEur: 13.11, product: { purchaseCostAmount: 13.11 } };
    expect(unitCostOf(sale)).toBe(13.11);
    sale.product!.purchaseCostAmount = 19.9; // vendor price list raises it later
    expect(unitCostOf(sale)).toBe(13.11);
    expect(costSourceOf(sale)).toBe('snapshot');
  });

  it('without a snapshot the same change WOULD restate the sale', () => {
    const sale: Item = { product: { purchaseCostAmount: 13.11 } };
    expect(unitCostOf(sale)).toBe(13.11);
    sale.product!.purchaseCostAmount = 19.9;
    expect(unitCostOf(sale)).toBe(19.9); // the behaviour the snapshot exists to prevent
  });

  it('an explicit override still outranks the frozen cost', () => {
    expect(unitCostOf({ unitNetCostEur: 9, unitCostSnapshotEur: 13.11 })).toBe(9);
  });

  it('a line recorded before any cost was known keeps resolving live', () => {
    const sale: Item = { unitCostSnapshotEur: null, product: { purchaseCostAmount: null } };
    expect(costSourceOf(sale)).toBe('none');
    sale.product!.purchaseCostAmount = 13.11; // cost established afterwards
    expect(unitCostOf(sale)).toBe(13.11);
  });

  it('the moving average outranks the catalogue cost, and zero is not an average', () => {
    expect(unitCostOf({ product: { averageCostEur: 12, purchaseCostAmount: 13.11 } })).toBe(12);
    expect(unitCostOf({ product: { averageCostEur: 0, purchaseCostAmount: 13.11 } })).toBe(13.11);
  });
});

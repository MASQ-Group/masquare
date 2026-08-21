import { describe, it, expect } from 'vitest';
import { VendorImportService } from './vendor-import.service';
import { extractTable } from './sheet-extract';

// A saved mapping is re-resolved by HEADER NAME, not by position. Vendors add and reorder columns
// between editions, and a position saved last month can quietly point at a different column this
// month — which would write the retail price into the cost field with nothing to show for it.
const svc = new VendorImportService({} as any);

const columnsOf = (grid: unknown[][], origin = 0) => extractTable(grid, origin).columns;

const LAST_MONTH = {
  sku: { header: 'ITEM', letter: 'B', ordinal: 1 },
  purchaseCost: { header: 'DL.PRICE(EXC)', letter: 'H', ordinal: 7 },
  map: { header: 'SRP (INC)', letter: 'I', ordinal: 8 },
};

describe('re-resolving a saved mapping', () => {
  it('follows the header when the vendor inserts a column', () => {
    // A new "BRAND" column has pushed the prices one to the right.
    const cols = columnsOf([
      ['ITEM', 'BARCODE', 'DESCRIPTION', 'STATUS', 'MODEL', 'BRAND', 'STOCK', 'DL.PRICE(EXC)', 'SRP (INC)'],
      ['IT67017', '5290000202404', 'cooler', 'Active', 'DF-AF1300C', 'Crystal', '29', '95', '165'],
    ], 1);
    const r = svc.resolveSaved(LAST_MONTH, cols);
    const cost = r.find((x) => x.field === 'purchaseCost')!;
    expect(cols[cost.columnIndex!].header).toBe('DL.PRICE(EXC)');
    expect(cols[cost.columnIndex!].letter).toBe('I'); // moved right by one
    expect(cost.matchedBy).toBe('header');
    expect(cost.movedFrom).toBe('H'); // and says so, rather than moving silently
  });

  it('falls back to the saved position only when no header matches', () => {
    const cols = columnsOf([
      ['ITEM', '', ''],
      ['IT67017', '95', '165'],
    ], 1);
    const r = svc.resolveSaved({ purchaseCost: { header: 'DL.PRICE(EXC)', letter: 'C', ordinal: 2 } }, cols);
    const cost = r.find((x) => x.field === 'purchaseCost')!;
    expect(cols[cost.columnIndex!].letter).toBe('C');
    expect(cost.matchedBy).toBe('position');
  });

  it('reports a field as unmapped when its column is gone entirely', () => {
    const cols = columnsOf([['ITEM', 'STOCK'], ['IT67017', '29']], 1);
    const r = svc.resolveSaved(LAST_MONTH, cols);
    expect(r.find((x) => x.field === 'purchaseCost')!.columnIndex).toBeNull();
    expect(r.find((x) => x.field === 'sku')!.columnIndex).not.toBeNull();
  });

  it('never resolves two fields onto the same column', () => {
    const cols = columnsOf([['PRICE', 'PRICE'], ['10', '20']]);
    const r = svc.resolveSaved(
      { purchaseCost: { header: 'PRICE', letter: 'A', ordinal: 1 }, map: { header: 'PRICE', letter: 'B', ordinal: 2 } },
      cols,
    );
    const used = r.filter((x) => x.columnIndex != null).map((x) => x.columnIndex);
    expect(new Set(used).size).toBe(used.length);
  });
});

import { describe, it, expect } from 'vitest';
import { extractTable, findHeaderRow, columnLetter } from './sheet-extract';
import { suggestMapping, capabilitiesOf } from './field-suggest';
import { kindOf, columnKind, toNumber } from './value-kind';

// Fixtures reproduce the structures of the real vendor price lists rather than shipping the
// files themselves: a sheet whose used range starts at B, a junk first column with blank columns
// interleaved, category separator rows among the data, and a title row above the header.

const JUNK = '`'; // the literal first-column header in one of the sample files

describe('value kinds', () => {
  it('recognises barcodes by length, not by header', () => {
    expect(kindOf('5290000202404')).toBe('ean'); // 13
    expect(kindOf('8004399481114')).toBe('ean');
    expect(kindOf('12345')).toBe('integer'); // not a barcode length
  });

  it('reads numbers stored as text, in either decimal convention', () => {
    expect(toNumber('29.9')).toBe(29.9);
    expect(toNumber('1.234,56')).toBe(1234.56);
    expect(toNumber('1,234.56')).toBe(1234.56);
    expect(toNumber('53,10')).toBe(53.1);
    expect(toNumber('n/a')).toBeNull();
  });

  it('classifies a column by its majority, tolerating stray values', () => {
    expect(columnKind(['IT67017', 'IT67018', '', 'IT70001'])).toBe('sku');
    expect(columnKind(['95', '85', '105'])).toBe('integer');
    expect(columnKind(['29.9', '16', '42.50'])).toBe('money');
  });
});

describe('header discovery', () => {
  it('skips a title row above the header', () => {
    const grid = [
      ['AIR TREATMENT PRICELIST 2026', null, null],
      ['ITEM', 'BARCODE', 'DP (EXL)'],
      ['IT48352', '8004399481114', '255'],
      ['IT48353', '8004399481115', '199'],
    ];
    expect(findHeaderRow(grid)).toBe(1);
  });

  it('takes row 0 when it is already the header', () => {
    const grid = [['Model', 'Barcode', 'Stock'], ['BE-BC27', '4211125659042', '37']];
    expect(findHeaderRow(grid)).toBe(0);
  });
});

describe('column letters follow the sheet origin', () => {
  it('offsets by the first used column so letters match what Excel shows', () => {
    // Reproduces UPDATED STOCK, whose used range is B1:I346. Re-basing to zero would report
    // ITEM as column A and shift every mapping by one.
    const grid = [
      ['ITEM', 'BARCODE', 'STOCK', 'DL.PRICE(EXC)'],
      ['IT67017', '5290000202404', '29', '95'],
      ['IT67018', '5292024000004', '55', '85'],
    ];
    const t = extractTable(grid, 1); // origin column B
    expect(t.columns.map((c) => c.letter)).toEqual(['B', 'C', 'D', 'E']);
    expect(t.columns.map((c) => c.ordinal)).toEqual([1, 2, 3, 4]);
  });

  it('encodes past Z', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(23)).toBe('X');
    expect(columnLetter(26)).toBe('AA');
  });
});

describe('discarding what is not a product', () => {
  const grid = [
    ['ITEM', 'BARCODE', 'STOCK', 'DL.PRICE(EXC)'],
    ['IT67017', '5290000202404', '29', '95'],
    ['COFFEE GRINDERS (120211101)', null, null, null], // category separator
    ['IT26234', '8004399324541', '4', '47'],
    [null, null, null, null],
    ['IT49699', '9312432022958', '8', '150'],
  ];

  it('keeps products and drops separators and blanks', () => {
    const t = extractTable(grid);
    expect(t.rows.length).toBe(3);
    expect(t.discarded.sectionHeaders).toBe(1);
    expect(t.discarded.blank).toBe(1);
    expect(t.sectionLabels).toEqual(['COFFEE GRINDERS (120211101)']);
  });

  it('does not let a separator pollute a column sample', () => {
    const t = extractTable(grid);
    expect(t.columns[0].samples).toEqual(['IT67017', 'IT26234', 'IT49699']);
  });
});

describe('junk and blank columns', () => {
  // Reproduces 26.4.25.xlsx: a junk first column and empty columns between real ones.
  const grid = [
    [JUNK, 'ST', 'No.', 'RET', null, null, 'WLS'],
    [null, 'Active', '07-7ACEL1710', '79', null, null, '53.1'],
    [null, 'Active', '07-7ACEL1744', '30', null, null, '20.17'],
  ];

  it('drops columns with neither header nor data, but keeps true letters', () => {
    const t = extractTable(grid);
    expect(t.columns.map((c) => c.header)).toEqual([JUNK, 'ST', 'No.', 'RET', 'WLS']);
    expect(t.columns.map((c) => c.letter)).toEqual(['A', 'B', 'C', 'D', 'G']);
  });
});

describe('mapping suggestions', () => {
  const columnsOf = (grid: unknown[][], origin = 0) => extractTable(grid, origin).columns;
  const pick = (s: ReturnType<typeof suggestMapping>, f: string) => s.find((x) => x.field === f)!;

  it('separates dealer price from suggested retail', () => {
    const cols = columnsOf([
      ['ITEM', 'BARCODE', 'MODEL', 'STOCK', 'DL.PRICE(EXC)', 'SRP (INC)'],
      ['IT67017', '5290000202404', 'DF-AF1300C', '29', '95', '165'],
      ['IT67018', '5292024000004', 'DF-AF1312CC1', '55', '85', '149'],
    ], 1);
    const s = suggestMapping(cols);
    expect(cols[pick(s, 'purchaseCost').columnIndex!].header).toBe('DL.PRICE(EXC)');
    expect(cols[pick(s, 'map').columnIndex!].header).toBe('SRP (INC)');
    expect(cols[pick(s, 'sku').columnIndex!].header).toBe('ITEM');
    expect(cols[pick(s, 'manufacturerSku').columnIndex!].header).toBe('MODEL');
    expect(capabilitiesOf(s)).toEqual({ cost: true, map: true, availability: true });
  });

  it('treats Model as the SKU when the file has no other identifier', () => {
    const cols = columnsOf([
      ['Model', 'Description', 'Barcode', 'Stock'],
      ['BE-BC27', 'beurer wrist monitor', '4211125659042', '37'],
      ['BE-BF180', 'beurer scale', '4211125749095', '229'],
    ]);
    const s = suggestMapping(cols);
    expect(cols[pick(s, 'sku').columnIndex!].header).toBe('Model');
    // and does NOT then claim the prose column as the manufacturer part number
    expect(pick(s, 'manufacturerSku').columnIndex).toBeNull();
  });

  it('leaves a field unmapped rather than guessing wrongly', () => {
    // A price list with no stock column must not have a stray integer offered as availability.
    const cols = columnsOf([
      [JUNK, 'ST', 'No.', 'RET', 'WLS', 'WLSPR'],
      [null, 'Active', '07-7ACEL1710', '79', '53.1', null],
      [null, 'Active', '07-7ACEL1744', '30', '20.17', null],
    ]);
    const s = suggestMapping(cols);
    expect(pick(s, 'availability').columnIndex).toBeNull();
    expect(capabilitiesOf(s).availability).toBe(false);
    expect(cols[pick(s, 'purchaseCost').columnIndex!].header).toBe('WLS');
    expect(cols[pick(s, 'map').columnIndex!].header).toBe('RET');
  });

  it('never assigns one column to two fields', () => {
    const cols = columnsOf([
      ['ITEM', 'PRICE', 'STOCK'],
      ['IT1', '10.5', '4'],
      ['IT2', '12.0', '9'],
    ]);
    const s = suggestMapping(cols);
    const used = s.filter((x) => x.columnIndex != null).map((x) => x.columnIndex);
    expect(new Set(used).size).toBe(used.length);
  });
});

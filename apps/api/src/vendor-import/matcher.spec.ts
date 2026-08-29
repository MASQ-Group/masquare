import { describe, it, expect } from 'vitest';
import { buildIndex, matchRow, matchRows, normBarcode } from './matcher';

const PRODUCTS = [
  { id: 'p-scissors', mainSku: 'LAG-8.1681.09', ean: '7611160016812', manufacturerSku: '8.1681.09' },
  { id: 'p-cooler', mainSku: 'IT67017', ean: '5290000202404', manufacturerSku: 'DF-AF1300C' },
  { id: 'p-cooler-2', mainSku: 'IT67018', ean: '5292024000004', manufacturerSku: 'DF-AF1300C' }, // same model no.
  { id: 'p-upc', mainSku: 'US-ONLY', upc: '012345678905' },
  { id: 'p-vendorcode', mainSku: 'BE-BF180', vendorSku: 'BEU-180' },
];

const idx = buildIndex(PRODUCTS, [{ vendorSku: 'ALPAN-77', productId: 'p-scissors' }]);

describe('barcode normalisation', () => {
  it('treats a 12-digit UPC as the 13-digit EAN with a leading zero', () => {
    expect(normBarcode('012345678905')).toBe('012345678905'.padStart(13, '0'));
    expect(normBarcode('12345678905')).not.toBe(normBarcode('012345678905')); // 11 digits is neither
    expect(normBarcode(' 5290000202404 ')).toBe('5290000202404');
    expect(normBarcode('5290-0002-02404')).toBe('5290000202404');
    expect(normBarcode(null)).toBe('');
  });

  it('matches a UPC quoted either way', () => {
    expect(matchRow({ sku: 'nope', ean: '012345678905' }, idx).productId).toBe('p-upc');
    expect(matchRow({ sku: 'nope', ean: '12345678905' }, idx).productId).toBeNull(); // not a valid length
  });
});

describe('match order', () => {
  it('an alias outranks everything', () => {
    // ALPAN-77 is not our SKU, but a human said it means the scissors.
    const m = matchRow({ sku: 'ALPAN-77', ean: '5290000202404' }, idx);
    expect(m.productId).toBe('p-scissors');
    expect(m.matchedBy).toBe('alias');
  });

  it('main SKU wins over barcode', () => {
    const m = matchRow({ sku: 'IT67017', ean: '7611160016812' }, idx);
    expect(m.productId).toBe('p-cooler');
    expect(m.matchedBy).toBe('mainSku');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(matchRow({ sku: '  it67017 ' }, idx).matchedBy).toBe('mainSku');
  });

  it('falls back to barcode, then our record of the vendor code', () => {
    expect(matchRow({ sku: 'unknown', ean: '5292024000004' }, idx).productId).toBe('p-cooler-2');
    const v = matchRow({ sku: 'BEU-180' }, idx);
    expect(v.productId).toBe('p-vendorcode');
    expect(v.matchedBy).toBe('vendorSku');
  });

  it('uses the manufacturer part number only as a last resort', () => {
    const m = matchRow({ sku: 'unknown', manufacturerSku: '8.1681.09' }, idx);
    expect(m.matchedBy).toBe('manufacturerSku');
    expect(m.productId).toBe('p-scissors');
  });
});

describe('refusing to guess', () => {
  it('reports an ambiguous hit instead of picking one', () => {
    // Two products share the model number DF-AF1300C.
    const m = matchRow({ sku: 'unknown', manufacturerSku: 'DF-AF1300C' }, idx);
    expect(m.productId).toBeNull();
    expect(m.ambiguous?.by).toBe('manufacturerSku');
    expect(m.ambiguous?.productIds.sort()).toEqual(['p-cooler', 'p-cooler-2']);
  });

  it('does not break an ambiguity with a weaker identifier', () => {
    // The barcode is ambiguous; a manufacturer number that WOULD resolve must not be consulted.
    const two = buildIndex(
      [
        { id: 'a', mainSku: 'A', ean: '1111111111116', manufacturerSku: 'M-A' },
        { id: 'b', mainSku: 'B', ean: '1111111111116', manufacturerSku: 'M-B' },
      ],
      [],
    );
    const m = matchRow({ sku: 'x', ean: '1111111111116', manufacturerSku: 'M-A' }, two);
    expect(m.productId).toBeNull();
    expect(m.ambiguous?.by).toBe('ean');
  });

  it('distinguishes a row with no identifiers from one that simply is not ours', () => {
    expect(matchRow({}, idx).reason).toBe('no-identifiers');
    expect(matchRow({ sku: 'NOT-OURS' }, idx).reason).toBe('not-found');
  });
});

describe('summarising a file', () => {
  it('counts by method and flags the vendor duplicating a SKU', () => {
    const { summary } = matchRows(
      [
        { sku: 'IT67017' },
        { sku: 'IT67017' }, // the vendor listed it twice
        { sku: 'ALPAN-77' },
        { sku: 'NOT-OURS' },
        { sku: 'x', manufacturerSku: 'DF-AF1300C' },
      ],
      idx,
    );
    expect(summary.total).toBe(5);
    expect(summary.matched).toBe(3);
    expect(summary.unmatched).toBe(1);
    expect(summary.ambiguous).toBe(1);
    expect(summary.byMethod.mainSku).toBe(2);
    expect(summary.byMethod.alias).toBe(1);
    expect(summary.duplicateSkus).toEqual(['it67017']);
  });
});

/**
 * A row whose SKU and barcode point at different products.
 *
 * The match still stands, because the SKU is the more deliberate identifier. But one of the two
 * facts is wrong and both readings hurt: either the vendor put the wrong barcode on the line, or we
 * hold that barcode against the wrong product — and in the second case a later file matching by
 * barcode alone writes a cost onto the wrong article, invisible until a margin looks strange.
 */
describe('a SKU and a barcode that disagree', () => {
  const idx = buildIndex(
    [
      { id: 'p1', mainSku: 'AAA-1', ean: '5011234567890' },
      { id: 'p2', mainSku: 'BBB-2', ean: '5019876543210' },
    ],
    [],
  );

  it('matches on the SKU and flags the barcode', () => {
    // The file says AAA-1, but quotes the barcode we hold against BBB-2.
    const m = matchRow({ sku: 'AAA-1', ean: '5019876543210' }, idx);
    expect(m.productId).toBe('p1');
    expect(m.matchedBy).toBe('mainSku');
    expect(m.barcodeConflict).toEqual({ barcode: '5019876543210', productIds: ['p2'] });
  });

  it('says nothing when the two agree', () => {
    expect(matchRow({ sku: 'AAA-1', ean: '5011234567890' }, idx).barcodeConflict).toBeUndefined();
  });

  it('says nothing when the barcode is unknown to us', () => {
    // A barcode we have never seen is not a conflict — it is simply new information.
    expect(matchRow({ sku: 'AAA-1', ean: '5559999999999' }, idx).barcodeConflict).toBeUndefined();
  });

  it('says nothing when the row carries no barcode', () => {
    expect(matchRow({ sku: 'AAA-1' }, idx).barcodeConflict).toBeUndefined();
  });

  it('compares a 12-digit UPC against the 13-digit EAN of the same article', () => {
    // Zero-padded, so the two forms meet rather than reading as a conflict.
    expect(matchRow({ sku: 'AAA-1', ean: '011234567890' }, idx).barcodeConflict).toBeUndefined();
  });

  it('flags an alias match too', () => {
    // An alias is a human decision about the SKU. It still cannot vouch for the barcode.
    const withAlias = buildIndex(
      [{ id: 'p1', mainSku: 'AAA-1', ean: '5011234567890' }, { id: 'p2', mainSku: 'BBB-2', ean: '5019876543210' }],
      [{ vendorSku: 'V-99', productId: 'p1' }],
    );
    const m = matchRow({ sku: 'V-99', ean: '5019876543210' }, withAlias);
    expect(m.productId).toBe('p1');
    expect(m.barcodeConflict?.productIds).toEqual(['p2']);
  });

  it('does not flag a row that matched BY barcode', () => {
    // Nothing disagrees: the barcode chose the product, so it cannot contradict itself. The row's
    // SKU being the vendor's own code rather than ours is the ordinary case.
    const m = matchRow({ sku: 'VENDOR-CODE-X', ean: '5011234567890' }, idx);
    expect(m.matchedBy).toBe('ean');
    expect(m.barcodeConflict).toBeUndefined();
  });

  it('counts the conflicts in the summary', () => {
    const { summary } = matchRows(
      [
        { sku: 'AAA-1', ean: '5019876543210' }, // conflict
        { sku: 'BBB-2', ean: '5019876543210' }, // agrees
        { sku: 'AAA-1', ean: '5011234567890' }, // agrees
      ],
      idx,
    );
    expect(summary.barcodeConflicts).toBe(1);
    expect(summary.matched).toBe(3);
  });
});

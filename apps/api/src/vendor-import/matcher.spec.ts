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

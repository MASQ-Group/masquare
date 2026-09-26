import { describe, expect, it } from 'vitest';
import {
  jiniusProductCsv, missingForJiniusProduct, readJiniusProductImportId, readJiniusProductImportReport,
  readJiniusProductOutcome, type JiniusAttributeNeed,
} from './jinius-product';

const needs: JiniusAttributeNeed[] = [
  { code: 'SKU', label: 'Shop sku', required: true },
  { code: 'NAME', label: 'Name', required: true },
  { code: 'IMG', label: 'Product mainImage url', required: true },
  { code: 'SIZE', label: 'Size', required: false },
];

describe('what stops a Jinius product being created', () => {
  /** By LABEL: "Product mainImage url" is actionable, `IMG` is something to go and look up first. */
  it('names what is missing the way a person would have to fix it', () => {
    const out = missingForJiniusProduct(needs, { shopSku: 'IT49693', categoryCode: 'ESP', values: { SKU: 'IT49693', NAME: 'Sage' } });
    expect(out).toEqual(['Product mainImage url is required by this category and nothing answers it.']);
  });

  it('lets a complete one through, and ignores what the category does not require', () => {
    const values = { SKU: 'IT49693', NAME: 'Sage', IMG: 'https://x/1.jpg' };
    expect(missingForJiniusProduct(needs, { shopSku: 'IT49693', categoryCode: 'ESP', values })).toEqual([]);
  });

  it('refuses without a SKU or a category', () => {
    expect(missingForJiniusProduct([], { shopSku: null, categoryCode: 'ESP', values: {} })[0]).toContain('No SKU');
    expect(missingForJiniusProduct([], { shopSku: 'A', categoryCode: null, values: {} })[0]).toContain('No Jinius category');
  });
});

describe('the file we would send', () => {
  it('writes the attribute codes as the header, and our answers beneath', () => {
    const csv = jiniusProductCsv({ shopSku: 'A', categoryCode: 'ESP', values: { SKU: 'A', NAME: 'Kettle' } });
    expect(csv).toBe('SKU;NAME\r\nA;Kettle\r\n');
  });

  /**
   * A description carries commas, quotes and newlines as a matter of course, and any of the three
   * silently turns one row into two or one column into several.
   */
  it('quotes anything that would otherwise break the row', () => {
    const csv = jiniusProductCsv({ shopSku: 'A', categoryCode: 'E', values: { D: 'Pulls a shot; then steams' } });
    expect(csv).toBe('D\r\n"Pulls a shot; then steams"\r\n');
    expect(jiniusProductCsv({ shopSku: 'A', categoryCode: 'E', values: { D: 'He said "hot"' } }))
      .toBe('D\r\n"He said ""hot"""\r\n');
    expect(jiniusProductCsv({ shopSku: 'A', categoryCode: 'E', values: { D: 'one\ntwo' } })).toContain('"one\ntwo"');
  });

  /** An empty column is not an absent one: some operators read a blank as "clear this". */
  it('leaves out a column nothing answers rather than sending it blank', () => {
    const csv = jiniusProductCsv({ shopSku: 'A', categoryCode: 'E', values: { SKU: 'A', SIZE: '  ' } });
    expect(csv).toBe('SKU\r\nA\r\n');
  });
});

describe('what the import came to', () => {
  const done = (o: Partial<ReturnType<typeof readJiniusProductImportReport>> = {}) =>
    ({ status: 'COMPLETE', done: true, integrated: 1, rejected: 0, pending: 0, hasErrorReport: false, ...o });

  it('reads the import id and the report Mirakl answers with', () => {
    expect(readJiniusProductImportId({ import_id: 5512 })).toBe(5512);
    expect(readJiniusProductImportReport({ import_status: 'COMPLETE', products_integrated: 1, products_rejected: 0 }))
      .toMatchObject({ status: 'COMPLETE', done: true, integrated: 1 });
    expect(readJiniusProductImportReport({ import_status: 'RUNNING' }).done).toBe(false);
  });

  /** "Queued" is a poor answer to "did it work", so it says which it is. */
  it('separates sent from accepted', () => {
    expect(readJiniusProductOutcome(200, 77, null).message).toContain('still being processed');
    expect(readJiniusProductOutcome(200, 77, done()).message).toContain('accepted the product');
  });

  it('points at the error report when Jinius refused it', () => {
    const r = readJiniusProductOutcome(200, 77, done({ integrated: 0, rejected: 1 }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('error report');
  });

  it('names a permission problem as one, and does not call an empty result a success', () => {
    expect(readJiniusProductOutcome(403, null, null).message).toContain('may not add products');
    expect(readJiniusProductOutcome(200, 77, done({ integrated: 0, rejected: 0 })).ok).toBe(false);
  });
});

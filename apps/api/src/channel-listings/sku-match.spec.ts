import { describe, expect, it } from 'vitest';
import { buildSkuOwnerIndex, normaliseSku, relinkAction } from './sku-match';

const catalogue = [
  { id: 'p1', mainSku: 'IT68277', aliases: [{ skuValue: 'IT-68277' }] },
  { id: 'p2', mainSku: 'BE-HL 40', aliases: [] },
  { id: 'p3', mainSku: 'RE-MB3000', aliases: [{ skuValue: 'RE-MB3000-FBA' }, { skuValue: '92-HX6859/29' }] },
];
const index = buildSkuOwnerIndex(catalogue);

describe('normaliseSku', () => {
  it('ignores case and surrounding space, which channels vary freely', () => {
    expect(normaliseSku(' IT68277 ')).toBe('it68277');
    expect(normaliseSku('it68277')).toBe(normaliseSku('IT68277'));
  });

  /**
   * Inner spaces are kept. `BE-HL 40` is a real SKU on eBay and stripping its space would make it a
   * different one — normalising is for noise the channel adds, not for editing somebody's SKU.
   */
  it('keeps inner punctuation and spaces exactly', () => {
    expect(normaliseSku('BE-HL 40')).toBe('be-hl 40');
    expect(normaliseSku('92-HX6859/29')).toBe('92-hx6859/29');
  });

  it('survives nothing at all', () => {
    for (const v of [null, undefined, '', '   ']) expect(normaliseSku(v)).toBe('');
  });
});

describe('buildSkuOwnerIndex', () => {
  it('finds a product by its main SKU', () => {
    expect(index.get('it68277')).toMatchObject({ productId: 'p1', isMain: true });
  });

  /** The whole point: an alias is a way into the same product, and its stock. */
  it('finds a product by any of its aliases', () => {
    expect(index.get('it-68277')).toMatchObject({ productId: 'p1', isMain: false });
    expect(index.get('re-mb3000-fba')).toMatchObject({ productId: 'p3', isMain: false });
    expect(index.get('92-hx6859/29')).toMatchObject({ productId: 'p3', isMain: false });
  });

  it('is case-insensitive on the way in as well as the way out', () => {
    const i = buildSkuOwnerIndex([{ id: 'x', mainSku: 'AbC', aliases: [{ skuValue: 'dEf' }] }]);
    expect(i.get('abc')?.productId).toBe('x');
    expect(i.get('def')?.productId).toBe('x');
  });

  /**
   * A main SKU outranks an alias claiming the same string. The namespace check should prevent the
   * clash; if it ever fails, the product's own SKU is the defensible winner and picking silently
   * between two would hide the day it stopped holding.
   */
  it('lets a main SKU win a collision with someone elses alias', () => {
    const i = buildSkuOwnerIndex([
      { id: 'alias-owner', mainSku: 'AAA', aliases: [{ skuValue: 'SHARED' }] },
      { id: 'main-owner', mainSku: 'SHARED', aliases: [] },
    ]);
    expect(i.get('shared')).toMatchObject({ productId: 'main-owner', isMain: true });
  });

  it('ignores blank SKUs rather than indexing an empty key', () => {
    const i = buildSkuOwnerIndex([{ id: 'x', mainSku: '  ', aliases: [{ skuValue: '' }] }]);
    expect(i.has('')).toBe(false);
  });
});

describe('relinkAction', () => {
  /** The 14 rows on production: a live listing on a known alias, linked to nothing. */
  it('claims an unlinked row whose SKU the catalogue knows', () => {
    expect(relinkAction({ channelSku: 'IT-68277', productId: null }, index))
      .toEqual({ action: 'claim', productId: 'p1' });
  });

  it('leaves a row that is already on the right product', () => {
    expect(relinkAction({ channelSku: 'IT68277', productId: 'p1' }, index))
      .toEqual({ action: 'none', productId: 'p1' });
  });

  /** An alias transferred to another product should take its live listing with it. */
  it('moves a row whose SKU now belongs to a different product', () => {
    expect(relinkAction({ channelSku: 'IT-68277', productId: 'p2' }, index))
      .toEqual({ action: 'move', productId: 'p1' });
  });

  /**
   * Two thousand rows on production carry a SKU nobody has registered. Saying so is the point:
   * guessing an owner would attach a stock figure to the wrong listing, and these need somebody to
   * define the alias rather than an algorithm to pick for them.
   */
  it('refuses to guess an owner for a SKU the catalogue does not know', () => {
    expect(relinkAction({ channelSku: 'NEVER-SEEN-THIS', productId: null }, index))
      .toEqual({ action: 'unknown-sku', productId: null });
    expect(relinkAction({ channelSku: '', productId: null }, index).action).toBe('unknown-sku');
  });

  it('matches regardless of how the channel cased it', () => {
    expect(relinkAction({ channelSku: ' it-68277 ', productId: null }, index))
      .toEqual({ action: 'claim', productId: 'p1' });
  });
});

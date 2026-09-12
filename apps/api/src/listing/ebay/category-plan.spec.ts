import { describe, expect, it } from 'vitest';
import { aspectsForPayload, missingAspects, resolveAspects, type CategoryAspect } from './category-plan';

const aspect = (name: string, required = false, extra: Partial<CategoryAspect> = {}): CategoryAspect =>
  ({ name, required, ...extra });

describe('resolveAspects', () => {
  it('fills Brand and MPN from the product without anybody typing them', () => {
    const out = resolveAspects(
      [aspect('Brand', true), aspect('MPN', true)],
      {},
      { brand: 'Beurer', mpn: 'LR200' },
    );
    expect(out).toEqual([
      { name: 'Brand', value: 'Beurer', required: true, source: 'brand' },
      { name: 'MPN', value: 'LR200', required: true, source: 'mpn' },
    ]);
  });

  /** For the products sold here the manufacturer part number IS the model — same as offer-payload. */
  it('answers Model from the MPN, and lets a planned value win', () => {
    expect(resolveAspects([aspect('Model')], {}, { mpn: 'LR200' })[0])
      .toEqual({ name: 'Model', value: 'LR200', required: false, source: 'model-from-mpn' });

    expect(resolveAspects([aspect('Model')], { Model: 'LR 200 Air Purifier' }, { mpn: 'LR200' })[0])
      .toEqual({ name: 'Model', value: 'LR 200 Air Purifier', required: false, source: 'plan' });
  });

  it('leaves an aspect nobody can answer empty rather than inventing one', () => {
    const out = resolveAspects([aspect('Capacity', true)], {}, { brand: 'Beurer' });
    expect(out[0]).toEqual({ name: 'Capacity', value: null, required: true, source: null });
    expect(missingAspects(out)).toEqual(['Capacity']);
  });

  /**
   * A SELECTION_ONLY aspect refuses anything off its list. Saying which value is wrong, rather than
   * sending it and reading eBay's refusal, is the difference between a form somebody can finish and
   * one that fails on submit.
   */
  it('catches a value the category will not accept, and says so', () => {
    const out = resolveAspects(
      [aspect('Colour', true, { mode: 'SELECTION_ONLY', values: ['Black', 'White'] })],
      { Colour: 'Gunmetal' },
      {},
    );
    expect(out[0].rejectedBecause).toBe('not one of the values eBay accepts here');
    expect(missingAspects(out)).toEqual(['Colour']);
    expect(aspectsForPayload(out)).toEqual({});
  });

  /** Casing must not be the thing that fails, so eBay's own spelling is what travels. */
  it('adopts the channel spelling of an accepted value', () => {
    const out = resolveAspects(
      [aspect('Colour', true, { mode: 'SELECTION_ONLY', values: ['Black', 'White'] })],
      { Colour: 'black' },
      {},
    );
    expect(out[0].value).toBe('Black');
    expect(missingAspects(out)).toEqual([]);
    expect(aspectsForPayload(out)).toEqual({ Colour: ['Black'] });
  });

  it('does not constrain a free-text aspect against its suggestions', () => {
    const out = resolveAspects(
      [aspect('Type', true, { mode: 'FREE_TEXT', values: ['Air Purifier'] })],
      { Type: 'Ioniser' },
      {},
    );
    expect(out[0]).toEqual({ name: 'Type', value: 'Ioniser', required: true, source: 'plan' });
    expect(missingAspects(out)).toEqual([]);
  });

  /** Optional aspects never block a publish, however empty. */
  it('never reports an optional aspect as missing', () => {
    const out = resolveAspects([aspect('Features'), aspect('Capacity')], {}, {});
    expect(missingAspects(out)).toEqual([]);
    expect(aspectsForPayload(out)).toEqual({});
  });

  it('ignores whitespace-only answers', () => {
    const out = resolveAspects([aspect('Capacity', true)], { Capacity: '   ' }, {});
    expect(out[0].value).toBeNull();
    expect(missingAspects(out)).toEqual(['Capacity']);
  });

  it('sends only what was answered and accepted', () => {
    const out = resolveAspects(
      [aspect('Brand', true), aspect('Capacity', true), aspect('Colour', false, { mode: 'SELECTION_ONLY', values: ['Black'] })],
      { Colour: 'Purple' },
      { brand: 'Beurer' },
    );
    expect(aspectsForPayload(out)).toEqual({ Brand: ['Beurer'] });
    expect(missingAspects(out)).toEqual(['Capacity']);
  });
});

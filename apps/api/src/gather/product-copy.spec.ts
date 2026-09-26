import { describe, expect, it } from 'vitest';
import { hasCopy, readProductCopy, renderFeatures, renderParagraphs, renderTitle, titleFits } from './product-copy';

const PARTS = {
  brand: 'Sage',
  model: 'BES875UK',
  whatItIs: 'Barista Express Espresso Machine',
  attributes: ['Stainless Steel', '1850W', '2L Tank'],
};

describe('one title, said to each channel’s limit', () => {
  it('says everything when there is room', () => {
    expect(renderTitle(PARTS, 150)).toBe('Sage BES875UK Barista Express Espresso Machine Stainless Steel 1850W 2L Tank');
  });

  /**
   * Dropped whole and from the end, never cut. A truncated title reads as a mistake, the marketplace
   * counts the characters whether or not the last word survived, and the least useful fact is the
   * one the writer put last.
   */
  it('drops the least useful facts until it fits, rather than truncating', () => {
    // 76 characters in full, so eBay's 80 keeps all of it.
    expect(renderTitle(PARTS, 80)).toBe('Sage BES875UK Barista Express Espresso Machine Stainless Steel 1850W 2L Tank');
    const t = renderTitle(PARTS, 70);
    expect(t).toBe('Sage BES875UK Barista Express Espresso Machine Stainless Steel 1850W');
    expect(t.length).toBeLessThanOrEqual(70);
    expect(renderTitle(PARTS, 50)).toBe('Sage BES875UK Barista Express Espresso Machine');
  });

  /**
   * The identity is never dropped. A title without brand, model and what the thing is is not a
   * shorter title, it is a different one — so when even that will not fit, it comes back whole and
   * over the limit for the channel's own check to refuse, rather than being quietly mangled.
   */
  it('keeps the identity and says so plainly when it cannot fit', () => {
    const long = { brand: 'Sage', model: 'BES875UK', whatItIs: 'Barista Express Espresso Machine' };
    expect(renderTitle(long, 20)).toBe('Sage BES875UK Barista Express Espresso Machine');
    expect(titleFits(long, 20)).toBe(false);
    expect(titleFits(long, 60)).toBe(true);
  });

  it('is unbothered by missing parts and stray whitespace', () => {
    expect(renderTitle({ brand: '  Sage ', whatItIs: 'Kettle' }, 80)).toBe('Sage Kettle');
    expect(renderTitle(null, 80)).toBe('');
  });
});

describe('prose, as each channel takes it', () => {
  const paragraphs = ['Pulls a true espresso.', 'Grinds on demand.'];

  it('gives plain text or basic HTML from the same words', () => {
    expect(renderParagraphs(paragraphs, 'plain')).toBe('Pulls a true espresso.\n\nGrinds on demand.');
    expect(renderParagraphs(paragraphs, 'html')).toBe('<p>Pulls a true espresso.</p><p>Grinds on demand.</p>');
    expect(renderParagraphs([], 'html')).toBe('');
  });

  /** Stored plain so each channel picks its own markup — which means nothing becomes markup by accident. */
  it('escapes what would otherwise become markup', () => {
    expect(renderParagraphs(['Fits 2 < 3 cups & saucers'], 'html')).toBe('<p>Fits 2 &lt; 3 cups &amp; saucers</p>');
  });

  it('caps feature lines where a channel caps them', () => {
    expect(renderFeatures(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(renderFeatures(['a', '  ', 'b'])).toEqual(['a', 'b']);
  });
});

describe('reading what we hold', () => {
  it('does not trust the shape of stored JSON', () => {
    const c = readProductCopy({ title: { brand: 'Sage', attributes: ['Black', 7] }, paragraphs: 'nope', features: ['x'] });
    expect(c.title).toMatchObject({ brand: 'Sage', model: null, attributes: ['Black', '7'] });
    expect(c.paragraphs).toEqual([]);
    expect(c.features).toEqual(['x']);
    expect(readProductCopy(null).title?.brand).toBeNull();
  });

  it('knows when there is nothing to say', () => {
    expect(hasCopy(readProductCopy(null))).toBe(false);
    expect(hasCopy(readProductCopy({ features: ['x'] }))).toBe(true);
  });
});

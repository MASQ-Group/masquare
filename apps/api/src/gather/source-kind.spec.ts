import { describe, expect, it } from 'vitest';
import { classifySourceUrl } from './source-kind';

const panasonic = { name: 'Panasonic', website: null };

describe('classifySourceUrl', () => {
  it('recognises the maker by a recorded website', () => {
    const beurer = { name: 'Beurer', website: 'https://www.beurer.com' };
    expect(classifySourceUrl('https://www.beurer.com/uk/p/lr-200', beurer)).toBe('manufacturer');
    expect(classifySourceUrl('https://shop.beurer.com/x', beurer)).toBe('manufacturer');
  });

  /** No brand in this catalogue has a website recorded, so this is the path that actually runs. */
  it('recognises the maker by the brand name owning a whole domain label', () => {
    expect(classifySourceUrl('https://www.panasonic.com/uk/x', panasonic)).toBe('manufacturer');
    expect(classifySourceUrl('https://panasonic.co.uk/x', panasonic)).toBe('manufacturer');
    expect(classifySourceUrl('https://shop.panasonic.de/x', panasonic)).toBe('manufacturer');
  });

  it('folds punctuation out of a brand name', () => {
    expect(classifySourceUrl('https://www.delonghi.com/en-gb/x', { name: "De'Longhi", website: null }))
      .toBe('manufacturer');
  });

  /**
   * The dangerous direction. A `manufacturer` finding publishes with nobody confirming it, so a
   * reseller must not inherit that authority by putting the brand in its domain.
   */
  describe('refuses to mistake a reseller for the maker', () => {
    it('requires a whole label, not a substring', () => {
      expect(classifySourceUrl('https://panasonic-store.co.uk/x', panasonic)).toBe('web');
      expect(classifySourceUrl('https://mypanasonic.com/x', panasonic)).toBe('web');
      expect(classifySourceUrl('https://panasonicdirect.co.uk/x', panasonic)).toBe('web');
    });

    it('does not match the brand appearing in the path', () => {
      expect(classifySourceUrl('https://retailer.co.uk/brands/panasonic/rp-hje201', panasonic)).toBe('web');
    });

    /** Two-letter brands would match half the internet's labels. */
    it('will not match on a very short brand name', () => {
      expect(classifySourceUrl('https://gb.example.com/x', { name: 'GB', website: null })).toBe('web');
    });
  });

  it('names the marketplaces, across their national domains', () => {
    expect(classifySourceUrl('https://www.amazon.co.uk/dp/B01', panasonic)).toBe('amazon');
    expect(classifySourceUrl('https://www.amazon.de/dp/B01', panasonic)).toBe('amazon');
    expect(classifySourceUrl('https://www.ebay.co.uk/itm/123', panasonic)).toBe('ebay');
  });

  it('calls everything else a web page', () => {
    expect(classifySourceUrl('https://www.currys.co.uk/x', panasonic)).toBe('web');
    expect(classifySourceUrl('https://some-review-site.com/x', panasonic)).toBe('web');
  });

  it('treats an unusable address as an ordinary web page rather than trusting it', () => {
    expect(classifySourceUrl('not a url', panasonic)).toBe('web');
    expect(classifySourceUrl('', panasonic)).toBe('web');
  });

  it('does not need a brand name at all', () => {
    expect(classifySourceUrl('https://www.amazon.co.uk/dp/B01', { name: null, website: null })).toBe('amazon');
    expect(classifySourceUrl('https://anything.com/x', { name: null, website: null })).toBe('web');
  });
});

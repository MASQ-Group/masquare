import { describe, expect, it } from 'vitest';
import { extractPageIdentity, extractSpecPairs } from './spec-extract';

describe('extractSpecPairs', () => {
  it('reads a two-column specification table', () => {
    expect(extractSpecPairs(`
      <table class="specs">
        <tr><th>Capacity</th><td>2.5 L</td></tr>
        <tr><th>Wattage</th><td>1200 W</td></tr>
      </table>
    `)).toEqual([
      { field: 'Capacity', value: '2.5 L' },
      { field: 'Wattage', value: '1200 W' },
    ]);
  });

  it('reads a definition list', () => {
    expect(extractSpecPairs('<dl><dt>Material</dt><dd>Stainless steel</dd></dl>'))
      .toEqual([{ field: 'Material', value: 'Stainless steel' }]);
  });

  it('strips the markup inside a cell without losing the words', () => {
    expect(extractSpecPairs('<tr><td><strong>Colour</strong></td><td><span>Black</span><br>Matte</td></tr>'))
      .toEqual([{ field: 'Colour', value: 'Black Matte' }]);
  });

  it('decodes the entities that actually appear in spec cells', () => {
    expect(extractSpecPairs('<tr><td>Temp&nbsp;range</td><td>20&deg;C &amp; 40&#176;C</td></tr>'))
      .toEqual([{ field: 'Temp range', value: '20°C & 40°C' }]);
  });

  it('drops a trailing colon from a label', () => {
    expect(extractSpecPairs('<tr><td>Capacity:</td><td>2.5 L</td></tr>')[0].field).toBe('Capacity');
  });

  it('keeps the first copy when a page repeats its spec table', () => {
    expect(extractSpecPairs(`
      <table><tr><td>Capacity</td><td>2.5 L</td></tr></table>
      <table class="mobile"><tr><td>Capacity</td><td>2.5 litres</td></tr></table>
    `)).toEqual([{ field: 'Capacity', value: '2.5 L' }]);
  });
});

/**
 * The half that keeps this trustworthy. A manufacturer finding is authoritative and publishes
 * without anybody confirming it, so anything wrong that gets in here goes straight onto a listing.
 */
describe('extractSpecPairs — what it refuses to read', () => {
  /** A comparison table is one label against several products; the first value is a competitor's. */
  it('ignores a row with more than two cells', () => {
    expect(extractSpecPairs('<tr><td>Capacity</td><td>2.5 L</td><td>3.0 L</td></tr>')).toEqual([]);
  });

  it('ignores prose, however it is laid out', () => {
    const prose = 'The generous jug holds around two and a half litres, enough for a large family.';
    expect(extractSpecPairs(`<p>Capacity: ${prose}</p>`)).toEqual([]);
    expect(extractSpecPairs(`<tr><td>Description</td><td>${prose.repeat(4)}</td></tr>`)).toEqual([]);
  });

  it('ignores a label that is really a sentence', () => {
    expect(extractSpecPairs(`<tr><td>${'What our customers say about this product and why '.repeat(2)}</td><td>Great</td></tr>`))
      .toEqual([]);
  });

  it('ignores half a pair', () => {
    expect(extractSpecPairs('<tr><td>Capacity</td><td>  </td></tr>')).toEqual([]);
    expect(extractSpecPairs('<tr><td></td><td>2.5 L</td></tr>')).toEqual([]);
  });

  it('ignores a layout row whose label is not words', () => {
    expect(extractSpecPairs('<tr><td>&nbsp;</td><td>2.5 L</td></tr>')).toEqual([]);
    expect(extractSpecPairs('<tr><td>—</td><td>2.5 L</td></tr>')).toEqual([]);
  });

  it('ignores the same text repeated across both columns', () => {
    expect(extractSpecPairs('<tr><td>Capacity</td><td>capacity</td></tr>')).toEqual([]);
  });

  it('never reads script or style bodies', () => {
    expect(extractSpecPairs(`
      <script>var t = "<tr><td>Capacity</td><td>99 L</td></tr>";</script>
      <style>tr td:after { content: "Wattage"; }</style>
      <table><tr><td>Capacity</td><td>2.5 L</td></tr></table>
    `)).toEqual([{ field: 'Capacity', value: '2.5 L' }]);
  });

  it('finds nothing on a page with no structured specification at all', () => {
    expect(extractSpecPairs('<html><body><h1>Kettle</h1><p>A very good kettle.</p></body></html>')).toEqual([]);
  });
});

describe('extractPageIdentity', () => {
  it('reads the brand and part number the page states about itself', () => {
    const html = `
      <title>Panasonic RP-HJE201E-K Earphones</title>
      <meta property="og:brand" content="Panasonic">
      <table>
        <tr><td>Model number</td><td>RP-HJE201E-K</td></tr>
        <tr><td>Colour</td><td>Black</td></tr>
      </table>`;
    expect(extractPageIdentity(html)).toEqual({
      brand: 'Panasonic',
      mpns: ['RP-HJE201E-K'],
      title: 'Panasonic RP-HJE201E-K Earphones',
    });
  });

  it('falls back to a Brand row when the page carries no metadata', () => {
    const html = '<table><tr><td>Brand</td><td>Beurer</td></tr></table>';
    expect(extractPageIdentity(html).brand).toBe('Beurer');
  });

  /**
   * A title alone is exactly the evidence `verifyIdentity` refuses, so a page that offers only a
   * title must hand back no brand and no part number rather than something that looks checkable.
   */
  it('offers nothing checkable when the page states nothing checkable', () => {
    const v = extractPageIdentity('<title>Black Earphones</title>');
    expect(v.brand).toBeNull();
    expect(v.mpns).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { htmlToPlainText, proseToHtml, renderEbayDescription } from './description-template';

const FULL = {
  title: 'Panasonic RP-HJE201E-K Stereo Earphones',
  brand: 'Panasonic',
  intro: 'Everyday earphones with a comfortable fit.\n\nThe ergonomic design stays put while moving.',
  features: ['9 mm neodymium drivers', '1.2 m cable'],
  specs: [{ label: 'Colour', value: 'Black' }, { label: 'Cable Length', value: '1.2 m' }],
};

describe('renderEbayDescription', () => {
  it('lays out the title, prose, features and specification table', () => {
    const html = renderEbayDescription(FULL);
    expect(html).toContain('Panasonic RP-HJE201E-K Stereo Earphones');
    expect(html).toContain('Key features');
    expect(html).toContain('9 mm neodymium drivers');
    expect(html).toContain('Technical specification');
    expect(html).toContain('Cable Length');
    expect(html).toContain('1.2 m');
  });

  it('turns blank lines into separate paragraphs', () => {
    expect(renderEbayDescription(FULL).match(/<p /g) ?? []).toHaveLength(2);
  });

  /**
   * The design is the platform's, not the writer's. Two unrelated products must produce the same
   * skeleton — otherwise "identical on every listing" is an intention rather than a property.
   */
  it('produces the same structure for two different products', () => {
    // Same SHAPE, different words: two paragraphs, two features, two specs each. Comparing unequal
    // shapes would only prove that more content makes more elements.
    const other = renderEbayDescription({
      title: 'Braun SI3055BK Steam Iron',
      brand: 'Braun',
      intro: 'A steam iron for everyday use.\n\nThe ceramic soleplate glides easily.',
      features: ['2400 W of power', 'Ceramic soleplate'],
      specs: [{ label: 'Wattage', value: '2400 W' }, { label: 'Colour', value: 'Black' }],
    });
    const skeleton = (h: string) => h.replace(/>[^<]*</g, '><');
    expect(skeleton(other)).toBe(skeleton(renderEbayDescription(FULL)));
  });
});

/**
 * The text comes from a web search, so it is data. Everything here is a way that treating it as
 * markup would put something on a live listing that nobody wrote.
 */
describe('renderEbayDescription — the text is never markup', () => {
  it('escapes anything that looks like a tag', () => {
    const html = renderEbayDescription({
      title: '<script>alert(1)</script>',
      features: ['<img src=x onerror=alert(1)>'],
      specs: [{ label: '<b>Width</b>', value: '10 < 20' }],
    });
    // Inert, not absent: the words survive as visible text, but no tag was ever opened — which is
    // exactly what escaping is for. `<img` and `<script` appear nowhere as markup.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('10 &lt; 20');
  });

  it('escapes quotes, which would otherwise break out of a style attribute', () => {
    const html = renderEbayDescription({ title: 'A" style="display:none', intro: "it's fine" });
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
    expect(html).not.toContain('" style="display:none');
  });

  it('carries no active content or links of any kind', () => {
    const html = renderEbayDescription({
      ...FULL,
      intro: 'Call us on 01234 567890 or see http://example.com',
    });
    expect(html).not.toMatch(/<script|<iframe|<form|javascript:|onclick=|onload=/i);
    // The words survive as text; what matters is that nothing became a clickable link.
    expect(html).not.toContain('<a ');
    expect(html).toContain('http://example.com');
  });

  it('uses inline styles only, because eBay strips stylesheets', () => {
    const html = renderEbayDescription(FULL);
    expect(html).not.toContain('<style');
    expect(html).not.toContain('class=');
    expect(html).toContain('style="');
  });
});

describe('renderEbayDescription — what it leaves out', () => {
  it('omits a section with nothing in it rather than printing an empty heading', () => {
    const html = renderEbayDescription({ title: 'A product', intro: 'Some prose.' });
    expect(html).not.toContain('Key features');
    expect(html).not.toContain('Technical specification');
  });

  it('drops half-written specification rows', () => {
    const html = renderEbayDescription({
      title: 'A product',
      specs: [{ label: 'Colour', value: '  ' }, { label: '', value: 'Black' }, { label: 'Width', value: '10 cm' }],
    });
    expect(html.match(/<tr /g) ?? []).toHaveLength(1);
    expect(html).toContain('Width');
  });

  it('returns nothing at all when there is no content', () => {
    expect(renderEbayDescription({ title: '', intro: '', features: [], specs: [] })).toBe('');
    expect(renderEbayDescription({ title: '   ' })).toBe('');
  });

  it('caps runaway content instead of publishing a wall of text', () => {
    const html = renderEbayDescription({
      title: 'A product',
      features: Array.from({ length: 40 }, (_, i) => `Feature ${i}`),
      specs: Array.from({ length: 80 }, (_, i) => ({ label: `L${i}`, value: `V${i}` })),
    });
    expect(html.match(/<li /g) ?? []).toHaveLength(12);
    expect(html.match(/<tr /g) ?? []).toHaveLength(40);
  });

  it('survives a product with no brand', () => {
    expect(renderEbayDescription({ title: 'A product', intro: 'Prose.' })).toContain('A product');
  });
});

describe('htmlToPlainText', () => {
  it('keeps the words and drops the markup', () => {
    expect(htmlToPlainText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('turns block ends into paragraph breaks the template can split on', () => {
    expect(htmlToPlainText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
    expect(htmlToPlainText('First<br>Second')).toBe('First\nSecond');
  });

  it('decodes the entities that would otherwise be double-escaped', () => {
    expect(htmlToPlainText('Tea &amp; coffee &nbsp;now')).toBe('Tea & coffee now');
  });

  it('removes script and style bodies entirely', () => {
    expect(htmlToPlainText('<script>alert(1)</script>Real text')).toBe('Real text');
  });

  it('is empty for nothing', () => {
    expect(htmlToPlainText(null)).toBe('');
    expect(htmlToPlainText('   ')).toBe('');
  });
});

describe('proseToHtml', () => {
  it('turns blank-line paragraphs into <p> blocks the Description editor shows correctly', () => {
    expect(proseToHtml('First paragraph.\n\nSecond one.')).toBe('<p>First paragraph.</p><p>Second one.</p>');
  });

  it('escapes the words, which came from a web search and are never markup', () => {
    expect(proseToHtml('Fits 10 < 20 cm & <b>more</b>')).toBe('<p>Fits 10 &lt; 20 cm &amp; &lt;b&gt;more&lt;/b&gt;</p>');
  });

  /** What goes in must come back out as the same paragraphs, or the eBay description loses its shape. */
  it('round-trips through htmlToPlainText into the same paragraphs', () => {
    const prose = 'Everyday earphones.\n\nThey stay put while you move.';
    expect(htmlToPlainText(proseToHtml(prose))).toBe(prose);
  });

  it('is empty for nothing', () => {
    expect(proseToHtml('')).toBe('');
    expect(proseToHtml('  \n\n  ')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { htmlToPlainText, proseToHtml, renderEbayDescription, TRUST_POINTS, type DescriptionContent } from './description-template';

/** The handoff's reference product. */
const CASIO: DescriptionContent = {
  title: 'Casio A158WEA-9EF Vintage Digital Watch Gold Dial Stainless Steel Bracelet',
  brand: 'Casio',
  mpn: 'A158WEA-9EF',
  series: 'Casio Vintage series',
  storeName: 'TogaluUK',
  conditionLabel: 'New · boxed',
  glance: [
    { value: '33.2 mm', label: 'Case width' },
    { value: '8.2 mm', label: 'Thickness' },
    { value: '3 ATM', label: 'Water resistant' },
  ],
  intro: 'The Casio A158WEA-9EF is a digital watch.\n\nA quartz movement drives the display.',
  features: ['Stopwatch measuring to 1/100 second', 'Daily alarm and hourly time signal'],
  specGroups: [
    { name: 'General', rows: [{ label: 'Brand', value: 'Casio' }, { label: 'MPN', value: 'A158WEA-9EF' }] },
    { name: 'Movement & display', rows: [{ label: 'Movement', value: 'Quartz' }, { label: 'Display', value: 'Digital' }] },
  ],
  inTheBox: 'Watch, original Casio box, manual and warranty card.',
  conditionNote: 'Brand new, unworn, protective film in place.',
  care: 'Soft dry cloth.',
  shipping: [{ label: 'Dispatch', value: 'Same day before 2 pm' }, { label: 'Ships from', value: 'United Kingdom' }],
  faq: [{ q: 'Is the bracelet adjustable?', a: 'Yes, the clasp slides to fit most wrists.' }],
};

describe('renderEbayDescription — the Cards layout', () => {
  it('lays the sections out in the order of the design', () => {
    const html = renderEbayDescription(CASIO);
    const order = [
      'TogaluUK', 'New · boxed', CASIO.title, 'Casio Vintage series · Ref. A158WEA-9EF',
      '33.2 mm', 'Case width', 'The Casio A158WEA-9EF is a digital watch.',
      'Key features', 'Stopwatch measuring', 'Technical specification', 'Movement &amp; display',
      'In the box', 'Condition', 'Care', 'Shipping &amp; returns', 'Why TogaluUK', 'Questions',
    ].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('uses the design tokens', () => {
    const html = renderEbayDescription(CASIO);
    expect(html).toContain('background:#0e7c7b');
    expect(html).toContain('background:#e4572e');
  });

  it('sits against the left edge of eBay’s description area, not floating in the middle of it', () => {
    // eBay's own "Item description from the seller" heading is left-aligned; a centred block under
    // it looked detached from the page.
    const outer = renderEbayDescription(CASIO).match(/^<div style="([^"]*)"/)![1];
    expect(outer).toContain('margin:0;');
    expect(outer).not.toContain('margin:0 auto');
    expect(outer).toContain('max-width:960px');
  });

  it('keeps paragraphs to a readable measure however wide the frame is', () => {
    // A paragraph stretched across 900px is a wall; the prose keeps the width it had at 720px.
    const html = renderEbayDescription({ title: 'A product', intro: 'First paragraph.\n\nSecond paragraph.' });
    const prose = html.match(/<div style="([^"]*)"><p /)![1];
    expect(prose).toContain('max-width:640px');
  });

  it('never fixes a layout width, which is what scrolls sideways on a phone', () => {
    // Three digits and up: a phone is ~360px, so only a width in the hundreds can push past it. The
    // 8px square beside each section heading is decoration, not layout, and is fine.
    expect(renderEbayDescription(CASIO)).not.toMatch(/[;"]width:\d{3,}px/);
  });

  /** Fixed for every listing, whatever the product. */
  it('always carries the trust points', () => {
    const html = renderEbayDescription({ title: 'A product', intro: 'Prose.' });
    for (const t of TRUST_POINTS) expect(html).toContain(t);
    expect(html).toContain('Why buy from us');
  });

  it('turns blank lines into separate paragraphs', () => {
    expect(renderEbayDescription(CASIO).match(/<p /g) ?? []).toHaveLength(2);
  });

  it('puts a flat specification in a single General group', () => {
    const html = renderEbayDescription({ title: 'A product', specs: [{ label: 'Colour', value: 'Black' }] });
    expect(html).toContain('>General<');
    expect(html).toContain('Colour');
  });

  it('shows the reference alone when there is no series, and the brand when there is neither', () => {
    expect(renderEbayDescription({ ...CASIO, series: null })).toContain('>Ref. A158WEA-9EF<');
    expect(renderEbayDescription({ title: 'X', brand: 'Casio', intro: 'Prose.' })).toContain('>Casio<');
  });

  /** eBay allows no media queries, so wrapping has to be intrinsic. */
  it('wraps rather than fixing column counts', () => {
    const html = renderEbayDescription(CASIO);
    expect(html).not.toContain('grid-template-columns');
    expect(html).toContain('flex-wrap:wrap');
  });

  /**
   * The design is the platform's, not the writer's. Two unrelated products must produce the same
   * skeleton — otherwise "identical on every listing" is an intention rather than a property.
   */
  it('produces the same structure for two different products', () => {
    const other = renderEbayDescription({
      ...CASIO,
      title: 'Braun SI3055BK Steam Iron',
      brand: 'Braun', mpn: 'SI3055BK', series: 'Braun TexStyle 3',
      glance: [{ value: '2400 W', label: 'Power' }, { value: '270 ml', label: 'Tank' }, { value: '2 m', label: 'Cable' }],
      intro: 'A steam iron for everyday use.\n\nThe ceramic soleplate glides easily.',
      features: ['2400 W of power', 'Ceramic soleplate'],
      specGroups: [
        { name: 'General', rows: [{ label: 'Brand', value: 'Braun' }, { label: 'MPN', value: 'SI3055BK' }] },
        { name: 'Power', rows: [{ label: 'Wattage', value: '2400 W' }, { label: 'Voltage', value: '230 V' }] },
      ],
      inTheBox: 'Iron and manual.', conditionNote: 'Brand new.', care: 'Descale monthly.',
      faq: [{ q: 'Does it have auto shut-off?', a: 'Yes.' }],
    });
    const skeleton = (h: string) => h.replace(/>[^<]*</g, '><');
    expect(skeleton(other)).toBe(skeleton(renderEbayDescription(CASIO)));
  });
});

/**
 * The text comes from a web search, so it is data. Everything here is a way that treating it as
 * markup would put something on a live listing that nobody wrote.
 */
describe('renderEbayDescription — the text is never markup', () => {
  it('escapes anything that looks like a tag, in every section', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = renderEbayDescription({
      ...CASIO,
      title: evil, series: evil, storeName: evil, conditionLabel: evil, intro: evil, inTheBox: evil, care: evil,
      features: [evil], glance: [{ value: evil, label: evil }],
      specGroups: [{ name: evil, rows: [{ label: evil, value: evil }] }],
      shipping: [{ label: evil, value: evil }], faq: [{ q: evil, a: evil }],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes quotes, which would otherwise break out of a style attribute', () => {
    const html = renderEbayDescription({ title: 'He said "hi" and \'bye\'' });
    expect(html).toContain('&quot;hi&quot;');
    expect(html).toContain('&#39;bye&#39;');
  });

  it('carries no active content or links of any kind', () => {
    const html = renderEbayDescription(CASIO);
    for (const banned of ['<script', '<iframe', '<form', '<a ', 'href=', 'src=', 'on' + 'click']) {
      expect(html.toLowerCase()).not.toContain(banned);
    }
  });

  it('uses inline styles only, because eBay strips stylesheets', () => {
    const html = renderEbayDescription(CASIO);
    expect(html).not.toContain('<style');
    expect(html).not.toContain('class=');
  });
});

describe('renderEbayDescription — what it leaves out', () => {
  it('omits every optional section with nothing in it rather than printing an empty frame', () => {
    const html = renderEbayDescription({ title: 'A product', intro: 'Some prose.' });
    for (const heading of ['Key features', 'Technical specification', 'In the box', 'Care', 'Shipping &amp; returns', 'Questions']) {
      expect(html).not.toContain(heading);
    }
    expect(html).not.toContain('font-size:18px'); // no at-a-glance strip
  });

  it('drops half-written rows and figures', () => {
    const html = renderEbayDescription({
      title: 'A product',
      glance: [{ value: '', label: 'Width' }, { value: '10 cm', label: 'Depth' }],
      specs: [{ label: 'Colour', value: '  ' }, { label: '', value: 'Black' }, { label: 'Width', value: '10 cm' }],
    });
    expect(html.match(/min-width:120px/g) ?? []).toHaveLength(1);
    expect(html.match(/font-size:18px/g) ?? []).toHaveLength(1);
  });

  it('returns nothing at all when there is no content', () => {
    expect(renderEbayDescription({ title: '', intro: '', features: [], specs: [] })).toBe('');
    expect(renderEbayDescription({ title: '   ' })).toBe('');
  });

  it('caps runaway content instead of publishing a wall of text', () => {
    const html = renderEbayDescription({
      title: 'A product',
      glance: Array.from({ length: 9 }, (_, i) => ({ value: `${i}`, label: `G${i}` })),
      features: Array.from({ length: 40 }, (_, i) => `Feature ${i}`),
      specGroups: Array.from({ length: 5 }, (_, g) => ({ name: `Group ${g}`, rows: Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, value: `V${i}` })) })),
      faq: Array.from({ length: 20 }, (_, i) => ({ q: `Q${i}?`, a: 'A.' })),
    });
    expect(html.match(/<li /g) ?? []).toHaveLength(12);
    expect(html.match(/min-width:120px/g) ?? []).toHaveLength(60);
    expect(html.match(/font-size:18px/g) ?? []).toHaveLength(4);
    expect(html.match(/<strong /g) ?? []).toHaveLength(6);
  });

  it('survives a product with no brand, store or condition', () => {
    const html = renderEbayDescription({ title: 'A product', intro: 'Prose.' });
    expect(html).toContain('A product');
    expect(html).not.toContain('text-transform:uppercase;opacity:.85');
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

import { describe, expect, it } from 'vitest';
import { LIMITS, pageKey, screenResearch } from './screen-research';

const PANASONIC = { brand: 'Panasonic', brandWebsite: null, mpn: 'RP-HJE201E-K' };
const MAKER = 'https://www.panasonic.com/uk/consumer/rp-hje201e-k.html';
const SHOP = 'https://www.currys.co.uk/products/panasonic-rp-hje201e-k';

describe('screenResearch', () => {
  it('accepts a page that states it is this product, as the maker when it is the maker', () => {
    const out = screenResearch(
      PANASONIC,
      [{ url: MAKER, pageBrand: 'Panasonic', pagePartNumber: 'RP-HJE201E-K' }],
      [{ field: 'Colour', value: 'Black', sourceUrl: MAKER }],
    );
    expect(out.acceptedSources).toEqual([{ url: MAKER, kind: 'manufacturer', matchedOn: ['brand', 'mpn'] }]);
    expect(out.accepted).toEqual([
      { field: 'Colour', value: 'Black', kind: 'manufacturer', url: MAKER, label: 'panasonic.com' },
    ]);
  });

  it('files a retailer as an ordinary web page, whatever it calls itself', () => {
    const out = screenResearch(
      PANASONIC,
      [{ url: SHOP, pageBrand: 'Panasonic', pagePartNumber: 'RP-HJE201E-K' }],
      [{ field: 'Colour', value: 'Black', sourceUrl: SHOP }],
    );
    expect(out.accepted[0].kind).toBe('web');
  });

  /** The failure this whole layer exists for. */
  it('rejects a page about a different product, and every value it stated', () => {
    const marley = 'https://www.example-shop.com/marley-smile-jamaica';
    const out = screenResearch(
      PANASONIC,
      [{ url: marley, pageBrand: 'Marley', pagePartNumber: 'EM-JE041' }],
      [
        { field: 'Colour', value: 'Black', sourceUrl: marley },
        { field: 'Connectivity', value: 'Wired', sourceUrl: marley },
      ],
    );
    expect(out.accepted).toEqual([]);
    expect(out.rejectedSources[0].reason).toContain('Marley');
    expect(out.dropped.map((d) => d.why)).toEqual([
      'its page describes a different product',
      'its page describes a different product',
    ]);
  });

  /** Failing to disagree is not agreement: a page that shows no brand and no part number proves nothing. */
  it('rejects a page that does not say which product it is', () => {
    const out = screenResearch(PANASONIC, [{ url: SHOP }], [{ field: 'Colour', value: 'Black', sourceUrl: SHOP }]);
    expect(out.accepted).toEqual([]);
    expect(out.rejectedSources).toHaveLength(1);
  });

  it('drops a value cited against a page that was never declared', () => {
    const out = screenResearch(
      PANASONIC,
      [{ url: MAKER, pageBrand: 'Panasonic', pagePartNumber: 'RP-HJE201E-K' }],
      [{ field: 'Colour', value: 'Black', sourceUrl: 'https://somewhere-else.com/p' }],
    );
    expect(out.accepted).toEqual([]);
    expect(out.dropped[0].why).toContain('not declared');
  });

  it('matches a citation to its source despite a trailing slash, a fragment or a capitalised host', () => {
    const out = screenResearch(
      PANASONIC,
      [{ url: 'https://WWW.Panasonic.com/uk/p/', pageBrand: 'Panasonic', pagePartNumber: 'RP-HJE201E-K' }],
      [{ field: 'Colour', value: 'Black', sourceUrl: 'https://www.panasonic.com/uk/p#specs' }],
    );
    expect(out.accepted).toHaveLength(1);
  });

  it('refuses anything that is not an http(s) address', () => {
    const out = screenResearch(
      PANASONIC,
      [{ url: 'file:///etc/passwd', pageBrand: 'Panasonic', pagePartNumber: 'RP-HJE201E-K' }],
      [{ field: 'Colour', value: 'Black', sourceUrl: 'file:///etc/passwd' }],
    );
    expect(out.accepted).toEqual([]);
    expect(out.rejectedSources[0].reason).toContain('http');
  });

  it('keeps nothing blank, and says nothing about it — nothing found is not a finding', () => {
    const out = screenResearch(
      PANASONIC,
      [{ url: MAKER, pageBrand: 'Panasonic', pagePartNumber: 'RP-HJE201E-K' }],
      [{ field: 'Colour', value: '   ', sourceUrl: MAKER }, { field: '', value: 'Black', sourceUrl: MAKER }],
    );
    expect(out.accepted).toEqual([]);
    expect(out.dropped).toEqual([]);
  });

  /** Two pages disagreeing is information; both reach the provenance rules, which decide. */
  it('passes both sides of a disagreement through rather than choosing', () => {
    const out = screenResearch(
      PANASONIC,
      [
        { url: MAKER, pageBrand: 'Panasonic', pagePartNumber: 'RP-HJE201E-K' },
        { url: SHOP, pageBrand: 'Panasonic', pagePartNumber: 'RP-HJE201E-K' },
      ],
      [
        { field: 'Cable Length', value: '1.2 m', sourceUrl: MAKER },
        { field: 'Cable Length', value: '1 m', sourceUrl: SHOP },
      ],
    );
    expect(out.accepted.map((f) => `${f.kind}:${f.value}`)).toEqual(['manufacturer:1.2 m', 'web:1 m']);
  });

  it('says so when a submission is over the limits instead of truncating quietly', () => {
    const many = Array.from({ length: LIMITS.findings + 5 }, (_, i) => ({ field: `F${i}`, value: 'x', sourceUrl: MAKER }));
    const out = screenResearch(PANASONIC, [{ url: MAKER, pageBrand: 'Panasonic', pagePartNumber: 'RP-HJE201E-K' }], many);
    expect(out.accepted).toHaveLength(LIMITS.findings);
    expect(out.dropped.at(-1)?.why).toContain(`first ${LIMITS.findings}`);
  });
});

describe('pageKey', () => {
  it('treats cosmetic differences as the same page', () => {
    expect(pageKey('https://Example.com/a/')).toBe(pageKey('https://example.com/a#x'));
  });

  it('keeps the query string, because it can select a different product', () => {
    expect(pageKey('https://shop.com/p?id=1')).not.toBe(pageKey('https://shop.com/p?id=2'));
  });

  it('refuses what is not a web address', () => {
    expect(pageKey('javascript:alert(1)')).toBeNull();
    expect(pageKey('not a url')).toBeNull();
  });
});

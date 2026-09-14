import { describe, expect, it } from 'vitest';
import {
  ORIGIN_KINDS, applyUserEdits, classifyAspect, eligibleValues, isPayloadEligible,
  normaliseAspects, toJson, verifyAspect,
  type AspectOrigin, type AspectRecord,
} from './provenance';

const AT = '2026-09-14T09:00:00.000Z';
const from = (kind: AspectOrigin['kind'], value: string): AspectOrigin => ({ kind, value });
const rec = (value: string, ...origins: AspectOrigin[]): AspectRecord => ({ value, origins });

describe('classifyAspect', () => {
  it('treats the manufacturer as authoritative on its own', () => {
    expect(classifyAspect(rec('1200 W', from('manufacturer', '1200 W')))).toBe('authoritative');
  });

  /** The stated rule: neither marketplace is ever trusted alone. */
  it('holds back a value only one marketplace vouches for', () => {
    expect(classifyAspect(rec('1200 W', from('amazon', '1200 W')))).toBe('unconfirmed');
    expect(classifyAspect(rec('1200 W', from('ebay', '1200 W')))).toBe('unconfirmed');
  });

  it('accepts two independent sources agreeing', () => {
    expect(classifyAspect(rec('1200 W', from('amazon', '1200 W'), from('ebay', '1200 W')))).toBe('agreement');
  });

  /**
   * Two pages on Amazon are one source. Counting origins rather than kinds would let a single
   * scraper agree with itself and clear the two-source bar on its own.
   */
  /**
   * `web` is not a place, it is everywhere else — so two independent sites DO corroborate, while two
   * pages on the same site do not. Without this, everything a search turned up would collapse into
   * one voice and nothing on the open web could ever clear the two-source bar.
   */
  describe('pages found by searching', () => {
    const at = (host: string, value: string) => ({ kind: 'web' as const, value, url: `https://${host}/p` });

    it('counts two different sites as two sources', () => {
      expect(classifyAspect(rec('1200 W', at('currys.co.uk', '1200 W'), at('johnlewis.com', '1200 W'))))
        .toBe('agreement');
    });

    it('counts two pages on one site as one source', () => {
      expect(classifyAspect(rec('1200 W', at('currys.co.uk', '1200 W'), at('www.currys.co.uk', '1200 W'))))
        .toBe('unconfirmed');
    });

    it('lets a web page corroborate a marketplace', () => {
      expect(classifyAspect(rec('1200 W', from('amazon', '1200 W'), at('currys.co.uk', '1200 W'))))
        .toBe('agreement');
    });

    it('will not let web pages with no address corroborate each other', () => {
      const noUrl = (value: string) => ({ kind: 'web' as const, value });
      expect(classifyAspect(rec('1200 W', noUrl('1200 W'), noUrl('1200 W')))).toBe('unconfirmed');
    });
  });

  it('does not let one source corroborate itself', () => {
    expect(classifyAspect(rec('1200 W', from('amazon', '1200 W'), from('amazon', '1200 W')))).toBe('unconfirmed');
  });

  it('calls a one-against-one disagreement a conflict', () => {
    expect(classifyAspect(rec('1200 W', from('amazon', '1200 W'), from('ebay', '1500 W')))).toBe('conflict');
  });

  /** Dissent does not undo agreement — two sources agreeing is the bar, and it was met. */
  it('still accepts agreement when a third source disagrees', () => {
    const r = rec('1200 W', from('amazon', '1200 W'), from('ebay', '1200 W'), from('manufacturer', '1500 W'));
    expect(classifyAspect(r)).toBe('agreement');
  });

  it('lets the manufacturer settle an argument between marketplaces', () => {
    const r = rec('1500 W', from('manufacturer', '1500 W'), from('amazon', '1200 W'), from('ebay', '1200 W'));
    expect(classifyAspect(r)).toBe('authoritative');
  });

  /** A datasheet against the same manufacturer's product page. Nothing outranks either. */
  it('calls two manufacturer sources disagreeing a conflict', () => {
    const r = rec('1200 W', from('manufacturer', '1200 W'), from('manufacturer', '1500 W'));
    expect(classifyAspect(r)).toBe('conflict');
  });

  it('still lets the manufacturer beat a marketplace that disagrees', () => {
    const r = rec('1200 W', from('manufacturer', '1200 W'), from('amazon', '1500 W'), from('ebay', '1500 W'));
    expect(classifyAspect(r)).toBe('authoritative');
  });

  it('lets a person overrule the manufacturer', () => {
    const r = rec('1500 W', from('manufacturer', '1200 W'), from('user', '1500 W'));
    expect(classifyAspect(r)).toBe('user');
  });

  /**
   * The same comparison the gather uses. If these two ever diverge, a value both sources vouch for
   * gets folded as agreement and then read back as a conflict.
   */
  it('reads two spellings of one answer as agreement', () => {
    expect(classifyAspect(rec('1200 W', from('amazon', '1200 W'), from('ebay', '1200 watts'))))
      .toBe('agreement');
    expect(classifyAspect(rec('1.5 kg', from('amazon', '1.50 kg'), from('ebay', '1,500 g'))))
      .toBe('conflict');
  });

  it('ignores casing and surrounding spaces when deciding who agrees', () => {
    expect(classifyAspect(rec('Stainless Steel', from('amazon', 'stainless steel '), from('ebay', 'STAINLESS STEEL'))))
      .toBe('agreement');
  });

  /**
   * This test used to assert the OPPOSITE — that a record with no evidence was a person's answer —
   * and that rule is what turned lost evidence into trusted data in production. A legacy bare string
   * still reads as typed (see normaliseAspects), because it is given an explicit user origin there.
   * A record that arrives with no origins has lost them, and must fail closed.
   */
  it('holds back a record whose evidence is missing, rather than trusting it', () => {
    expect(classifyAspect(rec('1200 W'))).toBe('unconfirmed');
    expect(isPayloadEligible(rec('1200 W'))).toBe(false);
  });

  /** But a value the recorded evidence actively argues with is nobody's answer. */
  it('calls a stored value that no source backs a conflict', () => {
    expect(classifyAspect(rec('900 W', from('amazon', '1200 W')))).toBe('conflict');
  });
});

describe('isPayloadEligible', () => {
  it('sends what a person, the manufacturer, or two agreeing sources stand behind', () => {
    expect(isPayloadEligible(rec('x', from('user', 'x')))).toBe(true);
    expect(isPayloadEligible(rec('x', from('manufacturer', 'x')))).toBe(true);
    expect(isPayloadEligible(rec('x', from('amazon', 'x'), from('ebay', 'x')))).toBe(true);
  });

  it('withholds a suggestion and a conflict', () => {
    expect(isPayloadEligible(rec('x', from('amazon', 'x')))).toBe(false);
    expect(isPayloadEligible(rec('x', from('amazon', 'x'), from('ebay', 'y')))).toBe(false);
  });

  it('sends a held-back value once a person has confirmed it', () => {
    expect(isPayloadEligible(verifyAspect(rec('x', from('amazon', 'x')), AT, 'someone'))).toBe(true);
    expect(isPayloadEligible(verifyAspect(rec('x', from('amazon', 'x'), from('ebay', 'y')), AT))).toBe(true);
  });
});

describe('normaliseAspects', () => {
  /** The shape every existing row is in. */
  it('reads the old flat map as values a person typed', () => {
    expect(normaliseAspects({ Brand: 'Beurer' })).toEqual({
      Brand: { value: 'Beurer', origins: [{ kind: 'user', value: 'Beurer' }] },
    });
  });

  it('reads the record shape back, including the evidence', () => {
    const stored = {
      Wattage: {
        value: '1200 W',
        origins: [{ kind: 'manufacturer', value: '1200 W', url: 'https://x/ds.pdf', label: 'Datasheet p.4', at: AT }],
        verifiedAt: AT,
        verifiedBy: 'someone',
      },
    };
    expect(normaliseAspects(stored)).toEqual(stored);
  });

  it('survives the two shapes side by side in one column', () => {
    const out = normaliseAspects({ Brand: 'Beurer', Wattage: { value: '1200 W', origins: [{ kind: 'amazon', value: '1200 W' }] } });
    expect(classifyAspect(out.Brand)).toBe('user');
    expect(classifyAspect(out.Wattage)).toBe('unconfirmed');
  });

  /**
   * An empty or malformed answer is dropped, never coerced. A blank that survived would be
   * published as a blank item specific, which is worse than an absent one.
   */
  it('drops blanks and things that are not aspects', () => {
    expect(normaliseAspects({
      A: '   ', B: null, C: [], D: 42, E: { origins: [] }, F: { value: '  ' },
    })).toEqual({});
    expect(normaliseAspects(null)).toEqual({});
    expect(normaliseAspects(['Brand'])).toEqual({});
  });

  it('drops an origin with an unknown kind rather than trusting it', () => {
    const out = normaliseAspects({
      Wattage: { value: '1200 W', origins: [{ kind: 'blog', value: '1200 W' }, { kind: 'amazon', value: '1200 W' }] },
    });
    expect(out.Wattage.origins).toEqual([{ kind: 'amazon', value: '1200 W' }]);
  });
});

describe('eligibleValues', () => {
  it('hands on only what may be used, so a suggestion cannot leak through resolution', () => {
    expect(eligibleValues({
      Brand: rec('Beurer', from('user', 'Beurer')),
      Wattage: rec('1200 W', from('amazon', '1200 W')),
      Colour: rec('White', from('amazon', 'White'), from('ebay', 'White')),
    })).toEqual({ Brand: 'Beurer', Colour: 'White' });
  });
});

describe('applyUserEdits', () => {
  it('keeps what the old source said when a person overrides it', () => {
    const out = applyUserEdits(
      { Wattage: rec('1200 W', from('manufacturer', '1200 W')) },
      { Wattage: '1500 W' },
      AT,
    );
    expect(out.Wattage).toEqual({
      value: '1500 W',
      origins: [{ kind: 'manufacturer', value: '1200 W' }, { kind: 'user', value: '1500 W', at: AT }],
    });
    // And the person wins, despite the manufacturer still being on file.
    expect(classifyAspect(out.Wattage)).toBe('user');
  });

  /** Accepting a suggestion by leaving it in the box is a confirmation, and makes it sendable. */
  it('turns a suggestion into an answer when a person submits it unchanged', () => {
    const out = applyUserEdits({ Wattage: rec('1200 W', from('amazon', '1200 W')) }, { Wattage: '1200 W' }, AT);
    expect(classifyAspect(out.Wattage)).toBe('user');
    expect(isPayloadEligible(out.Wattage)).toBe(true);
  });

  it('does not stack a duplicate origin every time the form is saved', () => {
    const once = applyUserEdits({}, { Brand: 'Beurer' }, AT);
    const twice = applyUserEdits(once, { Brand: 'Beurer' }, '2026-10-01T00:00:00.000Z');
    expect(twice.Brand.origins).toHaveLength(1);
  });

  it('deletes an answer that was emptied rather than storing a blank', () => {
    expect(applyUserEdits({ Brand: rec('Beurer', from('user', 'Beurer')) }, { Brand: '  ' }, AT)).toEqual({});
  });

  it('leaves aspects nobody edited exactly as they were', () => {
    const before = { Wattage: rec('1200 W', from('amazon', '1200 W'), from('ebay', '1200 W')) };
    expect(applyUserEdits(before, { Brand: 'Beurer' }, AT).Wattage).toEqual(before.Wattage);
  });
});

describe('toJson', () => {
  /** What is written must be readable by the thing that reads it; anything else is a one-way trip. */
  it('round-trips through the column', () => {
    const records = {
      Brand: rec('Beurer', from('user', 'Beurer')),
      Wattage: verifyAspect(
        { value: '1200 W', origins: [{ kind: 'manufacturer', value: '1200 W', url: 'https://x/ds.pdf', label: 'p.4', at: AT }] },
        AT, 'someone',
      ),
    };
    expect(normaliseAspects(JSON.parse(JSON.stringify(toJson(records))))).toEqual(records);
  });

  /**
   * The production bug, pinned. Claude's research is saved with `web` sources; the reader discarded
   * that kind, so a single retailer's claim — held back when saved — read back as trusted and
   * publishable. Saving and reading must never change a verdict.
   */
  it('keeps a web source, and its verdict, through a save and a read', () => {
    const records = {
      Department: rec('Wristwatches', { kind: 'web' as const, value: 'Wristwatches', url: 'https://shop.example.com/p' }),
    };
    const readBack = normaliseAspects(JSON.parse(JSON.stringify(toJson(records))));
    expect(readBack.Department.origins).toEqual(records.Department.origins);
    expect(classifyAspect(readBack.Department)).toBe('unconfirmed');
    expect(isPayloadEligible(readBack.Department)).toBe(false);
  });

  /**
   * Guards the whole class of bug, not just this instance: EVERY kind the type allows must survive a
   * round trip. Adding a kind to ORIGIN_KINDS without the reader keeping it now fails here.
   */
  it('keeps every kind of source through a save and a read', () => {
    for (const kind of ORIGIN_KINDS) {
      const records = { F: rec('v', { kind, value: 'v', url: 'https://example.com/p' }) };
      const readBack = normaliseAspects(JSON.parse(JSON.stringify(toJson(records))));
      expect(readBack.F.origins.map((o) => o.kind), `kind "${kind}" was lost on read`).toEqual([kind]);
    }
  });

  it('never changes any verdict by saving and reading back', () => {
    const cases = {
      a: rec('x', from('manufacturer', 'x')),
      b: rec('x', from('amazon', 'x'), from('ebay', 'x')),
      c: rec('x', { kind: 'web' as const, value: 'x', url: 'https://a.com/p' }, { kind: 'web' as const, value: 'x', url: 'https://b.com/p' }),
      d: rec('x', { kind: 'web' as const, value: 'x', url: 'https://a.com/p' }),
      e: rec('x', from('amazon', 'x'), from('ebay', 'y')),
      f: rec('x', from('user', 'x')),
    };
    const readBack = normaliseAspects(JSON.parse(JSON.stringify(toJson(cases))));
    for (const [k, r] of Object.entries(cases)) {
      expect(classifyAspect(readBack[k]), `case ${k}`).toBe(classifyAspect(r));
    }
  });

  it('writes no undefined keys, which Prisma would reject', () => {
    expect(JSON.stringify(toJson({ Brand: rec('Beurer', from('user', 'Beurer')) })))
      .toBe('{"Brand":{"value":"Beurer","origins":[{"kind":"user","value":"Beurer"}]}}');
  });
});

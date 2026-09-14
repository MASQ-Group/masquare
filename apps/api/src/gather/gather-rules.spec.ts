import { describe, expect, it } from 'vitest';
import { canGather, foldFindings, matchFieldToAspect, type SourceFinding } from './gather-rules';
import { classifyAspect, isPayloadEligible, type AspectRecord } from './provenance';

const AT = '2026-09-14T09:00:00.000Z';
const ASPECTS = ['Brand', 'Wattage', 'Colour', 'Capacity'];

const found = (kind: SourceFinding['kind'], field: string, value: string): SourceFinding =>
  ({ kind, field, value });

describe('canGather', () => {
  it('runs when the product can be identified exactly', () => {
    const v = canGather({ manufacturerSku: 'LR200', ean: '4211125641252', brand: 'Beurer' });
    expect(v).toEqual({
      ok: true,
      searchOn: { mpn: 'LR200', gtin: '4211125641252', gtinKind: 'EAN', brand: 'Beurer' },
    });
  });

  it('falls back to a UPC when there is no EAN', () => {
    const v = canGather({ manufacturerSku: 'LR200', upc: '012345678905' });
    expect(v.ok && v.searchOn).toEqual({ mpn: 'LR200', gtin: '012345678905', gtinKind: 'UPC', brand: null });
  });

  /** The refusal the business asked for, and the reason it gives has to be actionable. */
  it('refuses without a manufacturer SKU, and says which piece is missing', () => {
    const v = canGather({ ean: '4211125641252' });
    expect(v.ok).toBe(false);
    expect(!v.ok && v.missing).toEqual(['manufacturer SKU']);
    expect(!v.ok && v.reason).toContain('manufacturer SKU');
  });

  it('refuses without any barcode', () => {
    const v = canGather({ manufacturerSku: 'LR200' });
    expect(!v.ok && v.missing).toEqual(['EAN or UPC']);
  });

  it('refuses with neither, rather than trying the title', () => {
    const v = canGather({ title: 'Beurer LR200 Air Purifier' });
    expect(!v.ok && v.missing).toEqual(['manufacturer SKU', 'EAN or UPC']);
  });

  it('treats whitespace as absent', () => {
    expect(canGather({ manufacturerSku: '   ', ean: '4211125641252' }).ok).toBe(false);
  });
});

describe('matchFieldToAspect', () => {
  it('matches across casing, spacing and underscores', () => {
    expect(matchFieldToAspect('wattage', ASPECTS)).toBe('Wattage');
    expect(matchFieldToAspect('WATTAGE', ASPECTS)).toBe('Wattage');
    expect(matchFieldToAspect('item_weight', ['Item Weight'])).toBe('Item Weight');
  });

  /** Amazon writes `color`; eBay asks for "Colour". Same field, two dictionaries. */
  it('matches British and American spelling of a field name', () => {
    expect(matchFieldToAspect('color', ASPECTS)).toBe('Colour');
  });

  it('answers nothing rather than guessing', () => {
    expect(matchFieldToAspect('warranty_description', ASPECTS)).toBeNull();
    expect(matchFieldToAspect('', ASPECTS)).toBeNull();
  });

  /** Ambiguity attaches to nothing, exactly as SKU matching does. */
  it('refuses a field that matches two aspects', () => {
    expect(matchFieldToAspect('colour', ['Colour', 'Color'])).toBeNull();
  });

  /**
   * The real catalogue case. Exact matching alone found one field of a dozen on a pair of
   * earphones, because Amazon and eBay ask the same questions in different words.
   */
  describe('the alias list', () => {
    const HEADPHONES = ['Brand', 'Type', 'Connectivity', 'Features', 'Earpiece Design', 'Colour'];

    it('connects what Amazon calls a thing to what eBay calls it', () => {
      expect(matchFieldToAspect('connectivity_technology', HEADPHONES)).toBe('Connectivity');
      expect(matchFieldToAspect('headphones_form_factor', HEADPHONES)).toBe('Earpiece Design');
      expect(matchFieldToAspect('special_feature', HEADPHONES)).toBe('Features');
      expect(matchFieldToAspect('item_type_name', HEADPHONES)).toBe('Type');
    });

    it('covers the kitchen fields that make up most of the catalogue', () => {
      const KITCHEN = ['Capacity', 'Wattage', 'Material', 'Item Weight', 'Set Includes', 'Power Source'];
      expect(matchFieldToAspect('item_volume', KITCHEN)).toBe('Capacity');
      expect(matchFieldToAspect('power_consumption', KITCHEN)).toBe('Wattage');
      expect(matchFieldToAspect('material_composition', KITCHEN)).toBe('Material');
      expect(matchFieldToAspect('net_weight', KITCHEN)).toBe('Item Weight');
      expect(matchFieldToAspect('included_components', KITCHEN)).toBe('Set Includes');
    });

    /** An exact match is still the better answer and must not be stolen by somebody's alias. */
    it('prefers an exact match over an alias', () => {
      expect(matchFieldToAspect('power', ['Power', 'Wattage'])).toBe('Power');
    });

    it('still refuses when an alias would reach two aspects', () => {
      expect(matchFieldToAspect('weight', ['Item Weight', 'Itemweight'])).toBeNull();
    });

    /** Unlisted stays unlisted. The list is the whole permission to map a name. */
    it('does not invent a mapping for a name nobody listed', () => {
      expect(matchFieldToAspect('blade_edge_geometry', ['Blade Material', 'Type'])).toBeNull();
    });
  });
});

describe('foldFindings', () => {
  it('takes the manufacturer at its word and makes it publishable', () => {
    const out = foldFindings({}, [found('manufacturer', 'Wattage', '1200 W')], ASPECTS, AT);
    expect(out.touched).toEqual([{ name: 'Wattage', value: '1200 W', basis: 'authoritative', changed: true }]);
    expect(isPayloadEligible(out.records.Wattage)).toBe(true);
  });

  it('accepts two marketplaces agreeing, in the better source-s spelling', () => {
    const out = foldFindings({}, [
      found('ebay', 'Wattage', '1200 watts'),
      found('amazon', 'wattage', '1200 W'),
    ], ASPECTS, AT);
    // Amazon outranks eBay, so its spelling is the one stored — though both vouch for the value.
    expect(out.records.Wattage.value).toBe('1200 W');
    expect(classifyAspect(out.records.Wattage)).toBe('agreement');
  });

  /** The whole point of the holding-back: stored, visible, and not sent. */
  it('keeps a single marketplace claim as a suggestion and withholds it', () => {
    const out = foldFindings({}, [found('amazon', 'Wattage', '1200 W')], ASPECTS, AT);
    expect(out.records.Wattage.value).toBe('1200 W');
    expect(classifyAspect(out.records.Wattage)).toBe('unconfirmed');
    expect(isPayloadEligible(out.records.Wattage)).toBe(false);
  });

  it('records the losing answer too, so a disagreement can be seen', () => {
    const out = foldFindings({}, [
      found('amazon', 'Wattage', '1200 W'),
      found('ebay', 'Wattage', '1500 W'),
    ], ASPECTS, AT);
    expect(out.records.Wattage.origins.map((o) => o.value)).toEqual(['1200 W', '1500 W']);
    expect(classifyAspect(out.records.Wattage)).toBe('conflict');
    expect(isPayloadEligible(out.records.Wattage)).toBe(false);
  });

  it('lets the manufacturer settle an argument between the marketplaces', () => {
    const out = foldFindings({}, [
      found('amazon', 'Wattage', '1200 W'),
      found('ebay', 'Wattage', '1200 W'),
      found('manufacturer', 'Wattage', '1500 W'),
    ], ASPECTS, AT);
    expect(out.records.Wattage.value).toBe('1500 W');
    expect(classifyAspect(out.records.Wattage)).toBe('authoritative');
  });

  describe('never overwriting a person', () => {
    const typed: Record<string, AspectRecord> = {
      Wattage: { value: '900 W', origins: [{ kind: 'user', value: '900 W' }] },
    };

    it('leaves the value alone and files the evidence beside it', () => {
      const out = foldFindings(typed, [found('manufacturer', 'Wattage', '1200 W')], ASPECTS, AT);
      expect(out.records.Wattage.value).toBe('900 W');
      expect(out.records.Wattage.origins.map((o) => `${o.kind}:${o.value}`))
        .toEqual(['user:900 W', 'manufacturer:1200 W']);
      expect(out.touched).toEqual([{ name: 'Wattage', value: '900 W', basis: 'user', changed: false }]);
    });

    it('leaves a confirmed suggestion alone too', () => {
      const confirmed: Record<string, AspectRecord> = {
        Wattage: { value: '900 W', origins: [{ kind: 'amazon', value: '900 W' }], verifiedAt: AT },
      };
      const out = foldFindings(confirmed, [found('manufacturer', 'Wattage', '1200 W')], ASPECTS, AT);
      expect(out.records.Wattage.value).toBe('900 W');
      expect(out.records.Wattage.verifiedAt).toBe(AT);
    });
  });

  it('replaces an unsettled suggestion when better evidence turns up', () => {
    const suggested: Record<string, AspectRecord> = {
      Wattage: { value: '1500 W', origins: [{ kind: 'ebay', value: '1500 W' }] },
    };
    const out = foldFindings(suggested, [found('manufacturer', 'Wattage', '1200 W')], ASPECTS, AT);
    expect(out.records.Wattage.value).toBe('1200 W');
    expect(out.touched[0].changed).toBe(true);
  });

  /**
   * The production bug, pinned. Two independent shops stating the same value were merged into one
   * origin because the merge compared `kind` alone, and every website shares the kind `web` — so
   * research on a Casio found three shops behind several fields and still reported nothing usable.
   */
  it('keeps two different websites stating the same value as two sources, and calls it agreement', () => {
    const shop = (host: string, value: string): SourceFinding => ({ kind: 'web', field: 'Movement', value, url: `https://www.${host}/p` });
    const out = foldFindings({}, [shop('timeshop24.com', 'Quartz'), shop('mastersintime.com', 'Quartz')], ['Movement'], AT);
    expect(out.records.Movement.origins).toHaveLength(2);
    expect(classifyAspect(out.records.Movement)).toBe('agreement');
    expect(isPayloadEligible(out.records.Movement)).toBe(true);
  });

  it('still collapses the SAME website repeating itself, which is one source', () => {
    const page = (path: string): SourceFinding => ({ kind: 'web', field: 'Movement', value: 'Quartz', url: `https://www.timeshop24.com/${path}` });
    const out = foldFindings({}, [page('a'), page('b')], ['Movement'], AT);
    expect(out.records.Movement.origins).toHaveLength(1);
    expect(classifyAspect(out.records.Movement)).toBe('unconfirmed');
  });

  it('does not stack an identical origin when the gather is run again', () => {
    const once = foldFindings({}, [found('amazon', 'Wattage', '1200 W')], ASPECTS, AT);
    const twice = foldFindings(once.records, [found('amazon', 'wattage', '1200 watts')], ASPECTS, AT);
    expect(twice.records.Wattage.origins).toHaveLength(1);
  });

  it('does keep the same source changing its mind', () => {
    const once = foldFindings({}, [found('amazon', 'Wattage', '1200 W')], ASPECTS, AT);
    const twice = foldFindings(once.records, [found('amazon', 'Wattage', '1500 W')], ASPECTS, AT);
    expect(twice.records.Wattage.origins).toHaveLength(2);
  });

  describe('what it refuses to write', () => {
    it('leaves an empty finding empty rather than storing a blank', () => {
      const out = foldFindings({}, [found('manufacturer', 'Wattage', '   ')], ASPECTS, AT);
      expect(out.records).toEqual({});
      expect(out.touched).toEqual([]);
    });

    it('reports a finding that answers no aspect instead of forcing it somewhere', () => {
      const out = foldFindings({}, [found('amazon', 'warranty_description', '2 years')], ASPECTS, AT);
      expect(out.records).toEqual({});
      expect(out.ignored).toEqual([
        { field: 'warranty_description', value: '2 years', why: 'this category has no item specific by that name' },
      ]);
    });

    /**
     * The Panasonic that came back as Marley. Identity checking catches the source now, but Brand
     * was never the gather's to write in the first place.
     */
    it('refuses to write Brand, MPN or Model, which the product answers itself', () => {
      const out = foldFindings({}, [
        found('amazon', 'brand', 'Marley'),
        found('amazon', 'mpn', 'EM-JE060-SB'),
        found('amazon', 'Model', 'Smile Jamaica'),
        found('amazon', 'Colour', 'Black'),
      ], ['Brand', 'MPN', 'Model', 'Colour'], AT);

      expect(Object.keys(out.records)).toEqual(['Colour']);
      expect(out.ignored.map((i) => i.field)).toEqual(['brand', 'mpn', 'Model']);
      expect(out.ignored[0].why).toContain('the product itself');
    });

    it('leaves aspects no source mentioned untouched', () => {
      const out = foldFindings({}, [found('manufacturer', 'Wattage', '1200 W')], ASPECTS, AT);
      expect(Object.keys(out.records)).toEqual(['Wattage']);
    });
  });
});

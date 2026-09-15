import { describe, expect, it } from 'vitest';
import {
  descriptionStore, groupSpecs, normaliseExtras, resolveGlance, withDescriptionStore,
} from './description-extras';

describe('descriptionStore', () => {
  it('reads the store words out of the integration config', () => {
    const store = descriptionStore({
      sellerId: 'x',
      ebayDescriptionStore: {
        storeName: 'TogaluUK', conditionLabel: 'New · boxed', conditionNote: 'Brand new.',
        shipping: [{ label: 'Dispatch', value: 'Same day before 2 pm' }, { label: 'Returns', value: '' }],
      },
    });
    expect(store).toEqual({
      storeName: 'TogaluUK', conditionLabel: 'New · boxed', conditionNote: 'Brand new.',
      shipping: [{ label: 'Dispatch', value: 'Same day before 2 pm' }],
    });
  });

  it('reads nothing set as empty, not as an error', () => {
    expect(descriptionStore(null)).toEqual({ storeName: null, conditionLabel: null, conditionNote: null, shipping: [] });
  });

  it('keeps the rest of the config when saving', () => {
    const out = withDescriptionStore({ sellerId: 'x', ebayListingDefaults: { paymentPolicyId: '1' } }, { storeName: 'TogaluUK' });
    expect(out.sellerId).toBe('x');
    expect(out.ebayListingDefaults).toEqual({ paymentPolicyId: '1' });
    expect(descriptionStore(out).storeName).toBe('TogaluUK');
  });

  it('changes only what it is given', () => {
    const before = withDescriptionStore({}, { storeName: 'TogaluUK', conditionNote: 'Brand new.' });
    const after = withDescriptionStore(before, { conditionNote: 'Sealed.' });
    expect(descriptionStore(after)).toMatchObject({ storeName: 'TogaluUK', conditionNote: 'Sealed.' });
  });
});

describe('normaliseExtras', () => {
  it('keeps complete entries and drops half-written ones', () => {
    const x = normaliseExtras({
      series: '  Casio Vintage series ',
      faq: [{ q: 'Adjustable?', a: 'Yes.' }, { q: 'Battery?', a: '' }],
      glance: [{ aspect: 'Case Size', label: 'Case width', value: '33.2 mm' }, { aspect: 'Case Size', label: '', value: '8 mm' }],
      groups: { Movement: 'Movement & display', Display: '' },
    });
    expect(x.series).toBe('Casio Vintage series');
    expect(x.faq).toHaveLength(1);
    expect(x.glance).toHaveLength(1);
    expect(x.groups).toEqual({ Movement: 'Movement & display' });
  });

  it('reads garbage as empty', () => {
    expect(normaliseExtras('nonsense')).toEqual({ series: null, inTheBox: null, care: null, faq: [], glance: [], groups: {} });
  });

  it('caps the at-a-glance strip at four and the questions at six', () => {
    const x = normaliseExtras({
      glance: Array.from({ length: 9 }, (_, i) => ({ aspect: `A${i}`, label: `L${i}`, value: `${i}` })),
      faq: Array.from({ length: 9 }, (_, i) => ({ q: `Q${i}`, a: 'A' })),
    });
    expect(x.glance).toHaveLength(4);
    expect(x.faq).toHaveLength(6);
  });
});

describe('resolveGlance', () => {
  const verified = { 'Case Size': '33.2 mm wide, 8.2 mm thick', 'Water Resistance': '30 m (3 ATM)' };

  it('shows a figure taken from a verified value', () => {
    expect(resolveGlance([{ aspect: 'Case Size', label: 'Case width', value: '33.2 mm' }], verified))
      .toEqual([{ label: 'Case width', value: '33.2 mm' }]);
  });

  /** The strip may shorten a checked fact, never state a new one. */
  it('drops a figure the verified value does not contain', () => {
    expect(resolveGlance([{ aspect: 'Water Resistance', label: 'Water resistant', value: '5 ATM' }], verified)).toEqual([]);
  });

  it('drops a figure whose item specific is not verified', () => {
    expect(resolveGlance([{ aspect: 'Warranty', label: 'Warranty', value: '2 years' }], verified)).toEqual([]);
  });

  it('matches the item specific name regardless of case', () => {
    expect(resolveGlance([{ aspect: 'water resistance', label: 'Water resistant', value: '3 atm' }], verified))
      .toEqual([{ label: 'Water resistant', value: '3 atm' }]);
  });
});

describe('groupSpecs', () => {
  it('leads General with Brand and MPN, then follows the groups research named', () => {
    const out = groupSpecs(
      { brand: 'Casio', mpn: 'A158WEA-9EF' },
      { Style: 'Retro', Movement: 'Quartz', Display: 'Digital', 'Case Size': '33.2 mm' },
      { Movement: 'Movement & display', Display: 'Movement & display', 'Case Size': 'Case & bracelet' },
    );
    expect(out.map((g) => g.name)).toEqual(['General', 'Movement & display', 'Case & bracelet']);
    expect(out[0].rows.map((r) => r.label)).toEqual(['Brand', 'MPN', 'Style']);
    expect(out[1].rows.map((r) => r.label)).toEqual(['Movement', 'Display']);
  });

  it('puts anything without a group under General', () => {
    expect(groupSpecs({}, { Colour: 'Black' }, {})).toEqual([{ name: 'General', rows: [{ label: 'Colour', value: 'Black' }] }]);
  });

  it('never lists Brand or MPN twice', () => {
    const out = groupSpecs({ brand: 'Casio', mpn: 'X1' }, { Brand: 'Casio', MPN: 'X1' }, {});
    expect(out[0].rows).toHaveLength(2);
  });

  it('merges groups that differ only in case', () => {
    const out = groupSpecs({}, { A: '1', B: '2' }, { A: 'Power', B: 'power' });
    expect(out.map((g) => g.name)).toEqual(['Power']);
  });

  /** Grouping reorders the table; it cannot add to it. */
  it('shows only the values it was given', () => {
    const out = groupSpecs({}, { Colour: 'Black' }, { Colour: 'Look', Warranty: 'Care' });
    expect(out.flatMap((g) => g.rows)).toEqual([{ label: 'Colour', value: 'Black' }]);
  });
});

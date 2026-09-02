import { describe, expect, it } from 'vitest';
import { diffRecords, renderValue, summariseChanges } from './diff';

/**
 * A change log is only worth reading if it is both complete and quiet.
 *
 * Miss a real change and the log lies about what happened. Report one that did not happen and
 * every save logs a wall of noise, nobody reads it, and it may as well not exist. Most of the
 * risk is in the second kind: Prisma returns Decimals, Dates and numbers for fields a form
 * submits as strings, so naive equality reports "12.50 -> 12.5" as an edit.
 */
describe('renderValue', () => {
  it('treats the same number written differently as the same value', () => {
    expect(renderValue('12.50')).toBe(renderValue(12.5));
    expect(renderValue('0100')).toBe(renderValue(100));
    expect(renderValue(' 7 ')).toBe(renderValue(7));
  });

  it('treats blank, whitespace and null as "not set"', () => {
    // A form posts "" for a field the user cleared; the database holds null. Same meaning.
    expect(renderValue('')).toBeNull();
    expect(renderValue('   ')).toBeNull();
    expect(renderValue(null)).toBeNull();
    expect(renderValue(undefined)).toBeNull();
  });

  it('keeps text that merely looks numeric intact', () => {
    // An EAN with a leading zero is not a number — normalising it would corrupt the display and
    // report a change on a value nobody touched.
    expect(renderValue('SKU-007')).toBe('SKU-007');
    expect(renderValue('1.2.3')).toBe('1.2.3');
    expect(renderValue('12-34')).toBe('12-34');
  });

  it('renders an empty array as not-set, and a filled one readably', () => {
    expect(renderValue([])).toBeNull();
    expect(renderValue(['Cordless', '2 speeds'])).toBe('Cordless | 2 speeds');
  });
});

describe('diffRecords', () => {
  it('reports only what actually changed', () => {
    const before = { title: 'Kettle', ean: '5012345678900', purchaseCostAmount: 12.5 };
    const after = { title: 'Kettle 1.7L', ean: '5012345678900', purchaseCostAmount: 12.5 };
    const d = diffRecords(before, after);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: 'title', from: 'Kettle', to: 'Kettle 1.7L' });
  });

  it('stays silent when a save changes nothing', () => {
    // Opening a product and pressing Save must not produce a history entry. This is the single
    // most important behaviour: a log that records non-events buries the real ones.
    const row = { title: 'Kettle', purchaseCostAmount: 12.5, ean: '5012345678900' };
    expect(diffRecords(row, { ...row })).toEqual([]);
    // Same values, arriving as strings from a form.
    expect(diffRecords(row, { title: 'Kettle', purchaseCostAmount: '12.50', ean: '5012345678900' })).toEqual([]);
  });

  it('catches the mistake this feature exists to catch', () => {
    // A mistyped cost — the decimal point lost.
    const d = diffRecords({ purchaseCostAmount: 12.5 }, { purchaseCostAmount: 1250 }, { labels: { purchaseCostAmount: 'Purchase cost' } });
    expect(d).toEqual([{ field: 'purchaseCostAmount', label: 'Purchase cost', from: '12.5', to: '1250' }]);
  });

  it('never reports a field the update did not touch', () => {
    // A partial update carries only the fields the caller set. Treating an absent key as "cleared"
    // would invent a deletion of every untouched column on every edit.
    const before = { title: 'Kettle', ean: '5012345678900', brandId: 'b1' };
    expect(diffRecords(before, { title: 'Kettle 1.7L' })).toHaveLength(1);
  });

  it('shows a reference as its name, not its uuid', () => {
    // "brandId changed from 3f2a… to 9c14…" tells a reader nothing.
    const d = diffRecords(
      { brandId: 'uuid-remington' },
      { brandId: 'uuid-bosch' },
      { labels: { brandId: 'Brand' }, resolve: { brandId: (id) => ({ 'uuid-remington': 'Remington', 'uuid-bosch': 'Bosch' })[id] } },
    );
    expect(d[0]).toMatchObject({ label: 'Brand', from: 'Remington', to: 'Bosch' });
  });

  it('falls back to the id when a reference can no longer be resolved', () => {
    // The brand may have been deleted since. Dropping the change would hide a real edit.
    const d = diffRecords({ brandId: 'gone' }, { brandId: 'also-gone' }, { resolve: { brandId: () => undefined } });
    expect(d[0]).toMatchObject({ from: 'gone', to: 'also-gone' });
  });

  it('records setting a field, and clearing one', () => {
    expect(diffRecords({ ean: null }, { ean: '5012345678900' })[0]).toMatchObject({ from: null, to: '5012345678900' });
    expect(diffRecords({ ean: '5012345678900' }, { ean: '' })[0]).toMatchObject({ from: '5012345678900', to: null });
  });

  it('leaves out the bookkeeping columns that change on every write', () => {
    const d = diffRecords(
      { title: 'A', updatedAt: new Date('2026-01-01'), updatedById: 'u1' },
      { title: 'A', updatedAt: new Date('2026-09-02'), updatedById: 'u2' },
    );
    expect(d).toEqual([]);
  });

  it('treats a create — no previous version — as every field being set', () => {
    const d = diffRecords(null, { title: 'Kettle', ean: null });
    expect(d).toEqual([{ field: 'title', label: 'title', from: null, to: 'Kettle' }]);
  });
});

describe('summariseChanges', () => {
  it('names the fields when there are few, and counts when there are many', () => {
    expect(summariseChanges([])).toBe('No fields changed');
    expect(summariseChanges([{ field: 'a', label: 'Title', from: null, to: 'x' }])).toBe('Title');
    expect(summariseChanges([
      { field: 'a', label: 'Title', from: null, to: 'x' },
      { field: 'b', label: 'Brand', from: null, to: 'y' },
    ])).toBe('Title and Brand');
    expect(summariseChanges([
      { field: 'a', label: 'Title', from: null, to: 'x' },
      { field: 'b', label: 'Brand', from: null, to: 'y' },
      { field: 'c', label: 'EAN', from: null, to: 'z' },
      { field: 'd', label: 'Cost', from: null, to: 'w' },
    ])).toBe('Title, Brand and 2 more');
  });
});

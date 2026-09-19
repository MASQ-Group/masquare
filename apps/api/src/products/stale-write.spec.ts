import { describe, expect, it } from 'vitest';
import { fieldsChangedUnderneath, isStaleWrite } from './stale-write';

const SAVED = new Date('2026-09-14T18:34:51.123Z');

describe('isStaleWrite', () => {
  it('lets a save through when the product is exactly as the card saw it', () => {
    expect(isStaleWrite(SAVED, '2026-09-14T18:34:51.123Z')).toBe(false);
  });

  /** The incident: research wrote the description after the card opened, and the card saved over it. */
  it('refuses a save onto a product that changed after the card opened', () => {
    expect(isStaleWrite(SAVED, '2026-09-14T17:13:57.898Z')).toBe(true);
  });

  it('notices a change of a single millisecond', () => {
    expect(isStaleWrite(SAVED, '2026-09-14T18:34:51.122Z')).toBe(true);
  });

  /** The same instant in another timezone is not a change; refusing it would block every save. */
  it('treats the same moment written in another timezone as unchanged', () => {
    expect(isStaleWrite(SAVED, '2026-09-14T21:34:51.123+03:00')).toBe(false);
  });

  /** Bulk edits and imports send no timestamp and must keep working exactly as before. */
  it('does not check a caller that did not say when it last saw the product', () => {
    expect(isStaleWrite(SAVED, undefined)).toBe(false);
    expect(isStaleWrite(SAVED, null)).toBe(false);
    expect(isStaleWrite(SAVED, '')).toBe(false);
  });

  it('does not block on an unreadable timestamp', () => {
    expect(isStaleWrite(SAVED, 'not a date')).toBe(false);
  });

  it('is safe when there is no stored timestamp to compare with', () => {
    expect(isStaleWrite(null, '2026-09-14T18:34:51.123Z')).toBe(false);
  });
});

/** Prisma hands back Decimals; anything with a numeric toString stands in for one. */
const decimal = (v: string) => ({ toString: () => v });

/** IT33248 as it stood after research wrote its eBay title at 14:09, with a card open from before. */
const STORED = {
  ebayTitle: 'Researched title', descriptionHtml: '<p>Researched</p>', keyFeatures: ['One', 'Two'],
  packageWeightKg: decimal('9'), purchaseCostAmount: decimal('97'), purchaseCostCurrency: 'EUR', title: 'Cabinet',
};

describe('fieldsChangedUnderneath', () => {
  it('lets a weight fix through when research changed only the words', () => {
    expect(fieldsChangedUnderneath(STORED, { packageWeightKg: '9.5' }, { packageWeightKg: 9 })).toEqual([]);
  });

  it('names a field the save would overwrite after someone else changed it', () => {
    expect(fieldsChangedUnderneath(STORED, { ebayTitle: 'My title', packageWeightKg: 9.5 }, { ebayTitle: null, packageWeightKg: '9.00' }))
      .toEqual(['ebayTitle']);
  });

  it('compares lists and money as stored, not as typed', () => {
    expect(fieldsChangedUnderneath(
      STORED,
      { keyFeatures: ['One', 'Two', 'Three'], purchaseCostAmount: 99, purchaseCostCurrency: 'EUR' },
      { keyFeatures: ['One', 'Two'], purchaseCostAmount: '97.00', purchaseCostCurrency: 'EUR' },
    )).toEqual([]);
  });

  it('is not a conflict when the other change was the same one', () => {
    expect(fieldsChangedUnderneath(STORED, { title: 'Cabinet' }, { title: 'Old name' })).toEqual([]);
  });

  /** An older card sends no expected values; not knowing is treated as changed, as before. */
  it('refuses what it cannot compare', () => {
    expect(fieldsChangedUnderneath(STORED, { title: 'New' }, null)).toEqual(['title']);
    expect(fieldsChangedUnderneath(STORED, { title: 'New' }, {})).toEqual(['title']);
    expect(fieldsChangedUnderneath(STORED, {}, {}, ['aliases'])).toEqual(['aliases']);
  });
});

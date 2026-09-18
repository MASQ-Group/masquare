import { describe, expect, it } from 'vitest';
import { formatReference, normalisePrefix, periodOf, periodOfReference, prefixOfReference } from './customer-reference';

const SEP = { year: 2026, month: 9 };

describe('the prefix a customer chooses', () => {
  it('is stored upper case, however it was typed', () => {
    expect(normalisePrefix('ab')).toEqual({ ok: true, prefix: 'AB' });
    expect(normalisePrefix('  Ab ')).toEqual({ ok: true, prefix: 'AB' });
  });

  it('insists on exactly two letters', () => {
    expect(normalisePrefix('A').ok).toBe(false);
    expect(normalisePrefix('ABC').ok).toBe(false);
    expect(normalisePrefix('A-').ok).toBe(false);
  });

  /** The commonest attempt, and the message says where the digits actually go. */
  it('explains itself when digits are typed into it', () => {
    const result = normalisePrefix('A1');
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('digits belong to the number');
  });

  it('refuses nothing at all', () => {
    expect(normalisePrefix('').ok).toBe(false);
    expect(normalisePrefix(null).ok).toBe(false);
  });
});

describe('the reference itself', () => {
  it('reads as the prefix, when it was filed, and a number', () => {
    expect(formatReference('CB', SEP, 1)).toBe('CB-2026-09-0001');
    expect(formatReference('CB', SEP, 2)).toBe('CB-2026-09-0002');
  });

  it('pads the month, so every reference is the same length', () => {
    expect(formatReference('CB', { year: 2027, month: 1 }, 1)).toBe('CB-2027-01-0001');
  });

  /** Padded so that a list sorted as text is also sorted as numbers. */
  it('pads the number to four digits', () => {
    expect(formatReference('AB', SEP, 999)).toBe('AB-2026-09-0999');
    expect(['AB-2026-09-0002', 'AB-2026-09-0010', 'AB-2026-09-0001'].sort())
      .toEqual(['AB-2026-09-0001', 'AB-2026-09-0002', 'AB-2026-09-0010']);
  });

  it('sorts a whole year correctly as text, which is what a list does', () => {
    const refs = ['CB-2027-01-0001', 'CB-2026-10-0003', 'CB-2026-09-0001', 'CB-2026-09-0002'];
    expect([...refs].sort()).toEqual(['CB-2026-09-0001', 'CB-2026-09-0002', 'CB-2026-10-0003', 'CB-2027-01-0001']);
  });

  it('grows past four digits rather than wrapping', () => {
    expect(formatReference('AB', SEP, 12345)).toBe('AB-2026-09-12345');
  });

  it('upper-cases a prefix handed to it in any case', () => {
    expect(formatReference('ab', SEP, 7)).toBe('AB-2026-09-0007');
  });
});

describe('periodOf', () => {
  it('reads the year and month where the business is, not where the server is', () => {
    // Midnight UTC on 1 January is already 2 a.m. in Nicosia, so both agree here.
    expect(periodOf(new Date('2027-01-01T00:00:00Z'))).toEqual({ year: 2027, month: 1 });
  });

  it('gets the turn of the year right, which UTC would not', () => {
    // 23:00 UTC on 31 December is 01:00 on 1 January in Nicosia. A shipment filed then is filed in
    // the new year by everyone who will ever look at it — and starts that year's numbering.
    const newYearInNicosia = new Date('2026-12-31T23:00:00Z');
    expect(periodOf(newYearInNicosia)).toEqual({ year: 2027, month: 1 });
    expect(periodOf(newYearInNicosia, 'UTC')).toEqual({ year: 2026, month: 12 });
  });

  it('gets the turn of a month right too', () => {
    expect(periodOf(new Date('2026-09-30T22:00:00Z'))).toEqual({ year: 2026, month: 10 });
  });
});

describe('reading a reference back', () => {
  it('names the customer it belongs to', () => {
    expect(prefixOfReference('CB-2026-09-0001')).toBe('CB');
    expect(prefixOfReference(' cb-2026-09-0001 ')).toBe('CB');
  });

  it('still reads references issued before the date was added', () => {
    // These are on real shipments and still get quoted down the telephone.
    expect(prefixOfReference('AB-0001')).toBe('AB');
    expect(prefixOfReference(' ab-12345 ')).toBe('AB');
  });

  it('does not recognise something that is not one of ours', () => {
    expect(prefixOfReference('1Z999AA10123456784')).toBeNull();
    expect(prefixOfReference('AB-1')).toBeNull();
    expect(prefixOfReference('AB-2026-9-0001')).toBeNull();
    expect(prefixOfReference(null)).toBeNull();
  });

  it('says when a reference was filed, where the reference says so', () => {
    expect(periodOfReference('CB-2026-09-0001')).toEqual({ year: 2026, month: 9 });
    expect(periodOfReference('CB-2027-01-0002')).toEqual({ year: 2027, month: 1 });
  });

  it('says nothing about when, for the older shape that does not carry it', () => {
    expect(periodOfReference('AB-0001')).toBeNull();
    expect(periodOfReference(null)).toBeNull();
  });
});

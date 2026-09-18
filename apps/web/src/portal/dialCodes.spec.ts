import { describe, expect, it } from 'vitest';
import { DIAL_CODES, dialCodeFor, joinPhone, phoneCountry, splitPhone } from './dialCodes';

describe('dialCodeFor', () => {
  it('finds the prefix for a country', () => {
    expect(dialCodeFor('CY')).toBe('357');
    expect(dialCodeFor('gb')).toBe('44');
  });

  it('answers null for nothing and for a country we do not hold', () => {
    expect(dialCodeFor(null)).toBeNull();
    expect(dialCodeFor('')).toBeNull();
    expect(dialCodeFor('ZZ')).toBeNull();
  });
});

describe('splitPhone', () => {
  it('takes the prefix off a number that has one', () => {
    expect(splitPhone('+357 99123456')).toEqual({ dial: '357', local: '99123456' });
  });

  it('takes the longest code the table knows, not the first digit that parses', () => {
    // 3 and 35 are not codes; 357 is. A shortest-first match would find nothing at all here.
    expect(splitPhone('+357 99123456').dial).toBe('357');
    expect(splitPhone('+1 2125551234').dial).toBe('1');
    // An area code inside a shared plan stays in the number: +1 is the country, 868 is not.
    expect(splitPhone('+1 8686221234')).toEqual({ dial: '1', local: '8686221234' });
  });

  it('holds no code that is a prefix of another, which is what lets a longest match be right', () => {
    const codes = [...new Set(Object.values(DIAL_CODES))];
    const clashes = codes.filter((a) => codes.some((b) => b !== a && b.startsWith(a)));
    expect(clashes).toEqual([]);
  });

  it('survives the spacing people actually type', () => {
    expect(splitPhone('+44 (0) 20 7946 0000')).toEqual({ dial: '44', local: '(0) 20 7946 0000' });
    expect(splitPhone('+306912345678')).toEqual({ dial: '30', local: '6912345678' });
  });

  it('leaves a number with no prefix whole rather than guessing a country', () => {
    expect(splitPhone('99123456')).toEqual({ dial: null, local: '99123456' });
    expect(splitPhone('00357 99123456').dial).toBeNull();
  });

  it('answers empty for nothing', () => {
    expect(splitPhone(null)).toEqual({ dial: null, local: '' });
    expect(splitPhone('   ')).toEqual({ dial: null, local: '' });
  });
});

describe('joinPhone', () => {
  it('puts a number back together', () => {
    expect(joinPhone('357', '99123456')).toBe('+357 99123456');
  });

  it('keeps a number that has no prefix', () => {
    expect(joinPhone(null, '99123456')).toBe('99123456');
  });

  it('stays empty when there is no number — a lone prefix is not a phone number', () => {
    expect(joinPhone('357', '')).toBe('');
    expect(joinPhone('357', '   ')).toBe('');
  });

  it('round-trips what it split', () => {
    const original = '+357 99123456';
    const { dial, local } = splitPhone(original);
    expect(joinPhone(dial, local)).toBe(original);
  });
});

describe('the table', () => {
  it('holds every code as digits only, with no plus', () => {
    for (const [iso, code] of Object.entries(DIAL_CODES)) {
      expect(iso, `${iso} should be an ISO alpha-2 code`).toMatch(/^[A-Z]{2}$/);
      expect(code, `${iso} → ${code}`).toMatch(/^\d{1,4}$/);
    }
  });
});

describe('phoneCountry', () => {
  const isoCodes = ['CY', 'GB', 'GR', 'JE', 'US', 'CA'];

  it('shows the country picked, even with the number still empty', () => {
    // The bug this exists for: choosing a country before typing did nothing at all, because the
    // choice was written into a value that refuses to hold a lone prefix.
    expect(phoneCountry({ valueDial: null, picked: 'GB', isoCodes })).toBe('GB');
  });

  it('lets the prefix already on the number win — that is the number', () => {
    expect(phoneCountry({ valueDial: '357', picked: 'GB', isoCodes })).toBe('CY');
  });

  it('keeps the picked country where several share a prefix', () => {
    // +44 is Britain, Jersey, Guernsey and the Isle of Man. Somebody who said Jersey meant Jersey.
    expect(phoneCountry({ valueDial: '44', picked: 'JE', isoCodes })).toBe('JE');
    expect(phoneCountry({ valueDial: '1', picked: 'CA', isoCodes })).toBe('CA');
  });

  it('falls back to where the parcel is going, before anything is chosen', () => {
    expect(phoneCountry({ valueDial: null, picked: null, addressIso: 'gr', isoCodes })).toBe('GR');
  });

  it('prefers what was picked over where the parcel is going', () => {
    expect(phoneCountry({ valueDial: null, picked: 'CY', addressIso: 'GB', isoCodes })).toBe('CY');
  });

  it('shows nothing rather than guessing, when there is nothing to go on', () => {
    expect(phoneCountry({ valueDial: null, picked: null, isoCodes })).toBeNull();
    expect(phoneCountry({ valueDial: '999', picked: null, isoCodes })).toBeNull();
  });
});

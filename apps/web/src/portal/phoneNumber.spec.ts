import { describe, expect, it } from 'vitest';
import { normalisePhone, phoneIsUsable, phoneProblem } from './phoneNumber';

describe('phoneProblem', () => {
  it('accepts real numbers, however they are spaced', () => {
    for (const number of [
      '+357 99123456',       // Cyprus mobile
      '+35799123456',
      '+357 (0) 99 123 456',
      '+44 20 7946 0000',    // London landline
      '+44 7400 123456',     // UK mobile
      '+30 691 234 5678',    // Greek mobile
      '+1 212 555 0123',     // New York
      '+49 30 901820',       // Berlin
    ]) {
      expect(phoneProblem(number), number).toBeNull();
    }
  });

  it('refuses a number that is too short for its country, and says what one looks like', () => {
    const problem = phoneProblem('+357 99');
    expect(problem).toContain('Cyprus');
    expect(problem).toMatch(/looks like \d/);
  });

  it('refuses a number that is too long for its country', () => {
    expect(phoneProblem('+357 991234567890')).not.toBeNull();
  });

  it('refuses digits that are not a number anywhere', () => {
    expect(phoneProblem('12345')).not.toBeNull();
    expect(phoneProblem('call me')).not.toBeNull();
  });

  it('asks for the country when the number carries no prefix and none was chosen', () => {
    expect(phoneProblem('99123456')).toContain('+357 99123456');
  });

  it('reads a local number against the country that was chosen', () => {
    expect(phoneProblem('99123456', 'CY')).toBeNull();
    // The same digits are not a valid British number.
    expect(phoneProblem('99123456', 'GB')).toContain('United Kingdom');
  });

  it('tells countries sharing a prefix apart — +44 is not one plan', () => {
    // A Jersey number is valid as Jersey and as the UK it shares +44 with; a UK mobile is not
    // magically a Cyprus number just because the digits are the right length.
    expect(phoneProblem('+44 7400 123456')).toBeNull();
    expect(phoneProblem('7400123456', 'CY')).not.toBeNull();
  });

  it('says the field is needed when it is empty', () => {
    expect(phoneProblem('')).toBe('This is needed.');
    expect(phoneProblem(null)).toBe('This is needed.');
    expect(phoneProblem('   ')).toBe('This is needed.');
  });

  it('refuses a number nobody is waiting at — a courier cannot deliver to a toll-free line', () => {
    // 0800 is the UK's toll-free range.
    const problem = phoneProblem('+44 800 1111');
    expect(problem).toContain('landline or mobile');
  });

  it('every message says what to do, not just that something is wrong', () => {
    for (const bad of ['+357 99', '12345', '99123456', '+44 800 1111']) {
      const problem = phoneProblem(bad)!;
      expect(problem, bad).toBeTruthy();
      expect(problem.length, bad).toBeGreaterThan(20);
    }
  });
});

describe('phoneIsUsable', () => {
  it('is the same answer without the reason', () => {
    expect(phoneIsUsable('+357 99123456')).toBe(true);
    expect(phoneIsUsable('+357 99')).toBe(false);
  });
});

describe('normalisePhone', () => {
  it('stores a valid number the one way every carrier takes it', () => {
    expect(normalisePhone('+357 (0) 99 123 456')).toBe('+35799123456');
    expect(normalisePhone('99123456', 'CY')).toBe('+35799123456');
  });

  it('leaves what it cannot read exactly as typed, so nothing is silently mangled', () => {
    expect(normalisePhone('call me')).toBe('call me');
    expect(normalisePhone('+357 99')).toBe('+357 99');
  });

  it('stays empty for nothing', () => {
    expect(normalisePhone('')).toBe('');
    expect(normalisePhone(null)).toBe('');
  });
});

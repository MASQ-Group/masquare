import { describe, expect, it } from 'vitest';
import { formatReference, normalisePrefix, prefixOfReference } from './customer-reference';

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
  it('reads as the prefix and a number', () => {
    expect(formatReference('AB', 1)).toBe('AB-0001');
    expect(formatReference('AB', 42)).toBe('AB-0042');
  });

  /** Padded so that a list sorted as text is also sorted as numbers. */
  it('pads to four digits', () => {
    expect(formatReference('AB', 999)).toBe('AB-0999');
    expect(['AB-0002', 'AB-0010', 'AB-0001'].sort()).toEqual(['AB-0001', 'AB-0002', 'AB-0010']);
  });

  it('grows past four digits rather than wrapping', () => {
    expect(formatReference('AB', 12345)).toBe('AB-12345');
  });

  it('upper-cases a prefix handed to it in any case', () => {
    expect(formatReference('ab', 7)).toBe('AB-0007');
  });
});

describe('reading a reference back', () => {
  it('names the customer it belongs to', () => {
    expect(prefixOfReference('AB-0001')).toBe('AB');
    expect(prefixOfReference(' ab-12345 ')).toBe('AB');
  });

  it('does not recognise something that is not one of ours', () => {
    expect(prefixOfReference('1Z999AA10123456784')).toBeNull();
    expect(prefixOfReference('AB-1')).toBeNull();
    expect(prefixOfReference(null)).toBeNull();
  });
});

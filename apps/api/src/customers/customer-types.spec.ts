import { describe, expect, it } from 'vitest';
import { CUSTOMER_TYPES, LOGISTICS, hasType, missingForTypes, normaliseTypes } from './customer-types';

describe('the catalogue', () => {
  it('knows logistics, which is what the portal is built for', () => {
    expect(CUSTOMER_TYPES.map((t) => t.key)).toContain(LOGISTICS);
  });

  it('describes every type it offers', () => {
    for (const t of CUSTOMER_TYPES) {
      expect(t.label.length, t.key).toBeGreaterThan(3);
      expect(t.description.length, t.key).toBeGreaterThan(20);
    }
  });
});

describe('the types a customer is saved with', () => {
  it('accepts a known type', () => {
    expect(normaliseTypes(['logistics'])).toEqual({ ok: true, types: ['logistics'] });
  });

  it('accepts no types at all — a customer need not take any service yet', () => {
    expect(normaliseTypes([])).toEqual({ ok: true, types: [] });
    expect(normaliseTypes(undefined)).toEqual({ ok: true, types: [] });
  });

  it('keeps each type once, however often it is sent', () => {
    expect(normaliseTypes(['logistics', ' logistics ', 'logistics'])).toEqual({ ok: true, types: ['logistics'] });
  });

  /** Dropping it silently would save a customer without the service somebody meant to give them. */
  it('refuses a type it does not know, and names it', () => {
    const result = normaliseTypes(['logistics', 'wholesale']);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('wholesale');
  });

  it('refuses something that is not a list', () => {
    expect(normaliseTypes('logistics').ok).toBe(false);
  });
});

describe('what each type requires', () => {
  it('asks a logistics customer for a reference prefix', () => {
    expect(missingForTypes(['logistics'], { referencePrefix: '' })).toHaveLength(1);
    expect(missingForTypes(['logistics'], { referencePrefix: 'AB' })).toEqual([]);
  });

  /** The point of types: a plain customer carries no fields that only one service needs. */
  it('asks a customer of no particular type for nothing', () => {
    expect(missingForTypes([], {})).toEqual([]);
  });
});

describe('hasType', () => {
  it('reads whether a customer takes a service', () => {
    expect(hasType({ types: ['logistics'] }, LOGISTICS)).toBe(true);
    expect(hasType({ types: [] }, LOGISTICS)).toBe(false);
  });

  it('says no for a customer it cannot see', () => {
    expect(hasType(null, LOGISTICS)).toBe(false);
    expect(hasType({ types: null }, LOGISTICS)).toBe(false);
  });
});

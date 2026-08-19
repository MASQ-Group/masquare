import { describe, expect, it } from 'vitest';
import { medianCents } from './median';

describe('medianCents', () => {
  it('returns null for an empty set', () => {
    expect(medianCents([])).toBeNull();
  });

  it('returns the single value for a one-element set', () => {
    expect(medianCents([1499])).toBe(1499);
  });

  it('takes the middle of an odd-length set (order-independent)', () => {
    expect(medianCents([300, 100, 200])).toBe(200);
    expect(medianCents([100, 200, 300])).toBe(200);
  });

  it('averages the two middle values of an even-length set', () => {
    expect(medianCents([100, 200, 300, 400])).toBe(250);
  });

  it('rounds a non-integer even-length average to the nearest cent', () => {
    // (100 + 105) / 2 = 102.5 → 103
    expect(medianCents([100, 105])).toBe(103);
  });

  it('is unaffected by input order and does not mutate the input', () => {
    const input = [500, 100, 400, 200, 300];
    expect(medianCents(input)).toBe(300);
    expect(input).toEqual([500, 100, 400, 200, 300]);
  });

  it('handles duplicate values', () => {
    expect(medianCents([100, 100, 100, 100])).toBe(100);
  });
});

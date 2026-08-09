import { describe, expect, it } from 'vitest';
import { computeFairCeilingCents } from './fair-ceiling';

const MULT = 1.1; // REPRICING_DEFAULTS.fairPricingCeilingMultiplier

describe('computeFairCeilingCents', () => {
  it('is null without a reference median (only the business max then clamps)', () => {
    expect(computeFairCeilingCents(null, 3000, MULT)).toBeNull();
    expect(computeFairCeilingCents(undefined, 3000, MULT)).toBeNull();
  });

  it('is referenceMedian × multiplier when below the business max', () => {
    // 2000 × 1.1 = 2200 < 3000 max → 2200.
    expect(computeFairCeilingCents(2000, 3000, MULT)).toBe(2200);
  });

  it('is capped at the business max when the reference would exceed it', () => {
    // 2900 × 1.1 = 3190, capped at 3000.
    expect(computeFairCeilingCents(2900, 3000, MULT)).toBe(3000);
  });

  it('falls back to reference × multiplier when there is no business max', () => {
    expect(computeFairCeilingCents(2000, null, MULT)).toBe(2200);
  });

  it('rounds to the nearest cent', () => {
    // 1999 × 1.1 = 2198.9 → 2199.
    expect(computeFairCeilingCents(1999, null, MULT)).toBe(2199);
  });
});

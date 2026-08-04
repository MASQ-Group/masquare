import { describe, it, expect } from 'vitest';
import { shouldEmit, EmitParams } from './emit';

const P: EmitParams = { epsilonCents: 10, epsilonPct: 0.005, cooldownSeconds: 300 };
const T0 = 1_000_000_000_000;

describe('shouldEmit', () => {
  it('emits a meaningful change outside the cooldown', () => {
    expect(shouldEmit({ newPriceCents: 2100, currentPriceCents: 2000, lastSubmissionAtMs: T0 - 400_000, nowMs: T0 }, P)).toEqual({ emit: true });
  });

  it('skips a sub-epsilon change (absolute floor 10c)', () => {
    const d = shouldEmit({ newPriceCents: 2007, currentPriceCents: 2000, lastSubmissionAtMs: null, nowMs: T0 }, P);
    expect(d).toEqual({ emit: false, skip: 'EPSILON' });
  });

  it('uses the percentage epsilon when larger than the cents floor', () => {
    // 0.5% of 10000 = 50c; a 30c change is sub-epsilon.
    const d = shouldEmit({ newPriceCents: 10030, currentPriceCents: 10000, lastSubmissionAtMs: null, nowMs: T0 }, P);
    expect(d).toEqual({ emit: false, skip: 'EPSILON' });
  });

  it('skips inside the cooldown window', () => {
    const d = shouldEmit({ newPriceCents: 2200, currentPriceCents: 2000, lastSubmissionAtMs: T0 - 100_000, nowMs: T0 }, P);
    expect(d).toEqual({ emit: false, skip: 'COOLDOWN' });
  });

  it('overrides the cooldown for a safety event (PRICING_HEALTH / floor breach)', () => {
    const d = shouldEmit({ newPriceCents: 2200, currentPriceCents: 2000, lastSubmissionAtMs: T0 - 100_000, nowMs: T0, safetyOverride: true }, P);
    expect(d).toEqual({ emit: true });
  });

  it('epsilon takes precedence over cooldown-override (still sub-epsilon = skip)', () => {
    const d = shouldEmit({ newPriceCents: 2005, currentPriceCents: 2000, lastSubmissionAtMs: T0 - 100_000, nowMs: T0, safetyOverride: true }, P);
    expect(d).toEqual({ emit: false, skip: 'EPSILON' });
  });

  it('emits when there is no current price to compare (first price)', () => {
    expect(shouldEmit({ newPriceCents: 2000, currentPriceCents: null, lastSubmissionAtMs: null, nowMs: T0 }, P)).toEqual({ emit: true });
  });
});

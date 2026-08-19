import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REFERRAL_SCHEDULE,
  assertValidSchedule,
  referralScheduleFor,
} from './referral-schedule';
import { ReferralBracket } from '../floor/floor-solver';

const MAX = Number.MAX_SAFE_INTEGER;

describe('referral schedule', () => {
  it('the default schedule is well-formed', () => {
    expect(() => assertValidSchedule(DEFAULT_REFERRAL_SCHEDULE)).not.toThrow();
  });

  it('falls back to the default for unknown / null category keys', () => {
    expect(referralScheduleFor(null)).toBe(DEFAULT_REFERRAL_SCHEDULE);
    expect(referralScheduleFor('does-not-exist')).toBe(DEFAULT_REFERRAL_SCHEDULE);
  });

  it('accepts a valid contiguous tiered schedule', () => {
    const tiered: ReferralBracket[] = [
      { minCents: 1, maxCents: 1500, pct: 0.05 },
      { minCents: 1501, maxCents: 2000, pct: 0.1 },
      { minCents: 2001, maxCents: MAX, pct: 0.15 },
    ];
    expect(() => assertValidSchedule(tiered)).not.toThrow();
  });

  it.each([
    ['empty', []],
    ['does not start at 1', [{ minCents: 2, maxCents: MAX, pct: 0.15 }]],
    ['has a gap', [
      { minCents: 1, maxCents: 1500, pct: 0.05 },
      { minCents: 1600, maxCents: MAX, pct: 0.15 }, // gap 1501–1599
    ]],
    ['does not cover the top', [{ minCents: 1, maxCents: 5000, pct: 0.15 }]],
    ['pct out of range', [{ minCents: 1, maxCents: MAX, pct: 1.5 }]],
    ['min > max', [{ minCents: 1, maxCents: MAX, pct: 0.15 }, { minCents: 5000, maxCents: 4000, pct: 0.2 }]],
  ])('rejects a malformed schedule: %s', (_label, schedule) => {
    expect(() => assertValidSchedule(schedule as ReferralBracket[])).toThrow();
  });
});

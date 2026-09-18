import { describe, expect, it } from 'vitest';
import { PUSH_MAX_ATTEMPTS, RECHECK_AFTER_HOURS, dueForRecheck, recheckCutoff } from './push-queue-recheck';

const NOW = new Date('2026-09-19T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe('dueForRecheck', () => {
  it('says nothing about a row the drain still takes normally', () => {
    // Under the limit is the ordinary path's business, not this one's.
    expect(dueForRecheck({ attempts: 0, lastAttemptAt: hoursAgo(100) }, NOW)).toBe(false);
    expect(dueForRecheck({ attempts: PUSH_MAX_ATTEMPTS - 1, lastAttemptAt: hoursAgo(100) }, NOW)).toBe(false);
  });

  it('brings back an abandoned row once a day has passed', () => {
    // The seven rows abandoned on 11 September, holding an error that stopped being true on the
    // 15th, would come back on the next drain.
    expect(dueForRecheck({ attempts: PUSH_MAX_ATTEMPTS, lastAttemptAt: hoursAgo(RECHECK_AFTER_HOURS + 1) }, NOW)).toBe(true);
    expect(dueForRecheck({ attempts: 9, lastAttemptAt: hoursAgo(24 * 7) }, NOW)).toBe(true);
  });

  it('leaves it alone until then, so a broken product is not hammering a marketplace', () => {
    expect(dueForRecheck({ attempts: PUSH_MAX_ATTEMPTS, lastAttemptAt: hoursAgo(1) }, NOW)).toBe(false);
    expect(dueForRecheck({ attempts: PUSH_MAX_ATTEMPTS, lastAttemptAt: hoursAgo(RECHECK_AFTER_HOURS - 1) }, NOW)).toBe(false);
  });

  it('is due exactly on the boundary rather than a moment after', () => {
    expect(dueForRecheck({ attempts: PUSH_MAX_ATTEMPTS, lastAttemptAt: recheckCutoff(NOW) }, NOW)).toBe(true);
  });

  it('treats a missing timestamp as due — the attempts say it was tried, so that is a gap', () => {
    expect(dueForRecheck({ attempts: PUSH_MAX_ATTEMPTS, lastAttemptAt: null }, NOW)).toBe(true);
    expect(dueForRecheck({ attempts: PUSH_MAX_ATTEMPTS }, NOW)).toBe(true);
  });

  it('reads a timestamp that arrived as a string', () => {
    expect(dueForRecheck({ attempts: PUSH_MAX_ATTEMPTS, lastAttemptAt: hoursAgo(48).toISOString() }, NOW)).toBe(true);
  });
});

describe('recheckCutoff', () => {
  it('is a day back', () => {
    expect(recheckCutoff(NOW).toISOString()).toBe('2026-09-18T12:00:00.000Z');
  });
});

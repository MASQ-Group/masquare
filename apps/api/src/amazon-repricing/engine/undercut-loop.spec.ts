import { describe, expect, it } from 'vitest';
import { detectUndercutLoop, UndercutEvent } from './undercut-loop';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = 1_000_000_000_000;

// Defaults mirroring REPRICING_DEFAULTS (§9-#9): 3 undercuts / 60 min, resume after 6 h quiet.
const OPTS = { count: 3, windowMs: 60 * MIN, quietMs: 6 * HOUR, nowMs: NOW };

/** N undercuts by one seller, spaced `gapMs` apart, the most recent `lastAgoMs` before now. */
function burst(sellerId: string, n: number, gapMs: number, lastAgoMs: number): UndercutEvent[] {
  return Array.from({ length: n }, (_, i) => ({ sellerId, atMs: NOW - lastAgoMs - (n - 1 - i) * gapMs }));
}

describe('detectUndercutLoop', () => {
  it('does not hold with no events', () => {
    expect(detectUndercutLoop([], OPTS)).toEqual({ hold: false, offenderSellerId: null, offenderCount: 0 });
  });

  it('does not hold below the threshold (2 undercuts, need 3)', () => {
    const res = detectUndercutLoop(burst('C1', 2, 10 * MIN, 1 * MIN), OPTS);
    expect(res.hold).toBe(false);
    expect(res.offenderSellerId).toBeNull();
  });

  it('holds when one seller undercuts >= 3 times inside the window', () => {
    const res = detectUndercutLoop(burst('C1', 3, 15 * MIN, 1 * MIN), OPTS);
    expect(res).toEqual({ hold: true, offenderSellerId: 'C1', offenderCount: 3 });
  });

  it('does not count undercuts spread beyond the burst window', () => {
    // 3 undercuts but 40 min apart → only 2 fall inside any 60-min window ending at the last.
    const res = detectUndercutLoop(burst('C1', 3, 40 * MIN, 1 * MIN), OPTS);
    expect(res.hold).toBe(false);
  });

  it('resumes (no hold) once the offender has been quiet longer than quietMs', () => {
    // A clear 3-undercut burst, but the most recent was 7 h ago (> 6 h quiet) → loop exhausted.
    const res = detectUndercutLoop(burst('C1', 3, 10 * MIN, 7 * HOUR), OPTS);
    expect(res.hold).toBe(false);
    // Still surfaced as the offender so ops can act on the repeat behaviour.
    expect(res.offenderSellerId).toBe('C1');
    expect(res.offenderCount).toBe(3);
  });

  it('does not conflate undercuts from different sellers', () => {
    const events = [...burst('C1', 2, 10 * MIN, 1 * MIN), ...burst('C2', 2, 10 * MIN, 2 * MIN)];
    expect(detectUndercutLoop(events, OPTS).hold).toBe(false);
  });

  it('picks the worst offender when several loop', () => {
    const events = [...burst('C1', 3, 10 * MIN, 1 * MIN), ...burst('C2', 5, 5 * MIN, 2 * MIN)];
    const res = detectUndercutLoop(events, OPTS);
    expect(res.hold).toBe(true);
    expect(res.offenderSellerId).toBe('C2');
    expect(res.offenderCount).toBe(5);
  });

  it('ignores events in the future relative to now', () => {
    const events = [...burst('C1', 3, 10 * MIN, 1 * MIN), { sellerId: 'C1', atMs: NOW + HOUR }];
    const res = detectUndercutLoop(events, OPTS);
    expect(res.offenderCount).toBe(3);
  });
});

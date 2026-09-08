import { describe, expect, it } from 'vitest';
import {
  TRACK_BATCH_LIMIT, TRACK_MAX_FAILURES, buildTrackRequest, chunkTrackingNumbers,
  describeTrackFailure, dueForRefresh, normaliseTrackingNumbers,
  isFedexService,
} from './fedex-track';

const at = (iso: string) => new Date(iso);

describe('normaliseTrackingNumbers', () => {
  it('trims, drops blanks and keeps each number once', () => {
    expect(normaliseTrackingNumbers([' 876350374113 ', '', null, '876350374113', undefined, '875767803927']))
      .toEqual(['876350374113', '875767803927']);
  });
});

describe('chunkTrackingNumbers', () => {
  it('never exceeds FedEx\'s batch limit, however many are asked for', () => {
    const numbers = Array.from({ length: 71 }, (_, i) => `8763503741${String(i).padStart(2, '0')}`);
    const chunks = chunkTrackingNumbers(numbers);
    expect(chunks.map((c) => c.length)).toEqual([30, 30, 11]);
    expect(chunks.every((c) => c.length <= TRACK_BATCH_LIMIT)).toBe(true);
  });

  /** A caller asking for 500 per call would silently overflow the batch and lose the tail. */
  it('clamps an oversized requested size down to the limit', () => {
    const numbers = Array.from({ length: 40 }, (_, i) => `n${i}`);
    expect(chunkTrackingNumbers(numbers, 500).map((c) => c.length)).toEqual([30, 10]);
  });

  it('deduplicates before chunking, so a repeated number does not cost a slot', () => {
    expect(chunkTrackingNumbers(['a', 'a', 'b'])).toEqual([['a', 'b']]);
  });

  it('is empty for no numbers, so a caller loops zero times rather than calling with none', () => {
    expect(chunkTrackingNumbers([null, '  ', undefined])).toEqual([]);
  });
});

describe('buildTrackRequest', () => {
  it('asks for the detailed scans, not just the latest status', () => {
    expect(buildTrackRequest(['876350374113'])).toEqual({
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber: '876350374113' } }],
    });
  });
});

describe('describeTrackFailure', () => {
  /**
   * The failure that sent us hunting for lost API keys on the Rate work. Said plainly here so it
   * cannot happen twice: a token was minted seconds earlier, so the credentials are demonstrably
   * fine and the project's API selection is what to look at.
   */
  it('does not blame the credentials for an authorisation refusal', () => {
    const msg = describeTrackFailure(403, { errors: [{ code: 'NOT.AUTHORIZED.ERROR' }] });
    expect(msg).toContain('Basic Integrated Visibility');
    expect(msg).toContain('not the problem');
  });

  it('names FedEx as the cause of a 500 rather than leaving it ambiguous', () => {
    expect(describeTrackFailure(503, null)).toContain('Their side');
  });

  it('passes FedEx\'s own message through when it has one', () => {
    expect(describeTrackFailure(400, { errors: [{ code: 'X', message: 'Invalid tracking number' }] }))
      .toBe('Invalid tracking number');
  });
});

describe('dueForRefresh', () => {
  const now = at('2026-09-08T12:00:00Z');
  const base = { shipmentDate: at('2026-09-06T09:00:00Z'), deliveredAt: null, checkedAt: null, failureCount: 0, needsBackfill: false };

  it('asks about a number nobody has asked about yet', () => {
    expect(dueForRefresh(base, now)).toBe(true);
  });

  /** Delivered is the one status FedEx never revises. Polling past it is pure waste. */
  it('never asks again once delivered', () => {
    expect(dueForRefresh({ ...base, deliveredAt: at('2026-09-07T15:00:00Z'), checkedAt: null }, now)).toBe(false);
  });

  it('waits six hours between checks in the first fortnight', () => {
    expect(dueForRefresh({ ...base, checkedAt: at('2026-09-08T09:00:00Z') }, now)).toBe(false);
    expect(dueForRefresh({ ...base, checkedAt: at('2026-09-08T05:00:00Z') }, now)).toBe(true);
  });

  it('drops to daily once the parcel is over a fortnight old', () => {
    const old = { ...base, shipmentDate: at('2026-08-01T09:00:00Z') };
    expect(dueForRefresh({ ...old, checkedAt: at('2026-09-08T01:00:00Z') }, now)).toBe(false);
    expect(dueForRefresh({ ...old, checkedAt: at('2026-09-07T01:00:00Z') }, now)).toBe(true);
  });

  /**
   * The stopping condition that matters most. Without it, every undelivered parcel ever shipped
   * stays in the sweep for good, asking an endpoint that cannot answer.
   */
  it('stops at ninety days, because FedEx has dropped the history by then', () => {
    const ancient = { ...base, shipmentDate: at('2026-05-01T09:00:00Z'), checkedAt: null };
    expect(dueForRefresh(ancient, now)).toBe(false);
  });

  /**
   * `force` is what the Refresh button passes. It overrides the SCHEDULE, not the facts: a parcel
   * FedEx no longer holds and a number FedEx does not recognise stay refused, because asking would
   * write "not recognised" against a parcel whose only problem is being old.
   */
  it('lets a forced refresh skip the cadence and the delivered stop', () => {
    expect(dueForRefresh({ ...base, checkedAt: at('2026-09-08T11:59:00Z') }, now, { force: true })).toBe(true);
    expect(dueForRefresh({ ...base, deliveredAt: at('2026-09-07T15:00:00Z') }, now, { force: true })).toBe(true);
  });

  it('refuses a forced refresh past retention or past the failure ceiling', () => {
    const ancient = { ...base, shipmentDate: at('2026-05-01T09:00:00Z') };
    expect(dueForRefresh(ancient, now, { force: true })).toBe(false);
    expect(dueForRefresh({ ...base, failureCount: TRACK_MAX_FAILURES }, now, { force: true })).toBe(false);
  });

  /**
   * The rule that makes a new column fill itself in.
   *
   * Without it, every parcel already delivered keeps whatever we happened to store on the day, and
   * enriching them depends on somebody remembering to run a script — which is the same as it not
   * happening. One more ask, then the delivered stop takes over again for good.
   */
  it('asks once more about a delivered parcel whose stored reply predates a new column', () => {
    const done = { ...base, deliveredAt: at('2026-09-07T15:00:00Z'), checkedAt: at('2026-09-07T16:00:00Z') };
    expect(dueForRefresh(done, now)).toBe(false);
    expect(dueForRefresh({ ...done, needsBackfill: true }, now)).toBe(true);
  });

  it('does not let a backfill outrank retention or the failure ceiling', () => {
    const ancient = { ...base, shipmentDate: at('2026-05-01T09:00:00Z'), needsBackfill: true };
    expect(dueForRefresh(ancient, now)).toBe(false);
    expect(dueForRefresh({ ...base, needsBackfill: true, failureCount: TRACK_MAX_FAILURES }, now)).toBe(false);
  });

  /** A Cyprus Post number in a FedEx row will never start being recognised. */
  it('gives up on a number FedEx keeps refusing', () => {
    expect(dueForRefresh({ ...base, failureCount: TRACK_MAX_FAILURES }, now)).toBe(false);
    expect(dueForRefresh({ ...base, failureCount: TRACK_MAX_FAILURES - 1 }, now)).toBe(true);
  });
});

describe('isFedexService', () => {
  it('recognises the catalogue entry as it is spelt today', () => {
    expect(isFedexService('FedEx', 'FedEx')).toBe(true);
  });

  /** The reason this is a match and not an equality test. */
  it('still recognises it once the catalogue splits by service', () => {
    expect(isFedexService('FedEx International Priority', null)).toBe(true);
    expect(isFedexService('Fedex Economy', null)).toBe(true);
  });

  it('does not claim the other couriers', () => {
    expect(isFedexService('Cyprus Postal Service', 'CPS')).toBe(false);
    expect(isFedexService('TNT', 'TNT')).toBe(false);
    expect(isFedexService(null, null)).toBe(false);
  });
});

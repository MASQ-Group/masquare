import { describe, expect, it } from 'vitest';
import { legacyAvailabilityReason, RETAKE_WINDOW_MS } from './legacy-availability-reason';

/**
 * The rule has to be right in BOTH directions, so these tests are as much about what it refuses to
 * claim as about what it claims. The failure being guarded against is not "no label" — it is a
 * confident label that turns out to be false about a real order, which is how this whole line of
 * work started.
 */
const base = { found: true, status: 'submitted', retakenAfterMs: null as number | null };

describe('legacyAvailabilityReason', () => {
  /**
   * The dominant case. Any update that replaces an order's item rows returns availability and
   * re-deducts inside the same request; on real data every such pair sat about ten milliseconds
   * apart and matched in size.
   */
  it('names a release that was immediately retaken an edit', () => {
    expect(legacyAvailabilityReason({ ...base, retakenAfterMs: 10 })).toBe('order_edited');
  });

  /**
   * The case the complaint came from: BE-HT15, 26 August, eight rows in one morning. Every order a
   * draft, fulfilment `shipped`, channel `shipped`. The goods left; nobody returned them.
   */
  it('names a still-draft order as one that was never submitted', () => {
    expect(legacyAvailabilityReason({ ...base, status: 'draft' })).toBe('order_not_submitted');
  });

  /**
   * An edit to a draft is still an edit. The retake is evidence about this row; the status is
   * evidence about the order, and the more specific reading wins.
   */
  it('prefers the edit reading when both would apply', () => {
    expect(legacyAvailabilityReason({ found: true, status: 'draft', retakenAfterMs: 8 }))
      .toBe('order_edited');
  });

  /**
   * A retake hours later is a different operation, not the other half of one request. Widening the
   * window to catch it would let a genuine cancellation-then-resale read as an edit.
   */
  it('does not call a much later retake an edit', () => {
    expect(legacyAvailabilityReason({ ...base, retakenAfterMs: 4 * 60 * 60 * 1000 })).toBeNull();
  });

  it('holds the window boundary in both directions', () => {
    expect(legacyAvailabilityReason({ ...base, retakenAfterMs: RETAKE_WINDOW_MS })).toBe('order_edited');
    expect(legacyAvailabilityReason({ ...base, retakenAfterMs: RETAKE_WINDOW_MS + 1 })).toBeNull();
  });

  /**
   * Submitted today says nothing about the state when the row was written, and nothing retook the
   * units. Draft-then, a force-release, or a shrunken line — three causes, no way to separate them.
   */
  it('refuses to name a cause for a submitted order that was never retaken', () => {
    expect(legacyAvailabilityReason(base)).toBeNull();
  });

  /** No order behind the note — nothing to read the cause from. */
  it('refuses when the order cannot be found', () => {
    expect(legacyAvailabilityReason({ ...base, found: false, status: 'draft' })).toBeNull();
  });

  /**
   * `found: false` is also how an ambiguous reference arrives — one note matching several orders
   * that disagree about their status. A guess would be a coin toss written into the audit trail.
   *
   * The retake evidence is deliberately not honoured here either: without a settled order behind
   * the note there is no way to know the pairing describes the same sale.
   */
  it('refuses on an ambiguous reference even when something retook the units', () => {
    expect(legacyAvailabilityReason({ found: false, status: 'draft', retakenAfterMs: 9 })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { legacyAvailabilityReason, RETAKE_WINDOW_MS } from './legacy-availability-reason';

/**
 * The rule has to be right in BOTH directions, so these tests are as much about what it refuses to
 * claim as about what it claims. The failure being guarded against is not "no label" — it is a
 * confident label that turns out to be false about a real order, which is how this whole line of
 * work started.
 */
const base = {
  found: true,
  status: 'submitted',
  deleted: false,
  retakenAfterMs: null as number | null,
  hasLiveLine: true,
};

describe('legacyAvailabilityReason', () => {
  it('names a deleted order a release', () => {
    expect(legacyAvailabilityReason({ ...base, deleted: true })).toBe('released');
  });

  /**
   * Deletion force-releases everything the order held, so it explains the row on its own. Reading
   * any of the later signals first would report a cause that the delete overrode.
   */
  it('lets deletion override every other signal', () => {
    expect(legacyAvailabilityReason({
      ...base, deleted: true, status: 'draft', retakenAfterMs: 5, hasLiveLine: false,
    })).toBe('released');
  });

  /**
   * The churn case. Any update that replaces an order's item rows returns availability and
   * re-deducts inside the same request; on real data every such pair sat about ten milliseconds
   * apart and matched in size.
   */
  it('names a release that was immediately retaken an edit', () => {
    expect(legacyAvailabilityReason({ ...base, retakenAfterMs: 10 })).toBe('order_edited');
  });

  /**
   * The case the retake test is blind to: the edit dropped the product, so there is no sale to pair
   * with and the units genuinely stayed returned.
   */
  it('names a release whose product left the order a removed line', () => {
    expect(legacyAvailabilityReason({ ...base, hasLiveLine: false })).toBe('order_line_removed');
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
  it('prefers the edit reading over the draft reading', () => {
    expect(legacyAvailabilityReason({ ...base, status: 'draft', retakenAfterMs: 8 }))
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
   * Live, submitted, still carrying the product, never retaken. Draft-then or a shrunken line —
   * two causes and no way to separate them. This is the row that keeps the vague label, and the
   * test exists to stop a future rule quietly claiming it.
   */
  it('refuses to name a cause for a live submitted order that kept the line', () => {
    expect(legacyAvailabilityReason(base)).toBeNull();
  });

  /** No order behind the note — nothing to read the cause from. */
  it('refuses when the order cannot be found', () => {
    expect(legacyAvailabilityReason({ ...base, found: false, status: 'draft' })).toBeNull();
  });

  /**
   * `found: false` is also how an ambiguous reference arrives — one note matching several orders
   * that disagree. None of the other signals is honoured either: without a settled order behind the
   * note there is no way to know they describe the same sale.
   */
  it('refuses on an ambiguous reference whatever else looks true', () => {
    expect(legacyAvailabilityReason({
      found: false, status: 'draft', deleted: true, retakenAfterMs: 9, hasLiveLine: false,
    })).toBeNull();
  });
});

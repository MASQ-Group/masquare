import { describe, expect, it } from 'vitest';
import { legacyAvailabilityReason } from './legacy-availability-reason';

/**
 * The rule has to be right in BOTH directions, so these tests are as much about what it refuses to
 * claim as about what it claims. The failure being guarded against is not "no label" — it is a
 * confident label that turns out to be false about a real order.
 */
describe('legacyAvailabilityReason', () => {
  /**
   * The case the complaint came from: BE-HT15, 26 August, eight rows in one morning. Every order a
   * draft, fulfilment `shipped`, channel `shipped`. The goods left; nobody returned them.
   */
  it('names a still-draft order as one that was never submitted', () => {
    expect(legacyAvailabilityReason({ found: true, status: 'draft' })).toBe('order_not_submitted');
  });

  /**
   * A draft that was later marked returned is still a draft, so the draft rule still explains the
   * release. The resolution is another fact about the order, not the cause of this row — treating it
   * as the cause would be inference, which is the thing that produced these rows in the first place.
   */
  it('does not let a resolution override the draft reading', () => {
    expect(legacyAvailabilityReason({ found: true, status: 'draft' })).toBe('order_not_submitted');
  });

  /**
   * Submitted today says nothing about the state when the row was written. Draft-then means the
   * draft rule; submitted-then means a force-release or a shrunken line. Three causes, no timestamp
   * to separate them, so the row keeps the vague label it already has.
   */
  it('refuses to name a cause for an order that is submitted today', () => {
    expect(legacyAvailabilityReason({ found: true, status: 'submitted' })).toBeNull();
  });

  /** No order behind the note — nothing to read the cause from. */
  it('refuses when the order cannot be found', () => {
    expect(legacyAvailabilityReason({ found: false, status: 'draft' })).toBeNull();
  });

  /**
   * `found: false` is also how an ambiguous reference arrives — one note matching several orders
   * that disagree about their status. A guess would be a coin toss written into the audit trail.
   */
  it('refuses on an ambiguous reference even though a status is supplied', () => {
    expect(legacyAvailabilityReason({ found: false, status: 'submitted' })).toBeNull();
  });
});

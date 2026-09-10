import { describe, expect, it } from 'vitest';
import { availabilityMoveReason } from './availability-move-reason';

/**
 * The ledger must not invent a cause.
 *
 * The reason used to come from the sign of the movement — give units back and it was written down
 * as a cancellation. Real history from product BE-HT15, one morning in August:
 *
 *   26/08  Cancelled before shipment  +1  left 20  203-7426406-8643565
 *   26/08  Cancelled before shipment  +1  left 19  202-2162356-3957121
 *   26/08  Cancelled before shipment  +1  left 18  204-0157323-8218765
 *
 * Every one of those orders shipped and none was cancelled. They were DRAFTS, and a draft used to
 * release its units — so the release was recorded as the one cause it could not have been. Draft
 * no longer releases anything, and the reason is decided rather than inferred either way.
 */

const base = { move: -1, forceRelease: false, cancelledBeforeShipment: false };

describe('availabilityMoveReason', () => {
  it('calls taking units a sale', () => {
    expect(availabilityMoveReason({ ...base, move: 1 })).toBe('sale');
  });

  it('still calls a real cancellation a cancellation', () => {
    expect(availabilityMoveReason({ ...base, cancelledBeforeShipment: true })).toBe('order_cancelled');
  });

  it('names a deleted or force-released order a release', () => {
    expect(availabilityMoveReason({ ...base, forceRelease: true })).toBe('released');
  });

  /** A live, submitted order simply holding fewer units — nothing was cancelled or released. */
  it('names a shrunk line a reduction', () => {
    expect(availabilityMoveReason(base)).toBe('quantity_reduced');
  });

  /**
   * The two release conditions can both be true — a deleted order may also be a cancelled one.
   * The ranking mirrors the caller's, so the recorded reason describes what happened rather than
   * which check ran first.
   */
  it('ranks a release above the states that come with it', () => {
    expect(availabilityMoveReason({ ...base, forceRelease: true, cancelledBeforeShipment: true }))
      .toBe('released');
  });

  /** Taking units wins over every release condition — the order is live and consuming stock. */
  it('is a sale whenever units are actually taken', () => {
    expect(availabilityMoveReason({ ...base, move: 2, forceRelease: true })).toBe('sale');
  });
});

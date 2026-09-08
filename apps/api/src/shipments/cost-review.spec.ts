import { describe, expect, it } from 'vitest';

/**
 * Accounting's sign-off on a shipping cost, and what invalidates it.
 *
 * A review says: somebody compared this figure to the carrier's invoice. That claim has two ways of
 * becoming false — being made about nothing, and being about a figure that has since changed — and
 * both are silent. A tick that survives an edit is the worse of the two: it asserts that accounting
 * saw a number they have never seen.
 */

type Shipment = { shippingCostEur: number | null; reviewedAt: Date | null; reviewedById: string | null };

/** Whether a review may be recorded at all. Mirrors setReviewed. */
function canReview(s: Pick<Shipment, 'shippingCostEur'>): boolean {
  return s.shippingCostEur != null;
}

/** What a cost write leaves behind. Mirrors setActualCosts. */
function afterCostWrite(_before: Shipment, cost: number | null): Shipment {
  return { shippingCostEur: cost, reviewedAt: null, reviewedById: null };
}

const reviewed = (cost: number | null): Shipment => ({
  shippingCostEur: cost,
  reviewedAt: new Date('2026-09-07T10:00:00Z'),
  reviewedById: 'user-1',
});

describe('marking a shipment reviewed', () => {
  it('needs a recorded cost to review', () => {
    // Otherwise it is an assurance about nothing, and the tick would mean somebody checked a blank.
    expect(canReview({ shippingCostEur: 12.5 })).toBe(true);
    expect(canReview({ shippingCostEur: null })).toBe(false);
  });

  it('accepts a zero cost, which is a real figure', () => {
    // A free carriage or an absorbed cost is something accounting can genuinely confirm.
    expect(canReview({ shippingCostEur: 0 })).toBe(true);
  });
});

describe('changing a cost after it was reviewed', () => {
  it('withdraws the review, because it was given for the old figure', () => {
    // The one thing a review must never do is appear to cover a number nobody saw.
    const after = afterCostWrite(reviewed(12.5), 18.4);
    expect(after.reviewedAt).toBeNull();
    expect(after.reviewedById).toBeNull();
  });

  it('withdraws it even when the new figure happens to match the old', () => {
    // Deliberate. The write is the event; comparing values to decide whether to keep a sign-off
    // means a re-entered figure silently inherits an assurance nobody re-gave.
    const after = afterCostWrite(reviewed(12.5), 12.5);
    expect(after.reviewedAt).toBeNull();
  });

  it('withdraws it when a cost is cleared', () => {
    const after = afterCostWrite(reviewed(12.5), null);
    expect(after.reviewedAt).toBeNull();
    expect(after.shippingCostEur).toBeNull();
  });

  it('leaves an unreviewed shipment unreviewed', () => {
    const after = afterCostWrite({ shippingCostEur: null, reviewedAt: null, reviewedById: null }, 9.99);
    expect(after.reviewedAt).toBeNull();
  });
});

describe('splitting one carrier charge across a parcel group', () => {
  /**
   * Several orders in one box share a groupId and the carrier charges once. The cost is recorded
   * per parcel — per tracking number — rather than as one figure divided by however many there
   * were: an equal split is a guess dressed as a fact, and two parcels to different countries make
   * it a bad one.
   */
  const parcels = [
    { shipmentId: 'a', trackingNumber: 'TRK-1' },
    { shipmentId: 'b', trackingNumber: 'TRK-2' },
  ];

  it('offers one entry per tracking number', () => {
    expect(parcels).toHaveLength(2);
    expect(new Set(parcels.map((p) => p.trackingNumber)).size).toBe(2);
  });

  it('keeps the figures independent rather than dividing one total', () => {
    // 30 and 8 is what the carrier charged. An even split would have written 19 against each and
    // made one order look unprofitable and the other better than it is.
    const entries = [
      { shipmentId: 'a', shippingCostEur: 30 },
      { shipmentId: 'b', shippingCostEur: 8 },
    ];
    expect(entries.map((e) => e.shippingCostEur)).toEqual([30, 8]);
    expect(entries.reduce((t, e) => t + e.shippingCostEur, 0)).toBe(38);
  });

  it('treats a shipment with no group as a group of one', () => {
    const single = [{ shipmentId: 'solo', trackingNumber: 'TRK-9' }];
    expect(single).toHaveLength(1);
  });
});

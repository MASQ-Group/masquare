import { describe, expect, it } from 'vitest';
import { amazonCancelStage } from './amazon-mapping';

/**
 * Two cancellations that look identical and are not.
 *
 * An order cancelled while still Pending never became an order: no payment was taken and nothing
 * was shipped, so there is nothing for an operator to decide. An order that was confirmed and then
 * cancelled before dispatch is a real order that fell over. Amazon reports `OrderStatus: Canceled`
 * for both, so the status cannot separate them — but Amazon withholds financials while an order is
 * Pending, so the one cancelled out of Pending never had an OrderTotal.
 *
 * The payloads below are the real ones, fetched from the Orders API on 2026-08-25.
 */

/** 203-0357262-8533160 — cancelled two minutes after purchase, never confirmed. */
const NEVER_PLACED = {
  AmazonOrderId: '203-0357262-8533160',
  OrderStatus: 'Canceled',
  PurchaseDate: '2026-08-25T03:21:00Z',
  LastUpdateDate: '2026-08-25T03:22:59Z',
  NumberOfItemsShipped: 0,
  NumberOfItemsUnshipped: 0,
  FulfillmentChannel: 'MFN',
  // No OrderTotal. Amazon never populated one.
};

/** 702-2579052-5535426 — a real order on Amazon.ca, cancelled twelve hours later. */
const PLACED_THEN_CANCELLED = {
  AmazonOrderId: '702-2579052-5535426',
  OrderStatus: 'Canceled',
  PurchaseDate: '2026-08-25T04:06:26Z',
  LastUpdateDate: '2026-08-25T16:06:34Z',
  NumberOfItemsShipped: 0,
  NumberOfItemsUnshipped: 0,
  FulfillmentChannel: 'MFN',
  OrderTotal: { CurrencyCode: 'CAD', Amount: '296.01' },
  PaymentMethodDetails: ['Standard'],
};

describe('amazonCancelStage', () => {
  it('separates the two real orders that motivated this', () => {
    expect(amazonCancelStage(NEVER_PLACED)).toBe('pending');
    expect(amazonCancelStage(PLACED_THEN_CANCELLED)).toBe('placed');
  });

  it('does not read quantity, which is zero on both', () => {
    // Amazon zeroes QuantityOrdered when it cancels, so quantity looks like "never ordered" even
    // for an order that was genuinely placed. Anything keying off it would be wrong half the time.
    expect(NEVER_PLACED.NumberOfItemsShipped).toBe(PLACED_THEN_CANCELLED.NumberOfItemsShipped);
    expect(NEVER_PLACED.NumberOfItemsUnshipped).toBe(PLACED_THEN_CANCELLED.NumberOfItemsUnshipped);
    expect(amazonCancelStage(NEVER_PLACED)).not.toBe(amazonCancelStage(PLACED_THEN_CANCELLED));
  });

  it('treats a zero total as a total, because it is one', () => {
    // A fully-discounted or promotional order can legitimately total zero. That is still a
    // confirmed order, and reading it as "never placed" would hide a real cancellation.
    expect(amazonCancelStage({ OrderStatus: 'Canceled', OrderTotal: { Amount: '0.00' } })).toBe('placed');
    expect(amazonCancelStage({ OrderStatus: 'Canceled', OrderTotal: { Amount: 0 } })).toBe('placed');
  });

  it('reads a missing, null or blank total as never placed', () => {
    expect(amazonCancelStage({ OrderStatus: 'Canceled' })).toBe('pending');
    expect(amazonCancelStage({ OrderStatus: 'Canceled', OrderTotal: {} })).toBe('pending');
    expect(amazonCancelStage({ OrderStatus: 'Canceled', OrderTotal: { Amount: null } })).toBe('pending');
    expect(amazonCancelStage({ OrderStatus: 'Canceled', OrderTotal: { Amount: '  ' } })).toBe('pending');
  });

  it('says nothing about an order that is not cancelled', () => {
    // A stage on a live order would be a lie, and the database CHECK constraint rejects it.
    expect(amazonCancelStage({ OrderStatus: 'Shipped', OrderTotal: { Amount: '99.00' } })).toBeNull();
    expect(amazonCancelStage({ OrderStatus: 'Unshipped' })).toBeNull();
    expect(amazonCancelStage({ OrderStatus: 'Pending' })).toBeNull();
    expect(amazonCancelStage({})).toBeNull();
  });
});

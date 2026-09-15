import { describe, expect, it } from 'vitest';
import { availabilityAfterSale, decideOrderLine, orderKey } from './order-availability-rules';

const ON = { syncOn: true, cancelled: false, inAvailability: true, units: 1 };

describe('decideOrderLine — the three rules', () => {
  /** Rule 2: 3 in availability, an order for 1. */
  it('takes the units of an order for a SKU in availability', () => {
    expect(decideOrderLine({ ...ON, units: 1 })).toEqual({ outcome: 'deducted', deduct: 1 });
    expect(decideOrderLine({ ...ON, units: 4 })).toEqual({ outcome: 'deducted', deduct: 4 });
  });

  /** Rule 3: not in availability means nothing — and the decision is stored, so it stays nothing. */
  it('ignores an order for a SKU that is not in availability', () => {
    expect(decideOrderLine({ ...ON, inAvailability: false, units: 2 })).toEqual({ outcome: 'not_in_availability', deduct: 0 });
  });

  it('takes nothing while selling through is switched off', () => {
    expect(decideOrderLine({ ...ON, syncOn: false })).toEqual({ outcome: 'sync_off', deduct: 0 });
  });

  it('takes nothing for an order that arrives already cancelled', () => {
    expect(decideOrderLine({ ...ON, cancelled: true })).toEqual({ outcome: 'cancelled_on_arrival', deduct: 0 });
  });

  it('never produces a negative deduction, which would be stock rising without a person', () => {
    expect(decideOrderLine({ ...ON, units: -3 }).deduct).toBe(0);
  });
});

describe('availabilityAfterSale', () => {
  it('lowers by the units ordered', () => {
    expect(availabilityAfterSale(3, 1)).toBe(2);
  });

  it('stops at zero', () => {
    expect(availabilityAfterSale(1, 3)).toBe(0);
    expect(availabilityAfterSale(0, 1)).toBe(0);
  });

  /** Rule 1: nothing but a person raises stock. */
  it('never raises the figure', () => {
    expect(availabilityAfterSale(2, -5)).toBe(2);
  });
});

describe('orderKey', () => {
  /** A withdrawn Amazon order pulled again is a new row with the same order number. */
  it('is the same for an order deleted and imported again as a new row', () => {
    const first = orderKey({ id: 'row-1', integrationId: 'amz', transactionRef: '202-4435476-3609907' });
    const again = orderKey({ id: 'row-2', integrationId: 'amz', transactionRef: '202-4435476-3609907' });
    expect(again).toBe(first);
  });

  it('ignores case and stray spaces in the order number', () => {
    expect(orderKey({ id: 'a', integrationId: 'ebay', transactionRef: ' 26-14290-01987 ' }))
      .toBe(orderKey({ id: 'b', integrationId: 'ebay', transactionRef: '26-14290-01987' }));
  });

  it('keeps the same number on two accounts apart', () => {
    expect(orderKey({ id: 'a', integrationId: 'amz-uk', transactionRef: '1' }))
      .not.toBe(orderKey({ id: 'a', integrationId: 'amz-de', transactionRef: '1' }));
  });

  it('falls back to the sales channel, then to the row, for hand-entered sales', () => {
    expect(orderKey({ id: 'row-9', salesChannelId: 'shop', transactionRef: 'INV-7' })).toBe('shop:inv-7');
    expect(orderKey({ id: 'row-9', transactionRef: '' })).toBe('manual:row-9');
  });
});

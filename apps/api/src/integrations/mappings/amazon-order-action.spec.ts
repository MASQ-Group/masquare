import { describe, expect, it } from 'vitest';
import { amazonOrderAction } from './amazon-order-action';

describe('amazonOrderAction', () => {
  it('imports an ordinary order', () => {
    expect(amazonOrderAction({ OrderStatus: 'Unshipped' })).toBe('import');
    expect(amazonOrderAction({ OrderStatus: 'Shipped' })).toBe('import');
    expect(amazonOrderAction({ OrderStatus: 'PartiallyShipped' })).toBe('import');
  });

  /**
   * The reason this exists. Amazon withholds the money and the address while payment verification
   * runs, so an imported Pending order carries no VAT, an overstated net, and a destination guessed
   * from the marketplace — and reserves stock against a sale that may never happen.
   */
  it('leaves a Pending order alone', () => {
    expect(amazonOrderAction({ OrderStatus: 'Pending' })).toBe('skip-pending');
  });

  /** Amazon only shipped these; the sale belongs to whichever channel it was placed on. */
  it('skips Multi-Channel Fulfilment whatever its status', () => {
    for (const OrderStatus of ['Unshipped', 'Shipped', 'Pending', 'Canceled']) {
      expect(amazonOrderAction({ SalesChannel: 'Non-Amazon', OrderStatus })).toBe('skip-mcf');
    }
  });

  /**
   * The ordering that carries meaning. An order cancelled straight out of Pending reports
   * `Canceled` — Amazon replaces the status rather than keeping both — so the cancellation branch
   * must still see it. Checking Pending first is what keeps that true, and checking it LAST would
   * silently stop cancelled-from-pending orders being registered.
   */
  it('still registers an order cancelled out of pending', () => {
    expect(amazonOrderAction({ OrderStatus: 'Canceled' })).toBe('cancelled');
  });

  it('imports rather than guessing when the status is missing or unfamiliar', () => {
    expect(amazonOrderAction({})).toBe('import');
    expect(amazonOrderAction({ OrderStatus: undefined })).toBe('import');
    expect(amazonOrderAction({ OrderStatus: 'SomethingAmazonAddedLater' })).toBe('import');
  });

  /** `pending` is not `Pending`. Amazon's vocabulary is fixed, and guessing at case would be us inventing one. */
  it('does not match a status Amazon never sends', () => {
    expect(amazonOrderAction({ OrderStatus: 'pending' })).toBe('import');
  });
});

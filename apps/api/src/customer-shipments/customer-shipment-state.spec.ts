import { describe, expect, it } from 'vitest';
import {
  isPending, missingForFulfilment, planCustomerAction, planStaffAction, queueOf, type ShipmentStatus,
} from './customer-shipment-state';

const ALL: ShipmentStatus[] = ['SUBMITTED', 'NEEDS_INFO', 'FULFILLED', 'CANCELLED', 'ARCHIVED'];
const reasonOf = (v: ReturnType<typeof planCustomerAction>) => (v.ok ? '' : v.reason);

describe('what the customer may do', () => {
  it('lets them correct a shipment we have not acted on', () => {
    expect(planCustomerAction('SUBMITTED', 'edit').ok).toBe(true);
    expect(planCustomerAction('NEEDS_INFO', 'edit').ok).toBe(true);
  });

  /** The rule that matters: a booked parcel cannot be re-addressed by editing a row. */
  it('stops them editing one we have already booked, and says why', () => {
    const v = planCustomerAction('FULFILLED', 'edit');
    expect(v.ok).toBe(false);
    expect(reasonOf(v)).toContain('on a label');
  });

  it('lets them cancel while it is still waiting', () => {
    expect(planCustomerAction('SUBMITTED', 'cancel')).toEqual({ ok: true, next: 'CANCELLED' });
    expect(planCustomerAction('NEEDS_INFO', 'cancel')).toEqual({ ok: true, next: 'CANCELLED' });
  });

  it('tells them to call us rather than refusing flatly once it is booked', () => {
    expect(reasonOf(planCustomerAction('FULFILLED', 'cancel'))).toContain('Call us');
  });

  it('sends it back to us when they have answered our question', () => {
    expect(planCustomerAction('NEEDS_INFO', 'resubmit')).toEqual({ ok: true, next: 'SUBMITTED' });
  });

  it('does not let them resubmit what is already with us', () => {
    expect(reasonOf(planCustomerAction('SUBMITTED', 'resubmit'))).toContain('already with us');
  });

  describe('archiving, which is theirs and manual', () => {
    it('is allowed on anything finished with', () => {
      expect(planCustomerAction('FULFILLED', 'archive')).toEqual({ ok: true, next: 'ARCHIVED' });
      expect(planCustomerAction('CANCELLED', 'archive')).toEqual({ ok: true, next: 'ARCHIVED' });
    });

    it('is refused while it is still live', () => {
      expect(reasonOf(planCustomerAction('SUBMITTED', 'archive'))).toContain('still in progress');
    });

    it('says so when it is already archived', () => {
      expect(reasonOf(planCustomerAction('ARCHIVED', 'archive'))).toContain('already archived');
    });
  });

  it('explains every refusal it gives', () => {
    for (const status of ALL) {
      for (const action of ['edit', 'cancel', 'archive', 'resubmit'] as const) {
        const v = planCustomerAction(status, action);
        if (!v.ok) expect(v.reason.length, `${status}/${action}`).toBeGreaterThan(10);
      }
    }
  });
});

describe('what our team may do', () => {
  it('fulfils anything that is waiting', () => {
    expect(planStaffAction('SUBMITTED', 'fulfil')).toEqual({ ok: true, next: 'FULFILLED' });
    expect(planStaffAction('NEEDS_INFO', 'fulfil')).toEqual({ ok: true, next: 'FULFILLED' });
  });

  it('will not fulfil one the customer cancelled', () => {
    expect(reasonOf(planStaffAction('CANCELLED', 'fulfil'))).toContain('cancelled');
  });

  it('points at editing rather than refusing when it is already fulfilled', () => {
    expect(reasonOf(planStaffAction('FULFILLED', 'fulfil'))).toContain('Edit it');
  });

  it('hands one back to the customer with a question', () => {
    expect(planStaffAction('SUBMITTED', 'request_info')).toEqual({ ok: true, next: 'NEEDS_INFO' });
  });

  it('does not ask twice', () => {
    expect(reasonOf(planStaffAction('NEEDS_INFO', 'request_info'))).toContain('already back with the customer');
  });

  /** A tracking number typed wrongly has to be fixable, and that is only ever after fulfilment. */
  it('can correct a fulfilled shipment', () => {
    expect(planStaffAction('FULFILLED', 'edit')).toEqual({ ok: true, next: 'FULFILLED' });
  });

  it('cannot touch an archived one', () => {
    expect(reasonOf(planStaffAction('ARCHIVED', 'edit'))).toContain('archived');
  });

  it('can undo a fulfilment that was wrong', () => {
    expect(planStaffAction('FULFILLED', 'reopen')).toEqual({ ok: true, next: 'SUBMITTED' });
  });

  it('has nothing to reopen on one that is already open', () => {
    expect(planStaffAction('SUBMITTED', 'reopen').ok).toBe(false);
  });
});

describe('where a shipment shows up', () => {
  it('waits with us while it is submitted or sent back', () => {
    expect(queueOf('SUBMITTED')).toBe('pending');
    expect(queueOf('NEEDS_INFO')).toBe('pending');
    expect(isPending('NEEDS_INFO')).toBe(true);
  });

  it('moves to the fulfilled list once it has gone', () => {
    expect(queueOf('FULFILLED')).toBe('fulfilled');
  });

  it('leaves both lists when it is cancelled or archived', () => {
    expect(queueOf('CANCELLED')).toBe('closed');
    expect(queueOf('ARCHIVED')).toBe('closed');
  });
});

describe('what fulfilment needs', () => {
  it('is satisfied by a carrier and a tracking number', () => {
    expect(missingForFulfilment({ shippingServiceId: 'svc', trackingNumber: '1Z999' })).toEqual([]);
  });

  /** Without one, "where is it" — the only thing the customer gets back — has no answer. */
  it('insists on a tracking number', () => {
    expect(missingForFulfilment({ shippingServiceId: 'svc', trackingNumber: '  ' })).toEqual(['a tracking number']);
  });

  it('names everything missing at once', () => {
    expect(missingForFulfilment({})).toEqual(['the carrier', 'a tracking number']);
  });
});

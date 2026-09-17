/**
 * What may be done to a customer's shipment, by whom, and when.
 *
 * Two parties act on the same row from opposite sides, which is exactly the arrangement that grows
 * contradictory rules if they are written where they are used. The customer may correct a shipment
 * until we have acted on it and not a moment later — a parcel already booked with a carrier cannot
 * be re-addressed by editing a row — and we may ask for more detail, which hands it back to them.
 *
 * Every refusal explains itself, because the two people involved cannot see each other's screen: a
 * customer told "you cannot edit this" while looking at a shipment we booked ten seconds ago needs
 * to be told that, not merely refused.
 *
 * PURE.
 */

export type ShipmentStatus = 'SUBMITTED' | 'NEEDS_INFO' | 'FULFILLED' | 'CANCELLED' | 'ARCHIVED';

/** What the customer's own people may do. */
export type CustomerAction = 'edit' | 'cancel' | 'archive' | 'resubmit';
/** What our team may do. */
export type StaffAction = 'fulfil' | 'request_info' | 'edit' | 'cancel' | 'reopen';

export type Verdict = { ok: true; next?: ShipmentStatus } | { ok: false; reason: string };

/** A shipment we have acted on. Its details are on a label, so they are no longer a row to edit. */
const SETTLED: ShipmentStatus[] = ['FULFILLED', 'ARCHIVED'];

/** Waiting for us, or waiting for them — either way, nothing has been booked. */
export const isPending = (status: ShipmentStatus): boolean => status === 'SUBMITTED' || status === 'NEEDS_INFO';

export function planCustomerAction(status: ShipmentStatus, action: CustomerAction): Verdict {
  switch (action) {
    case 'edit':
      if (isPending(status)) return { ok: true, next: status };
      return {
        ok: false,
        reason: status === 'CANCELLED'
          ? 'This shipment was cancelled, so there is nothing to change. File a new one.'
          : 'We have already booked this shipment, so its details are on a label. Call us if something is wrong with it.',
      };

    case 'resubmit':
      if (status === 'NEEDS_INFO') return { ok: true, next: 'SUBMITTED' };
      if (status === 'SUBMITTED') return { ok: false, reason: 'This shipment is already with us.' };
      return { ok: false, reason: 'Only a shipment we have sent back to you can be resubmitted.' };

    case 'cancel':
      if (isPending(status)) return { ok: true, next: 'CANCELLED' };
      if (status === 'CANCELLED') return { ok: false, reason: 'This shipment is already cancelled.' };
      return { ok: false, reason: 'We have already booked this shipment with the carrier. Call us — it may still be possible to stop it.' };

    case 'archive':
      // Archiving is theirs and manual, so it is allowed on anything that is finished with —
      // whether it went out or was called off — and on nothing that is still live.
      if (status === 'FULFILLED' || status === 'CANCELLED') return { ok: true, next: 'ARCHIVED' };
      if (status === 'ARCHIVED') return { ok: false, reason: 'This shipment is already archived.' };
      return { ok: false, reason: 'This shipment is still in progress. It can be archived once it has gone out.' };
  }
}

export function planStaffAction(status: ShipmentStatus, action: StaffAction): Verdict {
  switch (action) {
    case 'fulfil':
      if (isPending(status)) return { ok: true, next: 'FULFILLED' };
      if (status === 'FULFILLED') return { ok: false, reason: 'This shipment has already been fulfilled. Edit it to correct the carrier or the tracking number.' };
      if (status === 'ARCHIVED') return { ok: false, reason: 'This shipment is archived.' };
      return { ok: false, reason: 'The customer cancelled this shipment.' };

    case 'request_info':
      if (status === 'SUBMITTED') return { ok: true, next: 'NEEDS_INFO' };
      if (status === 'NEEDS_INFO') return { ok: false, reason: 'This shipment is already back with the customer.' };
      return { ok: false, reason: 'Only a shipment waiting to be fulfilled can be sent back for more detail.' };

    case 'edit':
      // Ours to correct at any point short of archived: a tracking number typed wrongly has to be
      // fixable, and it is fixable only after fulfilment.
      if (status === 'ARCHIVED') return { ok: false, reason: 'This shipment is archived. The customer can unarchive it if it needs another look.' };
      return { ok: true, next: status };

    case 'cancel':
      if (isPending(status)) return { ok: true, next: 'CANCELLED' };
      return { ok: false, reason: 'Only a shipment that has not been fulfilled can be cancelled here.' };

    case 'reopen':
      // Undoing our own mistake: a shipment marked fulfilled that was not.
      if (SETTLED.includes(status)) return { ok: true, next: 'SUBMITTED' };
      return { ok: false, reason: 'This shipment is already open.' };
  }
}

/** Which tab a shipment belongs on, on our side. */
export function queueOf(status: ShipmentStatus): 'pending' | 'fulfilled' | 'closed' {
  if (isPending(status)) return 'pending';
  if (status === 'FULFILLED') return 'fulfilled';
  return 'closed';
}

/** What is missing before a shipment can be marked fulfilled. Named, so the screen can say which. */
export function missingForFulfilment(input: { shippingServiceId?: string | null; trackingNumber?: string | null }): string[] {
  const gaps: string[] = [];
  if (!input.shippingServiceId) gaps.push('the carrier');
  /**
   * A tracking number is required, and deliberately so: the whole of what the customer gets back
   * from this is "where is it", and a fulfilled shipment without one answers nothing.
   */
  if (!(input.trackingNumber ?? '').trim()) gaps.push('a tracking number');
  return gaps;
}

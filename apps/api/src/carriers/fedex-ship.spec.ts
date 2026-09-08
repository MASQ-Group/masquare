import { describe, expect, it } from 'vitest';
import {
  EORI_TIN_TYPE,
  SHIP_CANCEL_PATH,
  SHIP_PATH,
  buildCancelRequest,
  buildShipRequest,
  missingForBooking,
  type ShipRequestInput,
} from './fedex-ship';

/**
 * Booking, unlike rating, cannot be taken back cheaply.
 *
 * A quote is a number on a screen; a booking is a real label, a real tracking number and a real
 * charge, and FedEx will not tell us afterwards what we shipped. These tests are mostly about the
 * things that are irrecoverable if we get them wrong at the moment of creation.
 */

const base: ShipRequestInput = {
  accountNumber: '789923272',
  shipper: {
    contact: { personName: 'A. Masquare', companyName: 'A.M.A. MASQUARE LTD', phoneNumber: '+35722000000' },
    address: { streetLines: ['1 Example Street'], city: 'Nicosia', postalCode: '2055', countryCode: 'CY' },
  },
  recipient: {
    contact: { personName: 'A Buyer', phoneNumber: '+441234567890' },
    address: { streetLines: ['10 High Street'], city: 'Leeds', postalCode: 'LS1 1AA', countryCode: 'GB' },
  },
  serviceType: 'FEDEX_INTERNATIONAL_PRIORITY',
  shipDate: '2026-09-09',
  parcels: [{ weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 15 }],
  customerReference: 'ORD-10042',
  dutiesPaidBy: 'recipient',
};

describe('the endpoints', () => {
  it('books at /ship/v1/shipments and cancels at its own path', () => {
    expect(SHIP_PATH).toBe('/ship/v1/shipments');
    expect(SHIP_CANCEL_PATH).toBe('/ship/v1/shipments/cancel');
  });
});

describe('the reference that makes reconciliation possible', () => {
  it('puts our order reference on every parcel', () => {
    // §8: what we send at label time is the ONLY join between a FedEx charge and a maSquare order.
    // FedEx has no other handle on it, and the invoice arrives one record per tracking number — so
    // it goes on each package, not once on the shipment.
    const body: any = buildShipRequest({ ...base, parcels: [{ weightKg: 1 }, { weightKg: 2 }] }, { customs: true });
    const refs = body.requestedShipment.requestedPackageLineItems.map(
      (p: any) => p.customerReferences[0],
    );
    expect(refs).toHaveLength(2);
    for (const r of refs) {
      expect(r).toEqual({ customerReferenceType: 'CUSTOMER_REFERENCE', value: 'ORD-10042' });
    }
  });

  it('refuses to build a booking with no reference at all', () => {
    // A shipment booked without one cannot be reconciled afterwards by any means. Better to refuse
    // than to create a charge nobody will ever be able to attribute.
    expect(missingForBooking({ ...base, customerReference: '' })).toContain('order reference');
  });
});

describe('who pays the duty', () => {
  it('bills us at the border when the shipment is duty-paid', () => {
    // The Amazon AE case: a marketplace that forbids charging the buyer on delivery. SENDER puts
    // the duty on our account, where it becomes a cost of the order.
    const body: any = buildShipRequest({ ...base, dutiesPaidBy: 'sender' }, { customs: true });
    const dp = body.requestedShipment.customsClearanceDetail.dutiesPayment;
    expect(dp.paymentType).toBe('SENDER');
    expect(dp.payor.responsibleParty.accountNumber.value).toBe('789923272');
  });

  it('bills the buyer when it is not', () => {
    const body: any = buildShipRequest(base, { customs: true });
    expect(body.requestedShipment.customsClearanceDetail.dutiesPayment).toEqual({ paymentType: 'RECIPIENT' });
  });

  it('has no default — the caller must decide', () => {
    // Enforced by the type rather than by a convention. The failure this guards against is a person
    // forgetting on the fortieth shipment of the day, and a default is exactly how that happens
    // silently. Removing `dutiesPaidBy` below is a compile error, which is the point.
    const withoutDuties: Omit<ShipRequestInput, 'dutiesPaidBy'> = { ...base };
    expect(Object.prototype.hasOwnProperty.call({ ...withoutDuties, dutiesPaidBy: 'sender' }, 'dutiesPaidBy')).toBe(true);
  });
});

describe('the label', () => {
  it('asks for the label in the reply, not a link to it', () => {
    // URL_ONLY hands back a link that expires. A label we cannot re-fetch is precisely what §2.2
    // warns about: FedEx will not give it to us again, so we store the bytes.
    const body: any = buildShipRequest(base, { customs: true });
    expect(body.labelResponseOptions).toBe('LABEL');
  });

  it('defaults to a 4x6 PDF and takes ZPL when a thermal printer is used', () => {
    expect((buildShipRequest(base, { customs: true }) as any).requestedShipment.labelSpecification)
      .toEqual({ labelStockType: 'PAPER_4X6', imageType: 'PDF' });
    const zpl: any = buildShipRequest({ ...base, labelImageType: 'ZPLII' }, { customs: true });
    expect(zpl.requestedShipment.labelSpecification.imageType).toBe('ZPLII');
  });
});

describe('the parcels', () => {
  it('sends metric, and dimensions only when all three are present', () => {
    const body: any = buildShipRequest({ ...base, parcels: [{ weightKg: 2, lengthCm: 30 }] }, { customs: true });
    const item = body.requestedShipment.requestedPackageLineItems[0];
    expect(item.weight).toEqual({ units: 'KG', value: 2 });
    expect(item.dimensions).toBeUndefined();
  });

  it('rounds dimensions up', () => {
    const body: any = buildShipRequest({ ...base, parcels: [{ weightKg: 1, lengthCm: 30.1, widthCm: 20.2, heightCm: 15.9 }] }, { customs: true });
    expect(body.requestedShipment.requestedPackageLineItems[0].dimensions)
      .toEqual({ length: 31, width: 21, height: 16, units: 'CM' });
  });
});

describe('the addresses', () => {
  it('sends the recipient as a one-element array, which is FedEx\'s schema', () => {
    const body: any = buildShipRequest(base, { customs: true });
    expect(Array.isArray(body.requestedShipment.recipients)).toBe(true);
    expect(body.requestedShipment.recipients).toHaveLength(1);
  });

  it('caps street lines at three, which is all FedEx accepts', () => {
    const long = { ...base, recipient: { ...base.recipient, address: { ...base.recipient.address, streetLines: ['a', 'b', 'c', 'd'] } } };
    expect((buildShipRequest(long, { customs: true }) as any).requestedShipment.recipients[0].address.streetLines)
      .toEqual(['a', 'b', 'c']);
  });

  it('carries tax identifiers where we hold them', () => {
    const withEori = { ...base, recipient: { ...base.recipient, tins: [{ tinType: EORI_TIN_TYPE, number: 'GB123456789000' }] } };
    expect((buildShipRequest(withEori, { customs: true }) as any).requestedShipment.recipients[0].tins)
      .toEqual([{ tinType: 'BUSINESS_NATIONAL', number: 'GB123456789000' }]);
  });

  it('omits tins entirely rather than sending an empty array', () => {
    expect((buildShipRequest(base, { customs: true }) as any).requestedShipment.recipients[0].tins).toBeUndefined();
  });

  it('records that the EORI tin type is an inference, not a confirmed fact', () => {
    // The word EORI appears nowhere in 6MB of FedEx's own Ship samples. BUSINESS_NATIONAL is the
    // closest of the types they do show. Sent anyway — a missing recipient EORI causes 24-72 hour
    // customs holds, a certain harm against an uncertain one — but the first real booking settles it.
    expect(EORI_TIN_TYPE).toBe('BUSINESS_NATIONAL');
  });
});

describe('customs', () => {
  it('is attached only when the shipment crosses a customs border', () => {
    expect((buildShipRequest(base, { customs: false }) as any).requestedShipment.customsClearanceDetail).toBeUndefined();
  });

  it('carries the HS code where the product has one', () => {
    const body: any = buildShipRequest({
      ...base,
      commodities: [{
        name: 'Bottle stopper', description: 'Wine bottle stopper', countryOfManufacture: 'CN',
        harmonizedCode: '830990', quantity: 1, unitPriceAmount: 24.5, customsValueAmount: 24.5,
        currency: 'EUR', weightKg: 0.2,
      }],
    }, { customs: true });
    const c = body.requestedShipment.customsClearanceDetail.commodities[0];
    expect(c.harmonizedCode).toBe('830990');
    expect(c.customsValue).toEqual({ amount: 24.5, currency: 'EUR' });
  });

  it('omits the HS code rather than sending an empty one', () => {
    // A blank harmonizedCode is worse than none: it looks answered. ICS2 wants six digits minimum,
    // and a missing one is a conversation with customs rather than a silently wrong declaration.
    const body: any = buildShipRequest({
      ...base,
      commodities: [{
        name: 'x', description: 'x', countryOfManufacture: null, harmonizedCode: null,
        quantity: 1, unitPriceAmount: 1, customsValueAmount: 1, currency: 'EUR', weightKg: 0.1,
      }],
    }, { customs: true });
    expect(body.requestedShipment.customsClearanceDetail.commodities[0].harmonizedCode).toBeUndefined();
  });
});

describe('what stops a booking', () => {
  it('names every gap at once rather than one at a time', () => {
    const gaps = missingForBooking({ ...base, serviceType: '', parcels: [] });
    expect(gaps).toContain('service');
    expect(gaps).toContain('at least one parcel');
  });

  it('requires a contact name at both ends', () => {
    const noName = { ...base, recipient: { ...base.recipient, contact: { personName: null } } };
    expect(missingForBooking(noName)).toContain('delivery contact name');
  });

  it('is satisfied by a complete booking', () => {
    expect(missingForBooking(base)).toEqual([]);
  });
});

describe('cancelling', () => {
  it('takes the tracking number back and deletes every package', () => {
    // A multi-piece shipment cancelled one package at a time would leave the rest live and billable.
    expect(buildCancelRequest('789923272', '794698123456')).toEqual({
      accountNumber: { value: '789923272' },
      trackingNumber: '794698123456',
      deletionControl: 'DELETE_ALL_PACKAGES',
    });
  });
});

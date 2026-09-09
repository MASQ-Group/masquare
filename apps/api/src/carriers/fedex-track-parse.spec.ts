import { describe, expect, it } from 'vitest';
import { deliveryPromise, parseTrackReply, redactTrackResult, statusPill, trackStages } from './fedex-track-parse';

/**
 * A real reply, trimmed.
 *
 * This is our own parcel 876350374113, Strovolos to Santander — which is a better fixture than
 * anything invented, because it went wrong on the way: a delivery exception on 2 September
 * ("Customer not available or business closed") followed by a successful delivery the next day.
 * Every rule about how an exception is surfaced is checked against a shipment that really had one.
 *
 * Alongside it, the reply to a deliberately bogus number, which is how we learnt that FedEx reports
 * an unrecognised number inside a 200 rather than as a failed call.
 */
const REAL_REPLY = {
  transactionId: 'da448f94-c405-4a49-9f2c-1fe61ba308d2',
  output: {
    completeTrackResults: [
      {
        trackingNumber: '999999999999',
        trackResults: [
          {
            trackingNumberInfo: { trackingNumber: '999999999999', trackingNumberUniqueId: '', carrierCode: '' },
            error: {
              code: 'TRACKING.TRACKINGNUMBER.NOTFOUND',
              message: "The tracking number you entered can't be found right now. Please check the number with the shipper or try again later.",
            },
          },
        ],
      },
      {
        trackingNumber: '876350374113',
        trackResults: [
          {
            trackingNumberInfo: { trackingNumber: '876350374113', trackingNumberUniqueId: '2461280000~876350374113~FX', carrierCode: 'FDXE' },
            additionalTrackingInfo: {
              nickname: '',
              packageIdentifiers: [{ type: 'SHIPPER_REFERENCE', values: ['405-0413044-3768324'], trackingNumberUniqueId: '', carrierCode: '' }],
              hasAssociatedShipments: false,
            },
            shipperInformation: { contact: {}, address: { city: 'STROVOLOS', stateOrProvinceCode: 'NC', countryCode: 'CY', residential: false, countryName: 'Cyprus' } },
            recipientInformation: { contact: {}, address: { city: 'SANTANDER', stateOrProvinceCode: 'CT', countryCode: 'ES', residential: false, countryName: 'Spain' } },
            latestStatusDetail: {
              code: 'DL', derivedCode: 'DL', statusByLocale: 'Delivered', description: 'Delivered',
              scanLocation: { city: 'SANTANDER', countryCode: 'ES', countryName: 'Spain' },
            },
            dateAndTimes: [
              { type: 'ACTUAL_DELIVERY', dateTime: '2026-09-03T16:18:00+02:00' },
              { type: 'ACTUAL_PICKUP', dateTime: '2026-08-27T11:17:00+03:00' },
              { type: 'SHIP', dateTime: '2026-08-27T00:00:00+00:00' },
              { type: 'ACTUAL_TENDER', dateTime: '2026-08-27T11:17:00+03:00' },
            ],
            deliveryDetails: {
              actualDeliveryAddress: { city: 'SANTANDER', countryCode: 'ES' },
              locationType: 'RESIDENCE',
              deliveryAttempts: '0',
              receivedByName: 'A.GUSTIN',
            },
            packageDetails: {
              packagingDescription: { type: 'YOUR_PACKAGING', description: 'Your Packaging' },
              weightAndDimensions: {
                weight: [{ value: '18.9', unit: 'KG' }, { value: '41.67', unit: 'LB' }],
                dimensions: [{ length: 37, width: 34, height: 14, units: 'CM' }],
              },
            },
            shipmentDetails: { possessionStatus: true, weight: [{ value: '18.9', unit: 'KG' }, { value: '41.67', unit: 'LB' }] },
            scanEvents: [
              {
                date: '2026-09-03T16:18:00+02:00', eventType: 'DL', eventDescription: 'Delivered',
                exceptionCode: '', exceptionDescription: '',
                scanLocation: { city: 'SANTANDER', stateOrProvinceCode: 'CT', postalCode: '39002', countryCode: 'ES' },
                derivedStatusCode: 'DL', derivedStatus: 'Delivered',
              },
              {
                date: '2026-09-03T11:16:00+02:00', eventType: 'OD', eventDescription: 'On FedEx vehicle for delivery',
                exceptionCode: '', exceptionDescription: '',
                scanLocation: { city: 'HERAS', countryCode: 'ES' },
                derivedStatusCode: 'IT', derivedStatus: 'In transit',
              },
              {
                date: '2026-09-02T12:13:00+02:00', eventType: 'DE', eventDescription: 'Delivery exception',
                exceptionCode: '08', exceptionDescription: 'Customer not available or business closed',
                scanLocation: { city: 'HERAS', countryCode: 'ES' },
                derivedStatusCode: 'DE', derivedStatus: 'Delivery exception',
              },
            ],
            serviceDetail: { type: 'INTERNATIONAL_ECONOMY', description: 'FedEx International Economy', shortDescription: 'IE' },
            standardTransitTimeWindow: { window: { ends: '2026-09-03T20:00:00+02:00' } },
            estimatedDeliveryTimeWindow: { window: {} },
          },
        ],
      },
    ],
  },
};

describe('parseTrackReply', () => {
  const [missing, delivered] = parseTrackReply(REAL_REPLY);

  it('returns one result per number asked about, in the order FedEx replied', () => {
    expect(parseTrackReply(REAL_REPLY)).toHaveLength(2);
    expect(missing.trackingNumber).toBe('999999999999');
    expect(delivered.trackingNumber).toBe('876350374113');
  });

  it('reads the delivered status and the actual delivery time', () => {
    expect(delivered.found).toBe(true);
    expect(delivered.statusCode).toBe('DL');
    expect(delivered.statusDescription).toBe('Delivered');
    expect(delivered.deliveredAt).toBe('2026-09-03T16:18:00+02:00');
  });

  /** FedEx collected the day the label said, but the two are separate facts and pickup wins. */
  it('prefers the actual pickup over the label date for when it shipped', () => {
    expect(delivered.shippedAt).toBe('2026-08-27T11:17:00+03:00');
  });

  it('falls back to the service commitment when there is no live estimate', () => {
    expect(delivered.estimatedDeliveryAt).toBe('2026-09-03T20:00:00+02:00');
  });

  /**
   * The rule this parser exists for. The parcel was delivered, so the status says nothing about the
   * failed attempt the day before — and that attempt is the only part anybody would have acted on.
   */
  it('surfaces the exception even when a later scan succeeded', () => {
    expect(delivered.exceptionCode).toBe('08');
    expect(delivered.exceptionDescription).toBe('Customer not available or business closed');
    expect(delivered.lastScanDescription).toBe('Delivered');
  });

  it('reports the latest scan with where it happened', () => {
    expect(delivered.lastScanAt).toBe('2026-09-03T16:18:00+02:00');
    expect(delivered.lastScanLocation).toBe('SANTANDER, ES');
  });

  it('keeps the scan history newest first, with the derived status of each scan', () => {
    expect(delivered.scans.map((s) => s.code)).toEqual(['DL', 'IT', 'DE']);
    expect(delivered.scans[1].description).toBe('On FedEx vehicle for delivery');
  });

  it('takes the weight FedEx measured, in kilograms rather than pounds', () => {
    expect(delivered.weightKg).toBe(18.9);
  });

  it('reads the waybill reference, which for our Amazon shipments is the order id', () => {
    expect(delivered.shipperReference).toBe('405-0413044-3768324');
  });

  /**
   * The name of whoever signed is present in the reply and is deliberately not carried forward.
   * Asserted rather than merely commented, so bringing it back has to be a decision.
   */
  it('does not carry the signatory name out of the reply', () => {
    expect(JSON.stringify(delivered)).not.toContain('A.GUSTIN');
  });

  it('reports an unrecognised number as not found rather than as a failure', () => {
    expect(missing.found).toBe(false);
    expect(missing.errorCode).toBe('TRACKING.TRACKINGNUMBER.NOTFOUND');
    expect(missing.statusCode).toBeNull();
    expect(missing.scans).toEqual([]);
  });

  it('keeps the rest of the reply, so the record survives FedEx dropping it at ninety days', () => {
    const d = delivered.details as any;
    expect(d.packageDetails.weightAndDimensions.dimensions[0]).toEqual({ length: 37, width: 34, height: 14, units: 'CM' });
    expect(d.serviceDetail.shortDescription).toBe('IE');
    expect(d.deliveryDetails.deliveryAttempts).toBe('0');
  });

  it('keeps the raw event type alongside the derived status', () => {
    // Both are needed and they differ: the van scan is eventType OD, derived status IT.
    expect(delivered.scans.map((s) => s.eventType)).toEqual(['DL', 'OD', 'DE']);
    expect(delivered.scans.map((s) => s.code)).toEqual(['DL', 'IT', 'DE']);
  });

  it('is empty rather than throwing when the reply is not a tracking reply', () => {
    expect(parseTrackReply(null)).toEqual([]);
    expect(parseTrackReply({ output: {} })).toEqual([]);
    expect(parseTrackReply({ errors: [{ code: 'X' }] })).toEqual([]);
  });

  /** A number reused by FedEx comes back twice: the real shipment and a miss. The match wins. */
  it('prefers the result that is not an error when a number is ambiguous', () => {
    const [r] = parseTrackReply({
      output: {
        completeTrackResults: [
          {
            trackingNumber: '111111111111',
            trackResults: [
              { error: { code: 'TRACKING.TRACKINGNUMBER.NOTFOUND', message: 'not found' } },
              { latestStatusDetail: { derivedCode: 'IT', statusByLocale: 'In transit' } },
            ],
          },
        ],
      },
    });
    expect(r.found).toBe(true);
    expect(r.statusCode).toBe('IT');
  });
});

describe('redactTrackResult', () => {
  const raw = {
    deliveryDetails: { receivedByName: 'A.GUSTIN', deliveryAttempts: '0', locationType: 'RESIDENCE' },
    recipientInformation: { contact: { personName: 'Ana Ruiz', phoneNumber: '600123456' }, address: { city: 'SANTANDER', countryCode: 'ES' } },
    shipperInformation: { contact: { personName: 'maSquare' }, address: { city: 'STROVOLOS', countryCode: 'CY' } },
    scanEvents: [{ eventType: 'DL' }],
  };

  it('drops the signatory, and says so nowhere else in the object', () => {
    const out = JSON.stringify(redactTrackResult(raw));
    expect(out).not.toContain('A.GUSTIN');
    expect(out).not.toContain('receivedByName');
  });

  /**
   * The customer's name and number are already held once, on the delivery address, under a
   * twelve-month retention with a purge behind it. A second copy inside a tracking blob would sit
   * outside that policy and outlive it.
   */
  it('drops the contact people on both parties', () => {
    const out = redactTrackResult(raw) as any;
    expect(out.recipientInformation.contact).toBeUndefined();
    expect(out.shipperInformation.contact).toBeUndefined();
  });

  it('keeps the addresses and everything operational', () => {
    const out = redactTrackResult(raw) as any;
    expect(out.recipientInformation.address).toEqual({ city: 'SANTANDER', countryCode: 'ES' });
    expect(out.deliveryDetails.deliveryAttempts).toBe('0');
    expect(out.scanEvents).toEqual([{ eventType: 'DL' }]);
  });

  it('does not reach back into the object it was given', () => {
    const original = { deliveryDetails: { receivedByName: 'A.GUSTIN' } };
    redactTrackResult(original);
    expect(original.deliveryDetails.receivedByName).toBe('A.GUSTIN');
  });

  it('is null for anything that is not a result', () => {
    expect(redactTrackResult(null)).toBeNull();
    expect(redactTrackResult('nope')).toBeNull();
  });
});

describe('trackStages', () => {
  const scan = (eventType: string, at: string): any => ({ at, eventType, code: '', description: '', city: null, countryCode: null, exceptionCode: null, exceptionDescription: null });

  it('dates each stage from the first scan that reached it', () => {
    const stages = trackStages([
      scan('DL', '2026-09-03T16:18:00+02:00'),
      scan('OD', '2026-09-03T11:16:00+02:00'),
      scan('AR', '2026-09-02T09:35:00+02:00'),
      scan('IT', '2026-09-01T01:01:00+02:00'),
      scan('PU', '2026-08-27T11:17:00+03:00'),
      scan('IN', '2026-08-27T08:00:00+03:00'),
    ], '2026-09-03T16:18:00+02:00');
    expect(stages.map((s) => [s.key, s.at?.slice(0, 10), s.done])).toEqual([
      ['label', '2026-08-27', true],
      ['collected', '2026-08-27', true],
      ['transit', '2026-09-01', true],
      ['out_for_delivery', '2026-09-03', true],
      ['delivered', '2026-09-03', true],
    ]);
  });

  /**
   * The rule that keeps the timeline honest for parcels tracked before the raw event type was
   * stored: fewer dates, not a delivered parcel that apparently never left.
   */
  it('marks a stage done without a date when a later one happened', () => {
    const stages = trackStages([scan('DL', '2026-09-03T16:18:00Z')], '2026-09-03T16:18:00Z');
    expect(stages.every((s) => s.done)).toBe(true);
    expect(stages.find((s) => s.key === 'out_for_delivery')!.at).toBeNull();
  });

  it('leaves the stages ahead of the parcel pending', () => {
    const stages = trackStages([scan('PU', '2026-09-07T09:00:00Z'), scan('IN', '2026-09-07T08:00:00Z')]);
    expect(stages.map((s) => s.done)).toEqual([true, true, false, false, false]);
  });

  it('falls back to the derived code when no raw event type was stored', () => {
    const old = { at: '2026-09-01T10:00:00Z', eventType: '', code: 'PU', description: '', city: null, countryCode: null, exceptionCode: null, exceptionDescription: null };
    expect(trackStages([old]).find((s) => s.key === 'collected')!.at).toBe('2026-09-01T10:00:00Z');
  });

  /**
   * The bug this test exists for: every scan carries the offset of where it happened, so comparing
   * the strings put a Cyprus pickup at 08:14+03:00 AFTER a hub departure at 05:36+00:00 that really
   * came later — a parcel in transit before it was collected.
   */
  it('orders stages by instant, not by the text of the timestamp', () => {
    const stages = trackStages([
      scan('DP', '2026-08-05T05:36:00+00:00'),
      scan('PU', '2026-08-05T08:14:00+03:00'),
    ]);
    const collected = stages.find((s) => s.key === 'collected')!;
    const transit = stages.find((s) => s.key === 'transit')!;
    expect(Date.parse(collected.at!)).toBeLessThan(Date.parse(transit.at!));
  });

  /** The scan keeps the offset of the place it happened; the stored column has lost it. */
  it('dates delivery from the scan rather than the stored timestamp', () => {
    const stages = trackStages([scan('DL', '2026-09-03T16:18:00+02:00')], '2026-09-03T14:18:00.000Z');
    expect(stages.find((s) => s.key === 'delivered')!.at).toBe('2026-09-03T16:18:00+02:00');
  });

  it('has nothing done for a parcel with no scans at all', () => {
    expect(trackStages([])).toHaveLength(5);
    expect(trackStages([]).some((s) => s.done)).toBe(false);
  });
});

describe('deliveryPromise', () => {
  /**
   * What our own delivered shipments actually look like: 64 of 69 carry the published transit
   * commitment and none carry a live estimate, because FedEx drops the estimate once a parcel
   * arrives. So the commitment is what a delivered parcel gets measured against.
   */
  it('reads the published commitment and marks a late delivery', () => {
    const p = deliveryPromise(
      { standardTransitTimeWindow: { window: { ends: '2026-09-02T20:00:00+02:00' } } },
      null,
      '2026-09-03T16:18:00+02:00',
    );
    expect(p.source).toBe('commitment');
    expect(p.at).toBe('2026-09-02T20:00:00+02:00');
    expect(p.late).toBe(true);
  });

  it('does not call an on-time delivery late', () => {
    const p = deliveryPromise(
      { standardTransitTimeWindow: { window: { ends: '2026-09-03T20:00:00+02:00' } } },
      null,
      '2026-09-03T16:18:00+02:00',
    );
    expect(p.late).toBe(false);
  });

  /** A parcel promised by 20:00 in Spain and delivered at 19:00 in Cyprus was late. */
  it('compares instants rather than clocks', () => {
    const p = deliveryPromise(
      { standardTransitTimeWindow: { window: { ends: '2026-09-03T20:00:00+02:00' } } },
      null,
      '2026-09-03T21:00:00+03:00',
    );
    expect(p.late).toBe(false);
    expect(deliveryPromise(
      { standardTransitTimeWindow: { window: { ends: '2026-09-03T20:00:00+02:00' } } },
      null,
      '2026-09-03T22:00:00+03:00',
    ).late).toBe(true);
  });

  /**
   * The distinction the type exists for: a live estimate is about THIS parcel, a commitment is
   * about the lane. Confusing them has somebody chasing a parcel that is exactly where the service
   * said it would be.
   */
  it('prefers the live estimate over the lane commitment while a parcel is moving', () => {
    const p = deliveryPromise({
      dateAndTimes: [{ type: 'ESTIMATED_DELIVERY', dateTime: '2026-09-09T12:00:00+02:00' }],
      standardTransitTimeWindow: { window: { ends: '2026-09-08T20:00:00+02:00' } },
    }, null, null);
    expect(p.source).toBe('estimate');
    expect(p.at).toBe('2026-09-09T12:00:00+02:00');
  });

  it('carries the window start when FedEx gives a range rather than a time', () => {
    const p = deliveryPromise({
      estimatedDeliveryTimeWindow: { window: { begins: '2026-09-09T09:00:00+02:00', ends: '2026-09-09T13:00:00+02:00' } },
    }, null, null);
    expect(p.source).toBe('estimate');
    expect(p.from).toBe('2026-09-09T09:00:00+02:00');
    expect(p.at).toBe('2026-09-09T13:00:00+02:00');
  });

  /**
   * Null, not false. A screen that reads a missing answer as "on time" would report every parcel
   * we cannot track as having met a promise nobody made.
   */
  it('says nothing about lateness when either date is missing', () => {
    expect(deliveryPromise({}, null, '2026-09-03T16:18:00+02:00').late).toBeNull();
    expect(deliveryPromise({ standardTransitTimeWindow: { window: { ends: '2026-09-03T20:00:00+02:00' } } }, null, null).late).toBeNull();
  });

  it('falls back to the stored estimate when the reply predates keeping the full details', () => {
    const p = deliveryPromise(null, '2026-09-03T20:00:00+02:00', null);
    expect(p.at).toBe('2026-09-03T20:00:00+02:00');
    expect(p.source).toBe('commitment');
  });
});

describe('statusPill', () => {
  const stages = (...done: string[]) =>
    (['label', 'collected', 'transit', 'out_for_delivery', 'delivered'] as const).map((key) => ({
      key, label: key, at: done.includes(key) ? '2026-09-03T10:00:00Z' : null, done: done.includes(key),
    }));

  it('says Delivered, in green, once it has arrived', () => {
    expect(statusPill({ statusCode: 'DL', statusDescription: 'Delivered', deliveredAt: '2026-09-03T16:18:00+02:00', exceptionDescription: null, stages: stages('label', 'collected', 'transit', 'out_for_delivery', 'delivered') }))
      .toEqual({ tone: 'green', label: 'Delivered' });
  });

  /**
   * Two thirds of our delivered parcels carry a customs-hold scan somewhere in their history. None
   * of them are a problem once they have arrived, so delivered has to outrank the exception.
   */
  it('does not flag a delivered parcel over an exception it got past', () => {
    expect(statusPill({ statusCode: 'DL', statusDescription: 'Delivered', deliveredAt: '2026-09-03T16:18:00+02:00', exceptionDescription: 'Package available for clearance', stages: stages('label', 'collected', 'transit', 'delivered') }).tone)
      .toBe('green');
  });

  /** Held up: the useful label is the carrier's reason, not "In transit". */
  it('carries the reason as the label when a parcel is held', () => {
    expect(statusPill({ statusCode: 'IT', statusDescription: 'In transit', deliveredAt: null, exceptionDescription: 'Customer not available or business closed', stages: stages('label', 'collected', 'transit') }))
      .toEqual({ tone: 'warning', label: 'Customer not available or business closed' });
  });

  /**
   * The case the derived status code cannot answer: FedEx collapses the van scan into IT along with
   * everything else that moves, so this has to come from the stages.
   */
  it('says Out for delivery from the stages, not the status code', () => {
    expect(statusPill({ statusCode: 'IT', statusDescription: 'In transit', deliveredAt: null, exceptionDescription: null, stages: stages('label', 'collected', 'transit', 'out_for_delivery') }))
      .toEqual({ tone: 'teal', label: 'Out for delivery' });
  });

  it('says On the way once collected', () => {
    expect(statusPill({ statusCode: 'IT', statusDescription: 'In transit', deliveredAt: null, exceptionDescription: null, stages: stages('label', 'collected', 'transit') }))
      .toEqual({ tone: 'teal', label: 'On the way' });
  });

  it('says Label created before the carrier has it', () => {
    expect(statusPill({ statusCode: 'OC', statusDescription: 'Shipment information sent to FedEx', deliveredAt: null, exceptionDescription: null, stages: stages('label') }))
      .toEqual({ tone: 'neutral', label: 'Label created' });
  });

  it('says Cancelled', () => {
    expect(statusPill({ statusCode: 'CA', statusDescription: 'Cancelled', deliveredAt: null, exceptionDescription: null, stages: stages() }).label).toBe('Cancelled');
  });

  /** A code we do not recognise: the carrier's own wording beats a wrong guess of ours. */
  it('falls back to the carrier wording rather than inventing a status', () => {
    expect(statusPill({ statusCode: 'ZZ', statusDescription: 'Held at customs pending payment', deliveredAt: null, exceptionDescription: null, stages: stages() }))
      .toEqual({ tone: 'neutral', label: 'Held at customs pending payment' });
  });
});

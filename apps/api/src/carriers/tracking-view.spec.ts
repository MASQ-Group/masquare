import { describe, expect, it } from 'vitest';
import { trackingView, type TrackableShipment } from './tracking-view';

const scan = (at: string, code: string, eventType: string, description: string) => ({
  at, code, eventType, description, city: 'Nicosia', countryCode: 'CY',
  exceptionCode: null, exceptionDescription: null,
});

const shipment = (over: Partial<TrackableShipment> = {}): TrackableShipment => ({
  id: 'ship-1',
  trackingNumber: '794658123456',
  shippingService: { name: 'FedEx', alias: 'fedex', trackingUrlTemplate: 'https://www.fedex.com/fedextrack/?trknbr={tracking}' },
  tracking: {
    trackingNumber: '794658123456',
    statusCode: 'IT',
    statusDescription: 'In transit',
    deliveredAt: null,
    estimatedDeliveryAt: '2026-09-20T10:00:00Z',
    lastScanAt: '2026-09-18T08:00:00Z',
    lastScanDescription: 'At local FedEx facility',
    lastScanLocation: 'Nicosia',
    exceptionCode: null,
    exceptionDescription: null,
    checkedAt: '2026-09-18T09:00:00Z',
    found: true,
    shippedAt: '2026-09-17T10:00:00Z',
    serviceName: 'FedEx International Priority',
    shipperReference: 'CB-2026-09-0001',
    scans: [scan('2026-09-17T10:00:00Z', 'PU', 'PU', 'Picked up'), scan('2026-09-18T08:00:00Z', 'IT', 'AR', 'Arrived at FedEx location')],
    // Ours, all three.
    detailsJson: { shipperAccount: '510087720', recipient: { streetLines: ['5 Makariou'] } },
    lastError: 'FedEx returned 401 for account 510087720',
    failureCount: 3,
  },
  ...over,
});

describe('what a customer is shown', () => {
  const view = trackingView(shipment(), 'customer');

  it('never carries the raw carrier reply, whatever is in it', () => {
    // It is FedEx's answer to OUR account and has our account's details in it.
    expect(view.tracking!.detailsJson).toBeNull();
  });

  it('never carries our own errors or failure counts', () => {
    // These are about our integration, not their parcel.
    expect(view.tracking!.lastError).toBeNull();
    expect(view.tracking!.failureCount).toBe(0);
  });

  it('carries nothing of ours anywhere in the response, by any name', () => {
    // The blunt check: the account number and the error text must not appear at all.
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('510087720');
    expect(serialised).not.toContain('FedEx returned 401');
  });

  it('shows them everything about their own parcel', () => {
    expect(view.tracking).toMatchObject({
      statusDescription: 'In transit',
      lastScanDescription: 'At local FedEx facility',
      lastScanLocation: 'Nicosia',
      shipperReference: 'CB-2026-09-0001',
    });
    expect(view.tracking!.scans).toHaveLength(2);
  });

  it('gives them the same journey and the same words as we see', () => {
    const staff = trackingView(shipment(), 'staff');
    expect(view.stages).toEqual(staff.stages);
    expect(view.pill).toEqual(staff.pill);
    expect(view.stages.length).toBeGreaterThan(0);
  });

  it('links the tracking number to the carrier', () => {
    expect(view.trackingUrl).toBe('https://www.fedex.com/fedextrack/?trknbr=794658123456');
    expect(view.trackable).toBe(true);
  });
});

describe('what we are shown', () => {
  it('keeps the diagnostics — that is what they are for', () => {
    const view = trackingView(shipment(), 'staff');
    expect(view.tracking.detailsJson).not.toBeNull();
    expect(view.tracking.failureCount).toBe(3);
  });

  it('is the default, so a new caller does not quietly get the customer version', () => {
    expect(trackingView(shipment()).tracking.failureCount).toBe(3);
  });
});

describe('a shipment with nothing to say yet', () => {
  it('has no journey and no status when nobody has asked the carrier', () => {
    const view = trackingView(shipment({ tracking: null }), 'customer');
    expect(view.tracking).toBeNull();
    expect(view.stages).toEqual([]);
    expect(view.pill).toBeNull();
    expect(view.promise).toBeNull();
  });

  it('says nothing rather than guessing when the carrier does not recognise the number', () => {
    const view = trackingView(shipment({ tracking: { ...shipment().tracking, found: false } }), 'customer');
    expect(view.stages).toEqual([]);
    expect(view.pill).toBeNull();
  });

  it('offers no link when the service has no template', () => {
    const view = trackingView(shipment({ shippingService: { name: 'TNT', alias: null, trackingUrlTemplate: null } }), 'customer');
    expect(view.trackingUrl).toBeNull();
    expect(view.carrierUrl).toBeNull();
    expect(view.trackable).toBe(false);
  });
});

import { buildTrackingUrl, carrierSiteUrl } from './tracking-url';
import { isFedexService } from './fedex-track';
import { deliveryPromise, statusPill, trackStages, type TrackScan } from './fedex-track-parse';

/**
 * One parcel's tracking, as a screen wants it.
 *
 * The journey, the one-line status and the delivery promise are all derived here rather than in a
 * browser, so every surface showing a parcel reads the same journey from the same tested rule — the
 * shipments log, the order summary, the order form, and now the customer's own portal.
 *
 * Its own module because two services need it and neither owns it. It was private to the carriers
 * service until a customer needed to see what we see; copying it would have meant two journeys that
 * agree today and diverge the first time either is corrected.
 *
 * PURE.
 */

/**
 * Who is going to read this.
 *
 * `staff` gets the whole tracking row, diagnostics included: the raw carrier reply we keep because
 * FedEx drops a parcel's history ninety days after delivery, the last error, how many times asking
 * has failed. Those exist to help whoever is chasing a parcel on our side.
 *
 * `customer` gets the same journey with none of that. The raw reply is the carrier's answer to OUR
 * account and has our account's details in it; the failure count and last error are about our
 * integration, not their parcel. Naming the audience makes leaving them in a decision somebody has
 * to take rather than something that happens by forgetting.
 */
export type TrackingAudience = 'staff' | 'customer';

/** What a customer is shown of the stored tracking row. Everything here is about their parcel. */
export interface CustomerTrackingRow {
  trackingNumber: string;
  statusCode: string | null;
  statusDescription: string | null;
  deliveredAt: Date | string | null;
  estimatedDeliveryAt: Date | string | null;
  lastScanAt: Date | string | null;
  lastScanDescription: string | null;
  lastScanLocation: string | null;
  exceptionCode: string | null;
  exceptionDescription: string | null;
  checkedAt: Date | string | null;
  found: boolean | null;
  shippedAt: Date | string | null;
  serviceName: string | null;
  shipperReference: string | null;
  scans: TrackScan[] | null;
  /** Always null for a customer. Present so the shape the screen reads does not change. */
  detailsJson: null;
  lastError: null;
  failureCount: 0;
}

export interface TrackableShipment {
  id: string;
  trackingNumber: string | null;
  shippingService?: { name: string | null; alias?: string | null; trackingUrlTemplate?: string | null } | null;
  tracking: any;
}

/** Strip a stored tracking row down to the parcel, leaving our own diagnostics behind. */
function forCustomer(t: any): CustomerTrackingRow {
  return {
    trackingNumber: t.trackingNumber,
    statusCode: t.statusCode ?? null,
    statusDescription: t.statusDescription ?? null,
    deliveredAt: t.deliveredAt ?? null,
    estimatedDeliveryAt: t.estimatedDeliveryAt ?? null,
    lastScanAt: t.lastScanAt ?? null,
    lastScanDescription: t.lastScanDescription ?? null,
    lastScanLocation: t.lastScanLocation ?? null,
    exceptionCode: t.exceptionCode ?? null,
    exceptionDescription: t.exceptionDescription ?? null,
    checkedAt: t.checkedAt ?? null,
    found: t.found ?? null,
    shippedAt: t.shippedAt ?? null,
    serviceName: t.serviceName ?? null,
    shipperReference: t.shipperReference ?? null,
    scans: Array.isArray(t.scans) ? t.scans : null,
    detailsJson: null,
    lastError: null,
    failureCount: 0,
  };
}

export function trackingView(shipment: TrackableShipment, audience: TrackingAudience = 'staff') {
  const t = shipment.tracking ?? null;
  const scans = (Array.isArray(t?.scans) ? t.scans : []) as TrackScan[];
  const stages = t && t.found !== false
    ? trackStages(scans, t.deliveredAt ? new Date(t.deliveredAt).toISOString() : null)
    : [];

  return {
    shipmentId: shipment.id,
    trackingNumber: shipment.trackingNumber,
    /** Who is carrying it, as our people named the service. Shown beside the number. */
    carrier: shipment.shippingService?.name ?? null,
    /**
     * The carrier's own public tracking page for this number.
     *
     * Built from the shipping service's template rather than hardcoded, because that column already
     * exists for exactly this and every courier has a different URL. Null when no template is set,
     * and the screen then shows the number as plain text rather than a link that goes nowhere.
     */
    trackingUrl: buildTrackingUrl(shipment.shippingService?.trackingUrlTemplate, shipment.trackingNumber),
    /**
     * The carrier's tracking PAGE, for couriers whose results cannot be linked to at all.
     *
     * Separate from trackingUrl so a screen can be honest about which it is offering: one lands on
     * the parcel, the other on an empty form that needs the number pasted into it.
     */
    carrierUrl: carrierSiteUrl(shipment.shippingService?.trackingUrlTemplate),
    /** Whether this is a carrier we can ask at all — the screen offers no button when it is not. */
    trackable: isFedexService(shipment.shippingService?.name, shipment.shippingService?.alias),
    tracking: t ? (audience === 'customer' ? forCustomer(t) : t) : null,
    /** Collected → in transit → out for delivery → delivered. Empty when nobody has asked yet. */
    stages,
    /**
     * The one-line answer in our words, and the tone to say it in.
     *
     * Derived here rather than in the browser so that a screen never parses carrier strings — and
     * so the wording is the same one on every surface.
     */
    pill:
      t && t.found !== false
        ? statusPill({
          statusCode: t.statusCode,
          statusDescription: t.statusDescription,
          deliveredAt: t.deliveredAt ? new Date(t.deliveredAt).toISOString() : null,
          exceptionDescription: t.deliveredAt ? null : t.exceptionDescription,
          stages,
        })
        : null,
    /**
     * When the carrier said it would arrive, whether that was an estimate or a commitment, and
     * whether it was met. Derived here so the distinction is decided once, by a tested rule, rather
     * than three screens each having a go at it.
     */
    promise:
      t && t.found !== false
        ? deliveryPromise(
          t.detailsJson ?? null,
          t.estimatedDeliveryAt ? new Date(t.estimatedDeliveryAt).toISOString() : null,
          t.deliveredAt ? new Date(t.deliveredAt).toISOString() : null,
        )
        : null,
  };
}

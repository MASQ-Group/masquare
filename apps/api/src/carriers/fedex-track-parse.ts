/**
 * Reading a FedEx tracking reply.
 *
 * Written against a REAL response — three of our own parcels, to Spain, the UAE and Great Britain,
 * plus a deliberately bogus number to see what an unrecognised one looks like — and not against
 * documentation. That distinction has earned its keep on this integration twice already: the rate
 * mapper would have dropped a 46% fuel surcharge for reading `surcharges` when FedEx sends
 * `surCharges`, and the service catalogue carried the wrong enum until a live reply corrected it.
 *
 * The whole reply is kept — see `redactTrackResult` for the one thing that is not, and why.
 */

/** One scan, as we keep it: when, what, where, and what went wrong if anything did. */
export interface TrackScan {
  at: string;
  /**
   * The NORMALISED status of the scan — FedEx's `derivedStatusCode`.
   *
   * Right for reading a status, wrong for reading a journey: it collapses arrivals, departures and
   * "on the vehicle for delivery" all into IT. Across our own history that is 883 scans of nine
   * different meanings sharing one code.
   */
  code: string;
  /**
   * The RAW scan type — FedEx's `eventType`. PU picked up, AR arrived, DP departed, OD out for
   * delivery, DL delivered. Kept alongside the derived code because it is the only thing that says
   * a parcel is on the van today, which is the one stage a customer actually asks about.
   */
  eventType: string;
  description: string;
  city: string | null;
  countryCode: string | null;
  exceptionCode: string | null;
  exceptionDescription: string | null;
}

export interface TrackResult {
  trackingNumber: string;
  /** False when FedEx does not recognise the number — see `errorCode`. */
  found: boolean;
  errorCode: string | null;
  errorMessage: string | null;

  /** FedEx's own status code and their own wording for it. We do not keep a second vocabulary. */
  statusCode: string | null;
  statusDescription: string | null;

  deliveredAt: string | null;
  estimatedDeliveryAt: string | null;
  shippedAt: string | null;

  /** The most recent scan, which is what a screen can show without opening anything. */
  lastScanAt: string | null;
  lastScanDescription: string | null;
  lastScanLocation: string | null;

  /**
   * The latest scan that reported a problem, kept apart from the last scan.
   *
   * "Customer not available or business closed" is the whole reason somebody opens a tracking
   * screen, and it is invisible in the status: our Santander parcel read "In transit" for a day
   * after that exception and was delivered in the end. An exception that has scrolled off the top
   * of the history is one nobody acts on.
   */
  exceptionCode: string | null;
  exceptionDescription: string | null;

  serviceName: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;

  /**
   * What FedEx weighed the parcel at.
   *
   * Worth keeping: it is a measurement of the real box by somebody with no interest in our
   * estimate, and it is the figure they billed on. A parcel we quoted at 12kg and FedEx weighed at
   * 18.9kg explains an invoice before anybody has to ask.
   */
  weightKg: number | null;

  /**
   * The reference printed on the waybill, as FedEx holds it — for our Amazon shipments, the order
   * id. It is the §8 invoice join key seen from the other side, and it is what can say whether the
   * number recorded against a shipment really belongs to that order.
   */
  shipperReference: string | null;

  scans: TrackScan[];

  /**
   * The rest of what FedEx sent, whole, minus the people in it.
   *
   * Kept because it is the only copy that will ever exist. FedEx drops a shipment's history ninety
   * days after delivery; past that, what we stored IS the record. It costs a few kilobytes and it
   * carries everything the named fields above leave behind — packaging, dimensions, delivery
   * attempts, special handling, the transit commitment, the facilities it passed through.
   */
  details: unknown;
}

/**
 * The reply, minus the people in it.
 *
 * Two things go, and nothing else:
 *
 *  - `deliveryDetails.receivedByName` — who signed. Genuinely personal, of no use to us, and
 *    available in the FedEx portal on demand for the rare case where a delivery is disputed. That
 *    is the right home for it: theirs, under their retention, rather than a second copy under ours.
 *  - the `contact` blocks on the shipper and recipient — a person's name and telephone number.
 *    Ours is no loss. The customer's is already held once, on the delivery address, under a
 *    twelve-month retention policy with a purge behind it; a second copy inside a tracking blob
 *    would sit outside that policy and quietly outlive it.
 *
 * Addresses stay. A city, a postcode and a country describe where a parcel went, which is the
 * subject of the record, and they are on the waybill either way.
 */
export function redactTrackResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return null;
  // A structured clone, so redacting never reaches back into the caller's object.
  const copy = JSON.parse(JSON.stringify(result));
  if (copy.deliveryDetails && typeof copy.deliveryDetails === 'object') delete copy.deliveryDetails.receivedByName;
  for (const party of ['shipperInformation', 'recipientInformation', 'lastUpdatedDestinationAddress']) {
    if (copy[party] && typeof copy[party] === 'object') delete copy[party].contact;
  }
  return copy;
}

/** One step of the journey, as somebody following a parcel thinks of it. */
export interface TrackStage {
  key: 'label' | 'collected' | 'transit' | 'out_for_delivery' | 'delivered';
  label: string;
  /** When it happened. Null means it has not — or that FedEx never scanned it separately. */
  at: string | null;
  /** Reached. True without a date where a LATER stage has one: the parcel plainly got past it. */
  done: boolean;
}

const STAGE_EVENTS: Array<{ key: TrackStage['key']; label: string; events: string[] }> = [
  { key: 'label', label: 'Label created', events: ['OC', 'IN'] },
  { key: 'collected', label: 'Collected', events: ['PU', 'DR'] },
  // DP is a DEPARTURE from a FedEx facility, not a collection from us — it belongs here rather than
  // above, where it would date the pickup as whenever the parcel left the origin hub.
  { key: 'transit', label: 'In transit', events: ['IT', 'AR', 'DP', 'AF', 'CC', 'TR'] },
  { key: 'out_for_delivery', label: 'Out for delivery', events: ['OD'] },
  { key: 'delivered', label: 'Delivered', events: ['DL'] },
];

/**
 * The journey, in five steps, from the scan history.
 *
 * Read from the RAW eventType rather than the derived status, because the derived status cannot
 * tell these apart: across our own shipments, 883 scans carry the code IT and they mean everything
 * from "left the origin facility" to "on the vehicle for delivery".
 *
 * A stage with no scan of its own is still marked done when a later one happened — a delivered
 * parcel was certainly out for delivery, whatever FedEx chose to scan. That also keeps the timeline
 * honest for parcels tracked before this platform kept the raw event type: they show fewer dates,
 * not a delivered parcel that never left.
 */
export function trackStages(scans: TrackScan[], deliveredAt: string | null = null): TrackStage[] {
  const earliest = (events: string[]): string | null => {
    const hits = scans
      .filter((s) => events.includes((s.eventType || s.code || '').toUpperCase()))
      .sort((a, b) => instant(a.at) - instant(b.at));
    return hits[0]?.at ?? null;
  };

  const dated = STAGE_EVENTS.map((stage) => ({
    key: stage.key,
    label: stage.label,
    /**
     * The delivery SCAN before the stored delivery date, though they are the same event.
     *
     * The scan still carries the offset of the place it happened; the stored column is a timestamp
     * that lost it. Taking the scan is what lets a timeline say the parcel arrived at 16:18, which
     * is what the driver's watch said and what the customer will quote back at us.
     */
    at: earliest(stage.events) ?? (stage.key === 'delivered' ? deliveredAt : null),
  }));

  // Walk backwards so "a later stage happened" is known before deciding this one.
  let laterHappened = false;
  const out: TrackStage[] = [];
  for (let i = dated.length - 1; i >= 0; i -= 1) {
    const at = dated[i].at;
    out.unshift({ ...dated[i], done: at != null || laterHappened });
    if (at != null) laterHappened = true;
  }
  return out;
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
  return s === '' ? null : s;
};

function dateOfType(dateAndTimes: unknown, type: string): string | null {
  if (!Array.isArray(dateAndTimes)) return null;
  const hit = dateAndTimes.find((d: any) => d?.type === type);
  return str(hit?.dateTime);
}

/** Milliseconds since the epoch. Every FedEx timestamp carries its own offset, so text never sorts. */
const instant = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

function scansOf(raw: unknown): TrackScan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e: any) => ({
      at: str(e?.date) ?? '',
      code: str(e?.derivedStatusCode) ?? str(e?.eventType) ?? '',
      eventType: str(e?.eventType) ?? '',
      description: str(e?.eventDescription) ?? str(e?.derivedStatus) ?? '',
      city: str(e?.scanLocation?.city),
      countryCode: str(e?.scanLocation?.countryCode),
      exceptionCode: str(e?.exceptionCode),
      exceptionDescription: str(e?.exceptionDescription),
    }))
    .filter((s) => s.at)
    /**
     * Newest first, by INSTANT rather than by string.
     *
     * Every scan carries the offset of the place it happened, so the text does not sort: a Cyprus
     * pickup at 08:14+03:00 reads as later than a hub departure at 05:36+00:00 that actually came
     * after it. Comparing the strings put a parcel in transit before it was collected.
     *
     * FedEx does send them newest first, but a history that silently reversed would put a week-old
     * scan on screen as the latest news, which is worse than no news at all.
     */
    .sort((a, b) => instant(b.at) - instant(a.at));
}

function weightKgOf(result: any): number | null {
  const lists = [result?.shipmentDetails?.weight, result?.packageDetails?.weightAndDimensions?.weight];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const kg = list.find((w: any) => String(w?.unit ?? '').toUpperCase() === 'KG');
    const n = Number(kg?.value);
    // A zero is FedEx saying nothing rather than saying nought, and a parcel weighing nothing is
    // not a fact worth recording against a shipment.
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function shipperReferenceOf(result: any): string | null {
  const ids = result?.additionalTrackingInfo?.packageIdentifiers;
  if (!Array.isArray(ids)) return null;
  const hit = ids.find((i: any) => i?.type === 'SHIPPER_REFERENCE');
  const values = Array.isArray(hit?.values) ? hit.values : [];
  return str(values[0]);
}

function readOne(trackingNumber: string, result: any): TrackResult {
  const base: TrackResult = {
    trackingNumber,
    found: true,
    errorCode: null, errorMessage: null,
    statusCode: null, statusDescription: null,
    deliveredAt: null, estimatedDeliveryAt: null, shippedAt: null,
    lastScanAt: null, lastScanDescription: null, lastScanLocation: null,
    exceptionCode: null, exceptionDescription: null,
    serviceName: null, destinationCity: null, destinationCountry: null,
    weightKg: null, shipperReference: null, scans: [], details: null,
  };

  /**
   * An unrecognised number arrives inside a 200, not as a failed call.
   *
   * TRACKING.TRACKINGNUMBER.NOTFOUND against one number in a batch of thirty says nothing about
   * the other twenty-nine, which is why this is read per result and not per response.
   */
  if (result?.error) {
    return {
      ...base,
      found: false,
      errorCode: str(result.error?.code),
      errorMessage: str(result.error?.message),
    };
  }

  const scans = scansOf(result?.scanEvents);
  const latest = scans[0] ?? null;
  const exception = scans.find((s) => s.exceptionCode) ?? null;
  const latestPlace = latest ? [latest.city, latest.countryCode].filter(Boolean).join(', ') : '';

  return {
    ...base,
    statusCode: str(result?.latestStatusDetail?.derivedCode) ?? str(result?.latestStatusDetail?.code),
    statusDescription:
      str(result?.latestStatusDetail?.statusByLocale) ?? str(result?.latestStatusDetail?.description),

    deliveredAt: dateOfType(result?.dateAndTimes, 'ACTUAL_DELIVERY'),
    /**
     * Three sources, in decreasing order of how much FedEx is committing to.
     *
     * ESTIMATED_DELIVERY is their live estimate; standardTransitTimeWindow is the service's
     * published commitment; estimatedDeliveryTimeWindow is a window that is frequently present and
     * empty. A delivered parcel carries none of them, which is correct — by then the actual date
     * is the answer.
     */
    estimatedDeliveryAt:
      dateOfType(result?.dateAndTimes, 'ESTIMATED_DELIVERY') ??
      str(result?.standardTransitTimeWindow?.window?.ends) ??
      str(result?.estimatedDeliveryTimeWindow?.window?.ends),
    // What FedEx actually collected, ahead of what the label said. A label printed on Tuesday for a
    // parcel collected on Thursday should read as Thursday.
    shippedAt: dateOfType(result?.dateAndTimes, 'ACTUAL_PICKUP') ?? dateOfType(result?.dateAndTimes, 'SHIP'),

    lastScanAt: latest?.at ?? null,
    lastScanDescription: latest?.description ?? null,
    lastScanLocation: latestPlace || null,

    exceptionCode: exception?.exceptionCode ?? null,
    exceptionDescription: exception?.exceptionDescription ?? null,

    serviceName: str(result?.serviceDetail?.description) ?? str(result?.serviceDetail?.type),
    destinationCity: str(result?.recipientInformation?.address?.city),
    destinationCountry: str(result?.recipientInformation?.address?.countryCode),

    weightKg: weightKgOf(result),
    shipperReference: shipperReferenceOf(result),
    scans,
    // Redacted here, at the single point where a reply becomes something we keep, so there is no
    // path by which the raw one reaches storage.
    details: redactTrackResult(result),
  };
}

/**
 * Read a whole reply into one result per tracking number.
 *
 * A number can come back with SEVERAL trackResults — FedEx reuses numbers after a period, so an old
 * one can be ambiguous. The one that is not an error wins: a match and a miss on the same number
 * means the match is the shipment and the miss is the reuse.
 */
export function parseTrackReply(body: unknown): TrackResult[] {
  const complete = (body as any)?.output?.completeTrackResults;
  if (!Array.isArray(complete)) return [];
  return complete
    .map((entry: any) => {
      const number = str(entry?.trackingNumber);
      if (!number) return null;
      const results = Array.isArray(entry?.trackResults) ? entry.trackResults : [];
      const usable = results.find((r: any) => !r?.error) ?? results[0] ?? null;
      return readOne(number, usable);
    })
    .filter((r): r is TrackResult => r != null);
}

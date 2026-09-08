/**
 * Building a FedEx Ship request, as pure logic.
 *
 * Field names and enums come from FedEx's own Ship API JSON collection (handoff/Ship APIResponse
 * JSONApiCollection) — 1,335 sample transactions across six endpoints. As with the rate collection,
 * many are deliberate negative cases: `RECIPIENii` appears as a dutiesPayment type. Nothing here was
 * seeded by harvesting every value that appears.
 *
 * Booking is the point of no return in this integration. Rating is forgiving — a wrong quote is a
 * wrong number and can be asked for again. A booking creates a real label, a real tracking number
 * and a real charge, and FedEx will not tell us afterwards what we shipped (handoff §2.2). Whatever
 * is not recorded at creation is gone.
 */

export const SHIP_PATH = '/ship/v1/shipments';
export const SHIP_CANCEL_PATH = '/ship/v1/shipments/cancel';
export const SHIP_VALIDATE_PATH = '/ship/v1/shipments/packages/validate';

export interface ShipContact {
  personName: string | null;
  companyName?: string | null;
  phoneNumber?: string | null;
}

export interface ShipAddress {
  streetLines: string[];
  city: string | null;
  stateOrProvinceCode?: string | null;
  postalCode: string | null;
  countryCode: string | null;
  residential?: boolean | null;
}

export interface ShipParty {
  contact: ShipContact;
  address: ShipAddress;
  /**
   * Tax identifiers. `{ tinType, number }`, per the collection.
   *
   * NOTE: the correct `tinType` for an EU EORI is NOT confirmed. The word EORI does not appear once
   * in 6MB of FedEx's own samples, and the types they do show are BUSINESS_NATIONAL, BUSINESS_STATE,
   * BUSINESS_UNION and PERSONAL_STATE. The caller supplies the type rather than this file guessing
   * one — see EORI_TIN_TYPE below for the working assumption and why it is only that.
   */
  tins?: Array<{ tinType: string; number: string }>;
}

export interface ShipCommodity {
  name: string;
  description: string;
  countryOfManufacture: string | null;
  harmonizedCode: string | null;
  quantity: number;
  unitPriceAmount: number;
  customsValueAmount: number;
  currency: string;
  weightKg: number;
}

export interface ShipParcel {
  weightKg: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  declaredValue?: { amount: number; currency: string } | null;
}

export interface ShipRequestInput {
  accountNumber: string;
  shipper: ShipParty;
  recipient: ShipParty;
  serviceType: string;
  /** ISO date, `2026-09-09`. FedEx rejects a date in the past. */
  shipDate: string;
  parcels: ShipParcel[];
  /**
   * Our own reference, which comes back on the invoice file.
   *
   * §8 of the handoff: the reference we send at label time is the ONLY join between a FedEx charge
   * and a maSquare order. FedEx has no other handle on it. Required, not optional, because a
   * shipment booked without one cannot be reconciled afterwards by any means.
   */
  customerReference: string;
  /**
   * Who pays duties and taxes at the border.
   *
   * Required and deliberately not defaulted. This is the Amazon AE case from the shipment-rules
   * note: an order placed on a marketplace that forbids charging the buyer at delivery must ship
   * duty-paid, and the failure mode is a person forgetting on the fortieth shipment of the day.
   * Making it a required field means the decision cannot be skipped — only made.
   *
   * 'sender' is DDP (we pay); 'recipient' is DAP (the buyer is billed on delivery).
   */
  dutiesPaidBy: 'sender' | 'recipient';
  /** Only for shipments leaving the customs area. */
  commodities?: ShipCommodity[];
  goodsDescription?: string | null;
  /** PDF for laser stock, ZPLII for a thermal printer. */
  labelImageType?: 'PDF' | 'PNG' | 'ZPLII';
  labelStockType?: string;
}

/**
 * The TIN type we send an EORI under, and an admission that it is unverified.
 *
 * FedEx's collection never shows one. BUSINESS_NATIONAL is the closest fit among the types they do
 * show — a national trader identifier — but it is an inference, not a fact.
 *
 * Sent anyway rather than omitted: a missing recipient EORI on a business shipment leaving the EU
 * causes 24–72 hour customs holds (handoff §5.2), which is a certain harm, against the uncertain
 * one of a type FedEx may ignore. The first real booking will settle it, and it is on the open
 * questions list.
 */
export const EORI_TIN_TYPE = 'BUSINESS_NATIONAL';

/** What a booking cannot proceed without. Named, so a screen can say which. */
export function missingForBooking(input: Partial<ShipRequestInput>): string[] {
  const gaps: string[] = [];
  if (!input.accountNumber) gaps.push('carrier account');
  if (!input.serviceType) gaps.push('service');
  if (!input.customerReference) gaps.push('order reference');
  for (const [label, party] of [['ship-from', input.shipper], ['delivery', input.recipient]] as const) {
    const a = party?.address;
    if (!a?.streetLines?.length || !a.city || !a.postalCode || !a.countryCode) gaps.push(`${label} address`);
    if (!party?.contact?.personName) gaps.push(`${label} contact name`);
  }
  const parcels = input.parcels ?? [];
  if (parcels.length === 0) gaps.push('at least one parcel');
  else if (parcels.some((p) => !(p.weightKg > 0))) gaps.push('a weight for every parcel');
  return [...new Set(gaps)];
}

/** FedEx rejects a dimension of zero; absent is fine. Rounded up — never quote a smaller box. */
const dim = (v: number | null | undefined): number | null => (typeof v === 'number' && v > 0 ? Math.ceil(v) : null);

const party = (p: ShipParty) => ({
  contact: {
    personName: p.contact.personName,
    ...(p.contact.companyName ? { companyName: p.contact.companyName } : {}),
    ...(p.contact.phoneNumber ? { phoneNumber: p.contact.phoneNumber } : {}),
  },
  address: {
    streetLines: p.address.streetLines.filter(Boolean).slice(0, 3),
    city: p.address.city,
    ...(p.address.stateOrProvinceCode ? { stateOrProvinceCode: p.address.stateOrProvinceCode } : {}),
    postalCode: p.address.postalCode,
    countryCode: (p.address.countryCode ?? '').toUpperCase(),
    ...(p.address.residential == null ? {} : { residential: p.address.residential }),
  },
  ...(p.tins?.length ? { tins: p.tins } : {}),
});

/**
 * The booking body FedEx expects.
 *
 * `labelResponseOptions: 'LABEL'` returns the label encoded in the reply. The alternative,
 * URL_ONLY, hands back a link that expires — and a label we cannot re-fetch is exactly the sort of
 * thing §2.2 warns about. We store the bytes.
 */
export function buildShipRequest(input: ShipRequestInput, opts: { customs: boolean }): Record<string, unknown> {
  const body: Record<string, any> = {
    labelResponseOptions: 'LABEL',
    accountNumber: { value: input.accountNumber },
    requestedShipment: {
      shipper: party(input.shipper),
      // An array in FedEx's schema even though a shipment has exactly one destination.
      recipients: [party(input.recipient)],
      shipDatestamp: input.shipDate,
      serviceType: input.serviceType,
      packagingType: 'YOUR_PACKAGING',
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      blockInsightVisibility: false,
      // We are the shipper and we pay the carriage. Anything else would be a different arrangement
      // with FedEx than the one this account has.
      shippingChargesPayment: {
        paymentType: 'SENDER',
        payor: { responsibleParty: { accountNumber: { value: input.accountNumber } } },
      },
      labelSpecification: {
        labelStockType: input.labelStockType ?? 'PAPER_4X6',
        imageType: input.labelImageType ?? 'PDF',
      },
      requestedPackageLineItems: input.parcels.map((p) => {
        const l = dim(p.lengthCm);
        const w = dim(p.widthCm);
        const h = dim(p.heightCm);
        return {
          /**
           * Our order reference, on every parcel.
           *
           * This is what comes back on the invoice file and joins a FedEx charge to a maSquare
           * order. Put on each package rather than only on the shipment, because the invoice
           * arrives one record per tracking number.
           */
          customerReferences: [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: input.customerReference }],
          weight: { units: 'KG', value: p.weightKg },
          ...(l && w && h ? { dimensions: { length: l, width: w, height: h, units: 'CM' } } : {}),
          ...(p.declaredValue ? { declaredValue: { amount: p.declaredValue.amount, currency: p.declaredValue.currency } } : {}),
          ...(input.goodsDescription ? { itemDescriptionForClearance: input.goodsDescription } : {}),
        };
      }),
    },
  };

  if (opts.customs) {
    body.requestedShipment.customsClearanceDetail = {
      commercialInvoice: { shipmentPurpose: 'SOLD' },
      /**
       * Who the border bills.
       *
       * SENDER is duty-paid: the charge lands on our FedEx account and belongs in the order's
       * profit. RECIPIENT means the buyer is billed on delivery, which several marketplaces forbid.
       */
      dutiesPayment: input.dutiesPaidBy === 'sender'
        ? { paymentType: 'SENDER', payor: { responsibleParty: { accountNumber: { value: input.accountNumber } } } }
        : { paymentType: 'RECIPIENT' },
      commodities: (input.commodities ?? []).map((c) => ({
        name: c.name,
        description: c.description,
        countryOfManufacture: c.countryOfManufacture,
        ...(c.harmonizedCode ? { harmonizedCode: c.harmonizedCode } : {}),
        quantity: c.quantity,
        quantityUnits: 'PCS',
        unitPrice: { amount: c.unitPriceAmount, currency: c.currency },
        customsValue: { amount: c.customsValueAmount, currency: c.currency },
        weight: { units: 'KG', value: c.weightKg },
      })),
    };
  }

  return body;
}

/** Cancelling a booked shipment. PUT, and it takes the tracking number back. */
export function buildCancelRequest(accountNumber: string, trackingNumber: string): Record<string, unknown> {
  return {
    accountNumber: { value: accountNumber },
    trackingNumber,
    deletionControl: 'DELETE_ALL_PACKAGES',
  };
}

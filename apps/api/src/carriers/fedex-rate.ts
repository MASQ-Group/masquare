/**
 * Building a FedEx rate request, as pure logic.
 *
 * Every field name and enum here was taken from FedEx's own JSON API collection for Rates and
 * Transit Times (handoff/Rates and Transit Times APIResponse JSONApiCollection), not from
 * documentation summaries or third-party listings — the handoff warns against those, and rightly.
 *
 * One caution about that file: 424 of its sample transactions include deliberate NEGATIVE cases,
 * with values like `DROPOFF_AT_FEDEX_LOCATI`, a country code of `FRz` and a rateRequestType of
 * `'null'`. Those exist to make the sandbox return errors. Nothing in this file was seeded by
 * harvesting every value that appears in the collection; the enums below are the ones that belong
 * to a Cyprus origin, cross-checked against §5.4 of the handoff.
 */

/** Where the goods leave from, and where they are going. Postcode and country is all a quote needs. */
export interface RateEndpoint {
  postalCode: string | null;
  countryIso: string | null;
  /** Residential deliveries are rated differently. Null means nobody has said. */
  residential?: boolean | null;
}

export interface RateParcel {
  weightKg: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

export interface RateQuoteInput {
  accountNumber: string;
  shipper: RateEndpoint;
  recipient: RateEndpoint;
  parcels: RateParcel[];
  /**
   * What the goods are worth, for the customs declaration on an international quote.
   *
   * Required by FedEx on a cross-border rate. Omitted on a domestic one, where there is no customs
   * clearance to describe.
   */
  customsValue?: { amount: number; currency: string } | null;
  goodsDescription?: string | null;
  /**
   * Ask for one service, or omit for every service available on the lane.
   *
   * Omitted is the useful default: 158 of FedEx's own samples leave it out, and the answer is the
   * full list of what actually runs between two postcodes — which is the question somebody choosing
   * a service is really asking.
   */
  serviceType?: string | null;
  /** The currency the quote should come back in. Ours is EUR; FedEx defaults to the origin's. */
  preferredCurrency?: string | null;
}

/**
 * Services sold from a Cyprus origin (handoff §5.4).
 *
 * FEDEX_GROUND, GROUND_HOME_DELIVERY, SMART_POST and FIRST_OVERNIGHT are US and Canada domestic
 * enums. They appear all over FedEx's samples and would be rejected from Cyprus, so they are
 * deliberately absent.
 *
 * FEDEX_REGIONAL_ECONOMY is absent too, for a different reason: whether it is available from Cyprus
 * is still an open question with FedEx (§11, question 3). Offering it before the answer arrives
 * would put a service on a screen that may simply error.
 */
export const CYPRUS_SERVICE_TYPES = [
  'INTERNATIONAL_FIRST',
  'FEDEX_INTERNATIONAL_PRIORITY_EXPRESS',
  'INTERNATIONAL_PRIORITY',
  'INTERNATIONAL_ECONOMY',
  'INTERNATIONAL_PRIORITY_FREIGHT',
  'INTERNATIONAL_ECONOMY_FREIGHT',
] as const;

/** Human labels for the services above. */
export const SERVICE_LABELS: Record<string, string> = {
  INTERNATIONAL_FIRST: 'International First',
  FEDEX_INTERNATIONAL_PRIORITY_EXPRESS: 'International Priority Express',
  INTERNATIONAL_PRIORITY: 'International Priority',
  INTERNATIONAL_ECONOMY: 'International Economy',
  INTERNATIONAL_PRIORITY_FREIGHT: 'International Priority Freight',
  INTERNATIONAL_ECONOMY_FREIGHT: 'International Economy Freight',
};

/** Endpoint path, confirmed from the collection. Major version in the path; minor never appears. */
export const RATE_PATH = '/rate/v1/rates/quotes';

/**
 * Whether this quote crosses a customs border.
 *
 * Cyprus is in the EU, so Cyprus→Germany is an intra-EU movement with no declaration, while
 * Cyprus→United Kingdom is an export. Getting this wrong in either direction is expensive: a
 * customs block on an intra-EU quote is noise, and its absence on an export is a rejected request.
 */
export function needsCustoms(shipperIso: string | null, recipientIso: string | null, euCountries: Set<string>): boolean {
  if (!shipperIso || !recipientIso) return false;
  const a = shipperIso.toUpperCase();
  const b = recipientIso.toUpperCase();
  if (a === b) return false;
  return !(euCountries.has(a) && euCountries.has(b));
}

/** What is missing before FedEx could quote this at all. Named, so a screen can say which. */
export function missingForQuote(input: Partial<RateQuoteInput>): string[] {
  const gaps: string[] = [];
  if (!input.accountNumber) gaps.push('account number');
  if (!input.shipper?.postalCode || !input.shipper?.countryIso) gaps.push('ship-from address');
  if (!input.recipient?.postalCode || !input.recipient?.countryIso) gaps.push('delivery address');
  const parcels = input.parcels ?? [];
  if (parcels.length === 0) gaps.push('parcel weight');
  else if (parcels.some((p) => !(p.weightKg > 0))) gaps.push('a weight for every parcel');
  return gaps;
}

/** FedEx rejects a dimension of zero; absent is fine, zero is not. */
const dim = (v: number | null | undefined): number | null => (typeof v === 'number' && v > 0 ? Math.ceil(v) : null);

/**
 * The request body FedEx expects.
 *
 * `rateRequestType` asks for both ACCOUNT and LIST. ACCOUNT is our negotiated price — the number
 * that belongs in a profit calculation — and LIST is the published one. Asking for both costs
 * nothing and makes the discount visible; asking only for LIST would quietly overstate every
 * shipping cost in the platform.
 */
export function buildRateRequest(input: RateQuoteInput, opts: { customs: boolean }): Record<string, unknown> {
  const endpoint = (e: RateEndpoint) => ({
    address: {
      postalCode: e.postalCode,
      countryCode: (e.countryIso ?? '').toUpperCase(),
      // Sent only when known. FedEx defaults it, and guessing "business" on a home address quotes a
      // price the invoice will not match.
      ...(e.residential == null ? {} : { residential: e.residential }),
    },
  });

  const body: Record<string, any> = {
    accountNumber: { value: input.accountNumber },
    rateRequestControlParameters: { returnTransitTimes: 'true' },
    requestedShipment: {
      shipper: endpoint(input.shipper),
      recipient: endpoint(input.recipient),
      // We hand parcels to FedEx rather than having them collected on a schedule we do not have.
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      packagingType: 'YOUR_PACKAGING',
      rateRequestType: ['ACCOUNT', 'LIST'],
      ...(input.serviceType ? { serviceType: input.serviceType } : {}),
      ...(input.preferredCurrency ? { preferredCurrency: input.preferredCurrency } : {}),
      requestedPackageLineItems: input.parcels.map((p) => {
        const l = dim(p.lengthCm);
        const w = dim(p.widthCm);
        const h = dim(p.heightCm);
        return {
          // Metric throughout. FedEx accepts KG and CM, and converting to pounds and inches would
          // introduce rounding into a figure that ends up in a profit calculation.
          weight: { units: 'KG', value: p.weightKg },
          // All three or none: a partial dimension set is rejected, and a box with a length and no
          // width is not a thing FedEx can rate.
          ...(l && w && h ? { dimensions: { length: l, width: w, height: h, units: 'CM' } } : {}),
        };
      }),
    },
  };

  if (opts.customs) {
    body.requestedShipment.customsClearanceDetail = {
      commodities: [
        {
          description: input.goodsDescription || 'Consumer goods',
          quantity: 1,
          quantityUnits: 'PCS',
          customsValue: {
            amount: input.customsValue?.amount ?? 0,
            currency: input.customsValue?.currency ?? 'EUR',
          },
        },
      ],
    };
  }

  return body;
}

/** The headers the collection sends. The token goes in `authorization` as a bearer. */
export function rateHeaders(token: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-locale': 'en_US',
    authorization: `Bearer ${token}`,
  };
}

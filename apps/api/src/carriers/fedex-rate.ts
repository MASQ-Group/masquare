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
  // Confirmed by a live Cyprus->GB quote on 8 September 2026. The first three are what FedEx
  // actually returned; the rest are from the handoff and remain unconfirmed on a real lane.
  'INTERNATIONAL_FIRST',
  'FEDEX_INTERNATIONAL_PRIORITY_EXPRESS',
  /**
   * FEDEX_-prefixed, and this was wrong until a real reply corrected it.
   *
   * The catalogue said INTERNATIONAL_PRIORITY, which reads perfectly plausibly and appears in
   * FedEx's own samples. What comes back from Cyprus is FEDEX_INTERNATIONAL_PRIORITY. Asking for
   * the unprefixed name would have returned nothing, with no error to explain why.
   */
  'FEDEX_INTERNATIONAL_PRIORITY',
  'INTERNATIONAL_ECONOMY',
  'INTERNATIONAL_PRIORITY_FREIGHT',
  'INTERNATIONAL_ECONOMY_FREIGHT',
] as const;

/**
 * Fallback labels, used only where a reply carries no name of its own.
 *
 * FedEx returns `serviceName` on every rated service — "FedEx International First®" — and that is
 * better than anything we would maintain here: it is current, it is theirs, and it cannot drift out
 * of step with what they actually sell.
 */
export const SERVICE_LABELS: Record<string, string> = {
  INTERNATIONAL_FIRST: 'International First',
  FEDEX_INTERNATIONAL_PRIORITY_EXPRESS: 'International Priority Express',
  FEDEX_INTERNATIONAL_PRIORITY: 'International Priority',
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

/**
 * What a failed rate call actually means, given that a token was obtained first.
 *
 * FedEx answers a rejected rate request with NOT.AUTHORIZED.ERROR and "We could not authenticate
 * your credentials". Taken at face value that sends somebody to re-type a working API key — and we
 * know it is working, because a token had to be minted before this call could be made at all.
 *
 * It is an authorisation failure, not an authentication one. Two causes account for nearly all of
 * them, and both live in the FedEx portal rather than in anything here:
 *
 *  - The account number in the request is not the one these credentials are entitled to use. The
 *    common version of this is a real account number entered against a sandbox row: sandbox expects
 *    the test account number the portal assigned, and rejects the live one.
 *  - The API project does not include Rates and Transit Times. A project grants a specific list of
 *    APIs; the token is issued regardless, and only the call to an API outside that list fails.
 */
export function describeRateFailure(status: number, body: unknown): string {
  const codes = extractErrorCodes(body);
  if (status === 401 || status === 403 || codes.includes('NOT.AUTHORIZED.ERROR')) {
    return [
      'FedEx refused this account for the Rate API. The API key and secret are NOT the problem — a token was issued with them a moment before this call.',
      'Two things to check in the FedEx portal:',
      '1. The account number on this record is the one these credentials may use. A sandbox record needs the test account number the portal assigned, not the live one.',
      '2. The API project includes "Rates and Transit Times". A token is issued whatever the project covers; only the call to an API outside it is refused.',
    ].join('\n');
  }
  if (status === 429) {
    return 'FedEx is rate-limiting us. Rating allows 1,400 calls per ten seconds, so this is unusual — wait a moment before retrying.';
  }
  if (status >= 500) {
    return `FedEx returned ${status}. Their side, not our request — try again shortly.`;
  }
  const messages = extractErrorMessages(body);
  return messages.length ? messages.join(' · ') : `FedEx refused the rate request (${status}).`;
}

/** FedEx reports problems as `errors: [{ code, message }]`. */
function errorList(body: unknown): Array<{ code?: string; message?: string }> {
  const errs = (body as any)?.errors;
  return Array.isArray(errs) ? errs : [];
}
function extractErrorCodes(body: unknown): string[] {
  return errorList(body).map((e) => String(e?.code ?? '')).filter(Boolean);
}
function extractErrorMessages(body: unknown): string[] {
  return errorList(body).map((e) => String(e?.message ?? '')).filter(Boolean);
}

import { describe, expect, it } from 'vitest';
import {
  CYPRUS_SERVICE_TYPES,
  RATE_PATH,
  buildRateRequest,
  describeRateFailure,
  missingForQuote,
  needsCustoms,
  rateHeaders,
  type RateQuoteInput,
} from './fedex-rate';

/**
 * The rate request, checked against FedEx's own JSON API collection rather than against a
 * documentation summary.
 *
 * Worth stating what that file is, because it is a trap as well as a source: 424 sample
 * transactions, many of them deliberately malformed so the sandbox returns errors. It contains
 * `DROPOFF_AT_FEDEX_LOCATI`, a country code of `FRz`, and a rateRequestType of `'null'`. Harvesting
 * every value that appears in it would produce a set of enums half of which FedEx rejects on
 * purpose.
 */

const EU = new Set(['CY', 'DE', 'FR', 'ES', 'IT', 'IE', 'NL', 'BE', 'SE', 'AT', 'PL', 'GR']);

const base: RateQuoteInput = {
  accountNumber: '123456789',
  shipper: { postalCode: '1010', countryIso: 'CY' },
  recipient: { postalCode: 'LS1 1AA', countryIso: 'GB' },
  parcels: [{ weightKg: 2.4 }],
};

describe('the endpoint', () => {
  it('carries the major version in the path, as FedEx versions everything', () => {
    expect(RATE_PATH).toBe('/rate/v1/rates/quotes');
  });

  it('sends the token as a bearer in `authorization`', () => {
    // Lower-case in the collection's own headers. Sent as given rather than title-cased, since
    // there is no reason to differ from the vendor's own example.
    expect(rateHeaders('abc').authorization).toBe('Bearer abc');
    expect(rateHeaders('abc')['content-type']).toBe('application/json');
  });
});

describe('asking for the right prices', () => {
  it('requests the negotiated rate as well as the published one', () => {
    // ACCOUNT is what we actually pay and what belongs in a profit calculation. Asking only for
    // LIST would overstate every shipping cost in the platform, quietly and consistently.
    const body: any = buildRateRequest(base, { customs: true });
    expect(body.requestedShipment.rateRequestType).toEqual(['ACCOUNT', 'LIST']);
  });

  it('asks for transit times, which are half of what the page is for', () => {
    const body: any = buildRateRequest(base, { customs: true });
    expect(body.rateRequestControlParameters.returnTransitTimes).toBe('true');
  });

  it('omits serviceType by default, so every service on the lane comes back', () => {
    // 158 of FedEx's own samples leave it out. "What runs between these two postcodes, and at what
    // price" is the question somebody choosing a service is actually asking.
    const body: any = buildRateRequest(base, { customs: true });
    expect(body.requestedShipment.serviceType).toBeUndefined();
  });

  it('narrows to one service when asked', () => {
    const body: any = buildRateRequest({ ...base, serviceType: 'INTERNATIONAL_PRIORITY' }, { customs: true });
    expect(body.requestedShipment.serviceType).toBe('INTERNATIONAL_PRIORITY');
  });
});

describe('units', () => {
  it('sends kilograms and centimetres rather than converting', () => {
    // FedEx accepts both. Converting to pounds and inches would introduce rounding into a number
    // that ends up in a profit figure, for no gain whatsoever.
    const body: any = buildRateRequest({ ...base, parcels: [{ weightKg: 2.4, lengthCm: 30, widthCm: 20, heightCm: 15 }] }, { customs: true });
    const item = body.requestedShipment.requestedPackageLineItems[0];
    expect(item.weight).toEqual({ units: 'KG', value: 2.4 });
    expect(item.dimensions).toEqual({ length: 30, width: 20, height: 15, units: 'CM' });
  });

  it('sends dimensions only when all three are present', () => {
    // A box with a length and no width is not something FedEx can rate; a partial set is rejected.
    const body: any = buildRateRequest({ ...base, parcels: [{ weightKg: 2, lengthCm: 30 }] }, { customs: true });
    expect(body.requestedShipment.requestedPackageLineItems[0].dimensions).toBeUndefined();
  });

  it('treats a zero dimension as absent rather than sending it', () => {
    // Products carry 0 where nobody has measured them. Sent literally, FedEx rejects the request.
    const body: any = buildRateRequest({ ...base, parcels: [{ weightKg: 2, lengthCm: 0, widthCm: 0, heightCm: 0 }] }, { customs: true });
    expect(body.requestedShipment.requestedPackageLineItems[0].dimensions).toBeUndefined();
  });

  it('rounds dimensions up, never down', () => {
    // Rounding a parcel smaller than it is quotes a price the invoice will not match.
    const body: any = buildRateRequest({ ...base, parcels: [{ weightKg: 1, lengthCm: 30.2, widthCm: 20.9, heightCm: 15.1 }] }, { customs: true });
    expect(body.requestedShipment.requestedPackageLineItems[0].dimensions).toEqual({ length: 31, width: 21, height: 16, units: 'CM' });
  });
});

describe('when a customs declaration is needed', () => {
  it('is not needed inside the EU — Cyprus to Germany crosses no border', () => {
    // The commonest thing to get wrong from a Cyprus origin, and it cuts both ways.
    expect(needsCustoms('CY', 'DE', EU)).toBe(false);
  });

  it('is needed leaving the EU — Cyprus to the United Kingdom is an export', () => {
    expect(needsCustoms('CY', 'GB', EU)).toBe(true);
  });

  it('is not needed for a domestic movement', () => {
    expect(needsCustoms('CY', 'CY', EU)).toBe(false);
  });

  it('says no when either country is unknown, rather than guessing', () => {
    expect(needsCustoms(null, 'GB', EU)).toBe(false);
  });

  it('attaches the commodity only on a customs quote', () => {
    const intl: any = buildRateRequest(base, { customs: true });
    const domestic: any = buildRateRequest(base, { customs: false });
    expect(intl.requestedShipment.customsClearanceDetail.commodities).toHaveLength(1);
    expect(domestic.requestedShipment.customsClearanceDetail).toBeUndefined();
  });

  it('uses the declared value it was given', () => {
    const body: any = buildRateRequest({ ...base, customsValue: { amount: 149.99, currency: 'EUR' }, goodsDescription: 'Wine stopper' }, { customs: true });
    const c = body.requestedShipment.customsClearanceDetail.commodities[0];
    expect(c.customsValue).toEqual({ amount: 149.99, currency: 'EUR' });
    expect(c.description).toBe('Wine stopper');
  });
});

describe('residential or business', () => {
  it('sends nothing when nobody has said', () => {
    // FedEx has its own default. Guessing "business" on a home address quotes a price the invoice
    // will not match, and residential surcharges are exactly the sort of gap nobody spots.
    const body: any = buildRateRequest(base, { customs: true });
    expect(body.requestedShipment.recipient.address.residential).toBeUndefined();
  });

  it('sends it when it is known', () => {
    const body: any = buildRateRequest({ ...base, recipient: { ...base.recipient, residential: true } }, { customs: true });
    expect(body.requestedShipment.recipient.address.residential).toBe(true);
  });
});

describe('what is missing before a quote is possible', () => {
  it('names each gap rather than answering yes or no', () => {
    expect(missingForQuote({ accountNumber: '1', shipper: { postalCode: '1010', countryIso: 'CY' }, parcels: [] }))
      .toEqual(['delivery address', 'parcel weight']);
  });

  it('rejects a parcel with no weight', () => {
    expect(missingForQuote({ ...base, parcels: [{ weightKg: 0 }] })).toContain('a weight for every parcel');
  });

  it('is satisfied by an account, two addresses and a weight', () => {
    expect(missingForQuote(base)).toEqual([]);
  });
});

describe('the service catalogue for a Cyprus origin', () => {
  it('excludes the US and Canada domestic services', () => {
    // They are all over FedEx's samples and would simply error from Cyprus (handoff §5.4).
    for (const wrong of ['FEDEX_GROUND', 'GROUND_HOME_DELIVERY', 'SMART_POST', 'FIRST_OVERNIGHT']) {
      expect(CYPRUS_SERVICE_TYPES).not.toContain(wrong as any);
    }
  });

  it('excludes Regional Economy until FedEx confirms it runs from Cyprus', () => {
    // Open question 3 in the handoff. Offering it now would put a service on a screen that may
    // simply error — a worse outcome than its absence.
    expect(CYPRUS_SERVICE_TYPES).not.toContain('FEDEX_REGIONAL_ECONOMY' as any);
  });

  it('uses the prefixed name for International Priority, as a live quote proved', () => {
    // This was INTERNATIONAL_PRIORITY until a real Cyprus->GB reply came back with
    // FEDEX_INTERNATIONAL_PRIORITY. The unprefixed name is plausible, appears in FedEx's own
    // samples, and would have quietly returned nothing on this lane.
    expect(CYPRUS_SERVICE_TYPES).toContain('FEDEX_INTERNATIONAL_PRIORITY');
    expect(CYPRUS_SERVICE_TYPES).not.toContain('INTERNATIONAL_PRIORITY' as any);
  });

  it('still lists the services the handoff names but a live quote has not yet returned', () => {
    expect(CYPRUS_SERVICE_TYPES).toContain('INTERNATIONAL_ECONOMY');
  });
});

describe('explaining a refused rate quote', () => {
  /**
   * The reply that prompted this: HTTP 401, NOT.AUTHORIZED.ERROR, "We could not authenticate your
   * credentials. Please try again." Every word of which is misleading, because the credentials had
   * just authenticated — a token is required to make the call at all.
   */
  const notAuthorised = {
    transactionId: '03aac233-db58-4ad0-a2ba-fc7a173c54a0',
    errors: [{ code: 'NOT.AUTHORIZED.ERROR', message: 'We could not authenticate your credentials. Please try again.' }],
  };

  it('says plainly that the keys are not the problem', () => {
    // The one thing a reader must not do here is go and replace a working API key.
    const msg = describeRateFailure(401, notAuthorised);
    expect(msg).toMatch(/NOT the problem/);
    expect(msg).toMatch(/token was issued/i);
  });

  it('names the account number as the first thing to check', () => {
    // A rate request is the first call that uses the account number, so it is the first that can
    // reject it — and a live number on a sandbox record is the usual version of the mistake.
    const msg = describeRateFailure(401, notAuthorised);
    expect(msg).toMatch(/account number/i);
    expect(msg).toMatch(/sandbox record needs the test account number/i);
  });

  it('names the project API list as the second', () => {
    // A FedEx project grants a specific set of APIs. The token is issued regardless of that list;
    // only the call to an API outside it fails, which is exactly what this looks like.
    expect(describeRateFailure(401, notAuthorised)).toMatch(/Rates and Transit Times/);
  });

  it('treats a 403 and a bare NOT.AUTHORIZED code the same way', () => {
    expect(describeRateFailure(403, {})).toMatch(/NOT the problem/);
    expect(describeRateFailure(200, notAuthorised)).toMatch(/NOT the problem/);
  });

  it('does not blame our request for their outage', () => {
    expect(describeRateFailure(503, {})).toMatch(/Their side/i);
  });

  it('passes through what FedEx said on anything else', () => {
    const body = { errors: [{ code: 'POSTAL.CODE.INVALID', message: 'Postal code is invalid' }] };
    expect(describeRateFailure(400, body)).toContain('Postal code is invalid');
  });

  it('says something useful even when the body is not the shape we expect', () => {
    expect(describeRateFailure(400, 'not json at all')).toContain('400');
  });
});

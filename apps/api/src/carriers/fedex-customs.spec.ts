import { describe, expect, it } from 'vitest';
import { commodityFromItem, missingForExport, normaliseHsCode, totalCustomsValue } from './fedex-customs';
import { buildShipRequest, missingForBooking, type ShipRequestInput } from './fedex-ship';

const item = (over: Partial<Parameters<typeof commodityFromItem>[0]> = {}) => commodityFromItem({
  description: 'Beurer MG16 mini massager', quantity: 2, value: 80, currency: 'GBP',
  weightKg: 0.8, countryOfOrigin: 'CN', hsCode: '9019.10.10', ...over,
});

const shipment = (over: Partial<ShipRequestInput> = {}): ShipRequestInput => ({
  accountNumber: '740000000',
  shipper: { contact: { personName: 'maSquare' }, address: { streetLines: ['1 Street'], city: 'Nicosia', postalCode: '1010', countryCode: 'CY' } },
  recipient: { contact: { personName: 'Buyer' }, address: { streetLines: ['100 Queen Street'], city: 'Toronto', stateOrProvinceCode: 'ON', postalCode: 'M4B 1B4', countryCode: 'CA' } },
  serviceType: 'FEDEX_INTERNATIONAL_PRIORITY',
  shipDate: '2026-09-21',
  parcels: [{ weightKg: 0.8 }],
  customerReference: 'CB-2026-09-0001',
  dutiesPaidBy: 'recipient',
  commodities: [item()],
  invoice: 'fedex',
  ...over,
});

describe('normaliseHsCode', () => {
  it('takes the code however it was written', () => {
    expect(normaliseHsCode('9019.10.10')).toBe('90191010');
    expect(normaliseHsCode('9019 10')).toBe('901910');
    expect(normaliseHsCode('8516-79-70')).toBe('85167970');
  });

  it('refuses what is not an HS code — a wrong one is a customs hold', () => {
    expect(normaliseHsCode('9019')).toBeNull();         // too short: not even a heading
    expect(normaliseHsCode('90191010123')).toBeNull();  // longer than any national extension
    expect(normaliseHsCode('ABC123')).toBeNull();
    expect(normaliseHsCode('')).toBeNull();
    expect(normaliseHsCode(null)).toBeNull();
  });
});

describe('an item as a person enters it', () => {
  it('takes the line total and works out the unit price, so the two cannot disagree', () => {
    const c = item({ quantity: 3, value: 100 });
    expect(c.customsValueAmount).toBe(100);
    expect(c.unitPriceAmount).toBe(33.33);
  });

  it('upper-cases the country and currency', () => {
    const c = item({ countryOfOrigin: 'cn', currency: 'gbp' });
    expect(c.countryOfManufacture).toBe('CN');
    expect(c.currency).toBe('GBP');
  });
});

describe('rule 1 — every item carries its six facts', () => {
  it('passes a complete export', () => {
    expect(missingForExport({ commodities: [item()], parcels: [{ weightKg: 0.8 }], invoice: 'fedex' })).toEqual([]);
  });

  it('refuses an export with no items at all — the booking that FedEx turned away', () => {
    expect(missingForExport({ commodities: [], parcels: [{ weightKg: 1 }], invoice: 'fedex' })[0]).toContain('at least one item');
  });

  it('names each missing fact, on the item that lacks it', () => {
    const gaps = missingForExport({
      commodities: [item({ description: ' ', countryOfOrigin: null, hsCode: '12' })],
      parcels: [{ weightKg: 0.8 }],
      invoice: 'fedex',
    });
    expect(gaps).toContain('a description for the item');
    expect(gaps).toContain('a country of origin for the item');
    expect(gaps).toContain('an HS code for the item (6 to 10 digits)');
  });

  it('numbers items when there are several', () => {
    const gaps = missingForExport({
      commodities: [item({ weightKg: 0.4 }), item({ weightKg: 0.4, value: 0 })],
      parcels: [{ weightKg: 0.8 }],
      invoice: 'fedex',
    });
    expect(gaps).toEqual(['a value for item 2']);
  });

  it('refuses two currencies on one invoice', () => {
    const gaps = missingForExport({
      commodities: [item({ weightKg: 0.4 }), item({ weightKg: 0.4, currency: 'EUR' })],
      parcels: [{ weightKg: 0.8 }],
      invoice: 'fedex',
    });
    expect(gaps.join(' ')).toContain('one currency');
  });
});

describe('rule 2 — an invoice for the same value', () => {
  it('states the invoice total as the sum of the items', () => {
    expect(totalCustomsValue([item({ value: 80 }), item({ value: 19.99 })])).toEqual({ amount: 99.99, currency: 'GBP' });
  });

  it('refuses the platform invoice by name until that process exists', () => {
    const gaps = missingForExport({ commodities: [item()], parcels: [{ weightKg: 0.8 }], invoice: 'platform' });
    expect(gaps).toEqual(['an invoice from FedEx — the platform generating its own invoice is not set up yet']);
  });

  it('asks who produces the invoice rather than assuming', () => {
    expect(missingForExport({ commodities: [item()], parcels: [{ weightKg: 0.8 }], invoice: null }))
      .toEqual(['who produces the commercial invoice']);
  });
});

describe('rule 3 — the shipment weighs what its items weigh', () => {
  it('refuses a mismatch and says both weights', () => {
    const gaps = missingForExport({ commodities: [item({ weightKg: 0.8 })], parcels: [{ weightKg: 1.2 }], invoice: 'fedex' });
    expect(gaps).toEqual(['the items to weigh what the shipment weighs — items 0.8 kg, shipment 1.2 kg']);
  });

  it('adds up every parcel and every item', () => {
    const gaps = missingForExport({
      commodities: [item({ weightKg: 0.5 }), item({ weightKg: 1.5 })],
      parcels: [{ weightKg: 1 }, { weightKg: 1 }],
      invoice: 'fedex',
    });
    expect(gaps).toEqual([]);
  });

  it('forgives a rounding difference, and nothing more', () => {
    expect(missingForExport({ commodities: [item({ weightKg: 0.805 })], parcels: [{ weightKg: 0.8 }], invoice: 'fedex' })).toEqual([]);
    expect(missingForExport({ commodities: [item({ weightKg: 0.82 })], parcels: [{ weightKg: 0.8 }], invoice: 'fedex' })).toHaveLength(1);
  });

  it('reports a missing weight once, as itself, not again as a mismatch', () => {
    const gaps = missingForExport({ commodities: [item({ weightKg: 0 })], parcels: [{ weightKg: 0.8 }], invoice: 'fedex' });
    expect(gaps).toEqual(['a weight for the item']);
  });
});

describe('the booking gate', () => {
  it('asks the export questions only of an export', () => {
    const inside = shipment({ commodities: [], invoice: null });
    expect(missingForBooking(inside, 'intra_eu')).toEqual([]);
    expect(missingForBooking(inside, 'export').length).toBeGreaterThan(0);
  });
});

describe('what FedEx is sent for an export', () => {
  const body = buildShipRequest(shipment(), { customs: 'export' }) as any;
  const cc = body.requestedShipment.customsClearanceDetail;

  it('states the total customs value — the field FedEx refused the first booking over', () => {
    expect(cc.totalCustomsValue).toEqual({ amount: 80, currency: 'GBP' });
  });

  it('sends each item with all six facts, the HS code as digits', () => {
    expect(cc.commodities[0]).toMatchObject({
      description: 'Beurer MG16 mini massager',
      quantity: 2,
      numberOfPieces: 1,
      customsValue: { amount: 80, currency: 'GBP' },
      unitPrice: { amount: 40, currency: 'GBP' },
      weight: { units: 'KG', value: 0.8 },
      countryOfManufacture: 'CN',
      harmonizedCode: '90191010',
    });
  });

  it('asks FedEx to write the commercial invoice, exactly as their own samples do', () => {
    expect(body.requestedShipment.shipmentSpecialServices).toEqual({
      specialServiceTypes: ['ELECTRONIC_TRADE_DOCUMENTS'],
      etdDetail: { requestedDocumentTypes: ['COMMERCIAL_INVOICE'] },
    });
    expect(body.requestedShipment.shippingDocumentSpecification).toEqual({
      shippingDocumentTypes: ['COMMERCIAL_INVOICE'],
      commercialInvoiceDetail: { documentFormat: { stockType: 'PAPER_LETTER', docType: 'PDF' } },
    });
  });

  it('does not ask for an invoice inside the EU, where there is no border to clear', () => {
    const inside = buildShipRequest(shipment(), { customs: 'intra_eu' }) as any;
    expect(inside.requestedShipment.shipmentSpecialServices).toBeUndefined();
    expect(inside.requestedShipment.customsClearanceDetail.totalCustomsValue).toBeUndefined();
  });
});

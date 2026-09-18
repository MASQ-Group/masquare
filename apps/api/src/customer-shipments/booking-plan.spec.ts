import { describe, expect, it } from 'vitest';
import {
  batteriesFor, collectionParty, customsItems, dangerousGoodsRefusal, invoiceIssuer, recipientParty, shipParcels, withEdits,
  type ParcelForBooking, type ShipmentForBooking,
} from './booking-plan';
import { commodityFromItem, missingForExport } from '../carriers/fedex-customs';

const box = (over: Partial<ParcelForBooking> = {}): ParcelForBooking => ({
  id: 'p1', weightKg: '2.400', lengthCm: '30.0', widthCm: '20.0', heightCm: '15.0',
  goodsDescription: 'Guitar strings', declaredValue: '40.00', quantity: 3,
  hsCode: '92099400', countryOfOrigin: 'CN', dangerousGoods: false, batteryType: null,
  ...over,
});

const shipment = (over: Partial<ShipmentForBooking> = {}): ShipmentForBooking => ({
  reference: 'AB-2026-09-0007',
  goodsDescription: 'Guitar strings', goodsCurrency: 'EUR',
  toName: 'A Buyer', toCompany: 'Buyer Ltd', toVatNumber: 'GB123456789',
  toLine1: '10 High Street', toLine2: null, toLine3: 'Unit 4',
  toCity: 'Leeds', toRegion: null, toPostalCode: 'LS1 1AA', toCountryIso: 'gb',
  toPhone: '+44 20 7946 0000', toEmail: 'a@buyer.co.uk',
  fromName: null, fromCompany: null, fromLine1: null, fromLine2: null,
  fromCity: null, fromRegion: null, fromPostalCode: null, fromCountryIso: null, fromPhone: null, fromEmail: null,
  parcels: [box()],
  ...over,
});

describe('who receives it', () => {
  it('is the delivery address, with the phone as digits and the VAT number declared', () => {
    const r = recipientParty(shipment());
    expect(r.contact).toEqual({ personName: 'A Buyer', companyName: 'Buyer Ltd', phoneNumber: '2079460000', emailAddress: 'a@buyer.co.uk' });
    expect(r.address).toMatchObject({ streetLines: ['10 High Street', 'Unit 4'], city: 'Leeds', postalCode: 'LS1 1AA', countryCode: 'GB' });
    expect(r.tins).toEqual([{ tinType: 'BUSINESS_NATIONAL', number: 'GB123456789' }]);
  });
});

describe('where it leaves from', () => {
  it('is our warehouse — no origin — when no collection address was given', () => {
    expect(collectionParty(shipment())).toBeNull();
  });

  it('is the collection address when there is one', () => {
    const o = collectionParty(shipment({
      fromName: 'Nikos', fromCompany: 'Supplier Ltd', fromLine1: '5 Industrial Road', fromCity: 'Nicosia',
      fromPostalCode: '2000', fromCountryIso: 'cy', fromPhone: '+357 22 123456',
    }));
    expect(o?.contact).toMatchObject({ personName: 'Nikos', companyName: 'Supplier Ltd', phoneNumber: '22123456' });
    expect(o?.address).toMatchObject({ streetLines: ['5 Industrial Road'], countryCode: 'CY' });
  });
});

describe('the customs lines', () => {
  it('are one per box, weighing what the box weighs, so FedEx’s weight rule holds by construction', () => {
    const s = shipment({ parcels: [box(), box({ id: 'p2', weightKg: '1.100', declaredValue: '15', quantity: 1 })] });
    const items = customsItems(s, s.parcels);
    expect(items).toEqual([
      { description: 'Guitar strings', quantity: 3, value: 40, currency: 'EUR', weightKg: 2.4, countryOfOrigin: 'CN', hsCode: '92099400' },
      { description: 'Guitar strings', quantity: 1, value: 15, currency: 'EUR', weightKg: 1.1, countryOfOrigin: 'CN', hsCode: '92099400' },
    ]);
    // And the export gate agrees: nothing missing, weights equal.
    const gaps = missingForExport({ commodities: items.map(commodityFromItem), parcels: shipParcels(s.parcels), invoice: 'fedex' });
    expect(gaps).toEqual([]);
  });

  it('fall back to the shipment’s description where a box has none', () => {
    const s = shipment({ goodsDescription: 'Spare parts', parcels: [box({ goodsDescription: null })] });
    expect(customsItems(s, s.parcels)[0].description).toBe('Spare parts');
  });
});

describe('our team’s corrections', () => {
  it('lay over the box they name and leave the rest alone', () => {
    const out = withEdits([box(), box({ id: 'p2' })], [{ id: 'p2', hsCode: '8516.79', countryOfOrigin: 'de', quantity: 2, declaredValue: 99 }]);
    expect(out[0]).toEqual(box());
    expect(out[1]).toMatchObject({ hsCode: '8516.79', countryOfOrigin: 'DE', quantity: 2, declaredValue: 99 });
  });

  it('ignore a quantity that is not a whole number of one or more', () => {
    expect(withEdits([box()], [{ id: 'p1', quantity: 0 }])[0].quantity).toBe(3);
  });

  it('ignore boxes that are not on the shipment', () => {
    expect(withEdits([box()], [{ id: 'elsewhere', hsCode: '1' }])).toEqual([box()]);
  });
});

describe('batteries', () => {
  it('declares Section II batteries in or with equipment as FedEx’s battery service', () => {
    expect(batteriesFor('li_ion_in_equipment')).toEqual({ ok: true, batteries: { packing: 'CONTAINED_IN_EQUIPMENT', material: 'LITHIUM_ION' } });
    expect(batteriesFor('li_metal_with_equipment')).toEqual({ ok: true, batteries: { packing: 'PACKED_WITH_EQUIPMENT', material: 'LITHIUM_METAL' } });
    const parcels = shipParcels([box({ dangerousGoods: true, batteryType: 'li_ion_with_equipment' })]);
    expect(parcels[0].batteries).toEqual({ packing: 'PACKED_WITH_EQUIPMENT', material: 'LITHIUM_ION' });
  });

  it('refuses batteries on their own and other dangerous goods, pointing at booking directly', () => {
    for (const t of ['li_ion_alone', 'li_metal_alone', 'other', null]) {
      const refusal = dangerousGoodsRefusal([box({ dangerousGoods: true, batteryType: t })], true);
      expect(refusal).toContain('cannot be booked from the platform');
    }
  });

  it('asks a person to confirm Section II before it is declared', () => {
    const parcels = [box({ dangerousGoods: true, batteryType: 'li_ion_in_equipment' })];
    expect(dangerousGoodsRefusal(parcels, false)).toContain('Section II');
    expect(dangerousGoodsRefusal(parcels, true)).toBeNull();
    expect(dangerousGoodsRefusal([box()], false)).toBeNull();
  });
});

describe('the invoice', () => {
  it('is issued in the customer’s registered name where we hold one', () => {
    expect(invoiceIssuer({ name: 'Acme', legalName: 'Acme Trading Ltd' })).toBe('Acme Trading Ltd');
    expect(invoiceIssuer({ name: 'Acme', legalName: '  ' })).toBe('Acme');
  });
});

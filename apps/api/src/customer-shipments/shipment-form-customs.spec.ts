import { describe, expect, it } from 'vitest';
import { customsNeeded, formToInput, hasCollection, problemsWith, type PackageForm, type ShipmentForm } from './shipment-form';

/**
 * The customs line on each box, and the collection address.
 *
 * FedEx will not book a delivery outside the EU without six facts per item. The customer is the one
 * who knows them, so the form asks at filing — but only where a border is crossed, because asking a
 * Cypriot sending to Greece for an HS code is a question with no use.
 */

const EU = new Set(['CY', 'GR', 'DE', 'FR']);

const parcel = (over: Partial<PackageForm> = {}): PackageForm => ({
  lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 2.4,
  goodsDescription: 'Guitar strings',
  dangerousGoods: false, priorityHandling: false, insurance: false,
  ...over,
});

const form = (over: Partial<ShipmentForm> = {}): ShipmentForm => ({
  recipient: { contactName: 'Maria Georgiou', phone: '+357 99 123456', email: 'maria@example.com' },
  address: { countryIso: 'CY', postalCode: '1010', city: 'Nicosia', line1: '12 Makarios Avenue' },
  packages: [parcel()],
  ...over,
});

const toUk = (packages: PackageForm[] = [parcel()]) => form({
  recipient: { contactName: 'A Buyer', phone: '+44 20 7946 0000', email: 'a@b.co.uk' },
  address: { countryIso: 'GB', postalCode: 'LS1 1AA', city: 'Leeds', line1: '10 High Street' },
  packages,
});

describe('whether a border is crossed', () => {
  it('is not, inside the EU', () => {
    expect(customsNeeded(form({ address: { countryIso: 'GR', postalCode: '1', city: 'A', line1: 'B' } }), EU)).toBe(false);
  });

  it('is, to a country outside it', () => {
    expect(customsNeeded(toUk(), EU)).toBe(true);
  });

  it('is, when collected from outside the EU and delivered inside it', () => {
    const f = form({ collection: { contactName: 'S', phone: '+1 212 555 0100', countryIso: 'US', postalCode: '10001', city: 'NY', line1: '1 Road' } });
    expect(customsNeeded(f, EU)).toBe(true);
  });

  it('is not, collected and delivered in the same country', () => {
    const f = toUk();
    f.collection = { contactName: 'S', phone: '+44 20 7946 0001', countryIso: 'GB', postalCode: 'M1 1AA', city: 'Manchester', line1: '2 Road' };
    expect(customsNeeded(f, EU)).toBe(false);
  });

  it('asks nothing when no EU list was supplied, leaving the booking to check', () => {
    expect(customsNeeded(toUk(), null)).toBe(false);
    expect(customsNeeded(toUk(), new Set())).toBe(false);
  });
});

describe('the customs line on each box', () => {
  it('is required outside the EU, naming the box and the field', () => {
    const problems = problemsWith(toUk([parcel(), parcel()]), { euCountries: EU }).join(' | ');
    expect(problems).toContain('Package 1 needs an HS code');
    expect(problems).toContain('Package 2 needs the country the goods were made in');
    expect(problems).toContain('Package 1 needs a declared value');
  });

  it('is satisfied by a value, an HS code and an origin', () => {
    const f = toUk([parcel({ declaredValue: 40, hsCode: '9209.94', countryOfOrigin: 'cn', quantity: 3 })]);
    expect(problemsWith(f, { euCountries: EU })).toEqual([]);
  });

  it('is not asked for inside the EU', () => {
    expect(problemsWith(form(), { euCountries: EU })).toEqual([]);
  });

  it('refuses an HS code that is not one, wherever it goes', () => {
    expect(problemsWith(form({ packages: [parcel({ hsCode: 'guitar' })] })).join(' ')).toContain('HS code that is not one');
  });

  it('refuses a quantity that is not a whole number of one or more', () => {
    expect(problemsWith(form({ packages: [parcel({ quantity: 0 })] })).join(' ')).toContain('whole-number quantity');
    expect(problemsWith(form({ packages: [parcel({ quantity: 1.5 })] })).join(' ')).toContain('whole-number quantity');
  });

  it('is stored as FedEx takes it: HS digits only, origin in capitals, quantity defaulting to one', () => {
    const input = formToInput(toUk([parcel({ declaredValue: 40, hsCode: '9209.94.00', countryOfOrigin: 'cn' }), parcel()]));
    expect(input.parcels?.[0]).toMatchObject({ hsCode: '92099400', countryOfOrigin: 'CN', quantity: 1 });
    expect(input.parcels?.[1]).toMatchObject({ hsCode: null, countryOfOrigin: null, quantity: 1 });
  });
});

describe('the collection address', () => {
  const collection = { companyName: 'Supplier Ltd', contactName: 'Nikos', phone: '+357 22 123456', countryIso: 'CY', postalCode: '2000', city: 'Nicosia', line1: '5 Industrial Road' };

  it('is optional — empty means the goods are at our warehouse', () => {
    expect(hasCollection(null)).toBe(false);
    expect(hasCollection({ line1: '  ' })).toBe(false);
    expect(problemsWith(form({ collection: {} }))).toEqual([]);
  });

  it('once started, needs everything a courier needs to find the door', () => {
    const problems = problemsWith(form({ collection: { city: 'Limassol' } })).join(' | ');
    expect(problems).toContain('collection address needs a contact name');
    expect(problems).toContain('collection address needs a phone number');
    expect(problems).toContain('collection postcode');
    expect(problems).toContain('first line of the collection address');
  });

  it('checks the phone against the collection country', () => {
    expect(problemsWith(form({ collection: { ...collection, phone: '+357 111111' } })).join(' ')).toContain('collection phone number will not reach');
  });

  it('is written onto the shipment when given', () => {
    expect(formToInput(form({ collection })).from).toMatchObject({
      name: 'Nikos', company: 'Supplier Ltd', line1: '5 Industrial Road', city: 'Nicosia', postalCode: '2000', countryIso: 'CY',
    });
  });

  it('is cleared on the shipment when removed, rather than left behind unseen', () => {
    const from = formToInput(form({ collection: null })).from;
    expect(from).toBeDefined();
    expect(Object.values(from ?? {}).every((v) => v == null)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { customsNeeded, fieldProblem, formComplete, hasCollection, sectionComplete } from './formRules';
import { emptyForm, emptyPackage, type FormState } from './ShipmentFormFields';

/** A form with everything filled, which each test then breaks in one place. */
const good = (): FormState => ({
  ...emptyForm(),
  recipient: { companyName: '', vatNumber: '', contactName: 'Maria Georgiou', phone: '+357 99123456', email: 'maria@example.com', deliveryInstructions: '' },
  address: { countryIso: 'CY', postalCode: '1010', city: 'Nicosia', state: '', line1: '5 Makariou Ave', line2: '', line3: '' },
  packages: [{ ...emptyPackage(), lengthCm: '30', widthCm: '20', heightCm: '10', weightKg: '2.5', goodsDescription: 'Guitar strings' }],
});

describe('fieldProblem', () => {
  it('accepts an ordinary email address and refuses what is not one', () => {
    expect(fieldProblem('email', 'maria@example.com')).toBeNull();
    expect(fieldProblem('email', 'maria@example')).toContain('name@company.com');
    expect(fieldProblem('email', 'maria')).not.toBeNull();
    expect(fieldProblem('email', '')).toBe('This is needed.');
  });

  it('accepts a real number however it is spaced, and refuses digits that are not one', () => {
    expect(fieldProblem('phone', '+357 99123456')).toBeNull();
    expect(fieldProblem('phone', '+44 (0) 20 7946 0000')).toBeNull();
    expect(fieldProblem('phone', '12345')).not.toBeNull();
    expect(fieldProblem('phone', 'call me')).not.toBeNull();
    // The right length, the right shape, and not a Cyprus number. The old shape check let it by.
    expect(fieldProblem('phone', '+357 111111')).not.toBeNull();
  });

  it('reads a number with no prefix against the delivery country, and asks for one otherwise', () => {
    expect(fieldProblem('phone', '99123456', 'CY')).toBeNull();
    expect(fieldProblem('phone', '99123456')).toContain('+357 99123456');
  });

  it('wants a number above zero where it asks for one', () => {
    expect(fieldProblem('positive', '2.5')).toBeNull();
    expect(fieldProblem('positive', '2,5')).toBeNull();
    expect(fieldProblem('positive', '0')).toContain('more than zero');
    expect(fieldProblem('positive', '-1')).toContain('more than zero');
    expect(fieldProblem('positive', 'heavy')).toContain('number');
  });

  it('treats whitespace as nothing', () => {
    expect(fieldProblem('required', '   ')).toBe('This is needed.');
    expect(fieldProblem('required', 'Maria')).toBeNull();
  });
});

describe('sectionComplete', () => {
  it('calls a fully filled form complete', () => {
    expect(sectionComplete(good())).toEqual({ order: true, customer: true, address: true, collection: true, packages: true });
    expect(formComplete(good())).toBe(true);
  });

  it('never blocks on the order section — none of it is required', () => {
    expect(sectionComplete(emptyForm()).order).toBe(true);
  });

  it('marks the customer section short of a name, a phone or an email', () => {
    const noName = good(); noName.recipient.contactName = '';
    const badPhone = good(); badPhone.recipient.phone = 'x';
    const badEmail = good(); badEmail.recipient.email = 'nope';
    expect(sectionComplete(noName).customer).toBe(false);
    expect(sectionComplete(badPhone).customer).toBe(false);
    expect(sectionComplete(badEmail).customer).toBe(false);
  });

  it('wants a country, a postal code, a city and a first address line', () => {
    for (const field of ['countryIso', 'postalCode', 'city', 'line1'] as const) {
      const form = good();
      form.address[field] = '';
      expect(sectionComplete(form).address, `missing ${field}`).toBe(false);
    }
  });

  it('does not mind a missing state or second address line', () => {
    const form = good();
    form.address.state = '';
    form.address.line2 = '';
    expect(sectionComplete(form).address).toBe(true);
  });

  it('wants every measurement on every package, not just the first', () => {
    const form = good();
    form.packages = [form.packages[0], { ...emptyPackage(), goodsDescription: 'Cables' }];
    expect(sectionComplete(form).packages).toBe(false);
  });

  it('asks for a battery type only once dangerous goods are declared', () => {
    const form = good();
    expect(sectionComplete(form).packages).toBe(true);
    form.packages[0].dangerousGoods = true;
    expect(sectionComplete(form).packages).toBe(false);
    form.packages[0].batteryType = 'pi966';
    expect(sectionComplete(form).packages).toBe(true);
  });

  it('asks for a declared value only once insurance is asked for', () => {
    const form = good();
    form.packages[0].insurance = true;
    expect(sectionComplete(form).packages).toBe(false);
    form.packages[0].declaredValue = '250';
    expect(sectionComplete(form).packages).toBe(true);
  });

  it('refuses a form with no packages at all', () => {
    const form = good();
    form.packages = [];
    expect(sectionComplete(form).packages).toBe(false);
    expect(formComplete(form)).toBe(false);
  });
});

describe('the customs line and the collection address', () => {
  const EU = new Set(['CY', 'GR', 'DE']);
  const toUk = (): FormState => ({ ...good(), address: { ...good().address, countryIso: 'GB', postalCode: 'LS1 1AA', city: 'Leeds' } });

  it('is asked for outside the EU only — the same rule the API applies', () => {
    expect(customsNeeded(good(), EU)).toBe(false);
    expect(customsNeeded(toUk(), EU)).toBe(true);
    // No list, nothing asked: the API checks again on receipt.
    expect(customsNeeded(toUk(), new Set())).toBe(false);
  });

  it('keeps the packages section open until each box has a value, an HS code and an origin', () => {
    const f = toUk();
    expect(sectionComplete(f, EU).packages).toBe(false);
    f.packages = [{ ...f.packages[0], declaredValue: '40', hsCode: '9209.94', countryOfOrigin: 'CN' }];
    expect(sectionComplete(f, EU).packages).toBe(true);
    expect(sectionComplete(good(), EU).packages).toBe(true);
  });

  it('checks the shape of an HS code and a quantity wherever they are given', () => {
    expect(fieldProblem('hs', '')).toBeNull();
    expect(fieldProblem('hs', '8516.79')).toBeNull();
    expect(fieldProblem('hs', 'guitar')).toContain('6 to 10 digits');
    expect(fieldProblem('hsRequired', '')).toContain('needed');
    expect(fieldProblem('whole', '')).toBeNull();
    expect(fieldProblem('whole', '3')).toBeNull();
    expect(fieldProblem('whole', '1.5')).toContain('whole number');
  });

  it('treats an empty collection address as goods already at our warehouse, and half of one as unfinished', () => {
    expect(hasCollection(good().collection)).toBe(false);
    expect(sectionComplete(good()).collection).toBe(true);
    const half = { ...good(), collection: { ...good().collection, city: 'Limassol' } };
    expect(sectionComplete(half).collection).toBe(false);
    const whole = { ...good(), collection: { ...good().collection, contactName: 'Nikos', phone: '+357 22123456', countryIso: 'CY', postalCode: '3000', city: 'Limassol', line1: '1 Port Road' } };
    expect(sectionComplete(whole).collection).toBe(true);
  });
});

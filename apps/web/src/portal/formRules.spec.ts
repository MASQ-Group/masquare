import { describe, expect, it } from 'vitest';
import { fieldProblem, formComplete, sectionComplete } from './formRules';
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

  it('accepts a phone number however it is spaced', () => {
    expect(fieldProblem('phone', '+357 99123456')).toBeNull();
    expect(fieldProblem('phone', '(0) 20 7946 0000')).toBeNull();
    expect(fieldProblem('phone', '12345')).not.toBeNull();
    expect(fieldProblem('phone', 'call me')).not.toBeNull();
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
    expect(sectionComplete(good())).toEqual({ order: true, customer: true, address: true, packages: true });
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

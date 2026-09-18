import { describe, expect, it } from 'vitest';
import {
  BATTERY_TYPES, INSURANCE_RATE, insuranceAmount, isComplete, problemsWith, totalDeclaredValue, totalInsurance,
  type PackageForm, type ShipmentForm,
} from './shipment-form';

const parcel = (over: Partial<PackageForm> = {}): PackageForm => ({
  lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 2.4,
  goodsDescription: 'Guitar strings',
  dangerousGoods: false,
  priorityHandling: false,
  insurance: false,
  ...over,
});

const form = (over: Partial<ShipmentForm> = {}): ShipmentForm => ({
  orderReference: 'PO-4471',
  recipient: { contactName: 'Maria Georgiou', phone: '+357 99 123456', email: 'maria@example.com' },
  address: { countryIso: 'CY', postalCode: '1010', city: 'Nicosia', line1: '12 Makarios Avenue' },
  packages: [parcel()],
  ...over,
});

const complain = (f: ShipmentForm) => problemsWith(f).join(' | ');

describe('a complete form', () => {
  it('passes', () => {
    expect(problemsWith(form())).toEqual([]);
    expect(isComplete(form())).toBe(true);
  });

  it('does not demand the optional things', () => {
    const bare = form({
      orderReference: null,
      serialNumbers: [],
      recipient: { contactName: 'A B', phone: '+357 99123456', email: 'a@b.com' },
      address: { countryIso: 'CY', postalCode: '1', city: 'X', line1: 'Y' },
    });
    expect(problemsWith(bare)).toEqual([]);
  });
});

describe('who it is going to', () => {
  it('refuses a phone number the courier could not dial, and says what a good one looks like', () => {
    // Present, but not a number in the country the parcel is going to.
    const problems = problemsWith(form({ recipient: { contactName: 'A B', phone: '12345', email: 'a@b.com' } }));
    expect(problems.join(' ')).toContain('will not reach anybody');
    expect(problems.join(' ')).toMatch(/looks like \d/);
  });

  it('accepts a local number read against the delivery country', () => {
    // No prefix typed; the delivery country says which plan to read it against.
    expect(problemsWith(form({ recipient: { contactName: 'A B', phone: '99123456', email: 'a@b.com' } }))).toEqual([]);
  });

  it('insists on a name, a phone number and an email', () => {
    const missing = problemsWith(form({ recipient: {} }));
    expect(missing).toHaveLength(3);
    expect(missing.join(' ')).toContain('contact name');
  });

  it('checks the email is an email', () => {
    expect(complain(form({ recipient: { contactName: 'A', phone: '+357 99123456', email: 'maria at example' } }))).toContain('does not look like an address');
  });
});

describe('where it is going', () => {
  it('insists on country, postcode, city and a first line', () => {
    expect(problemsWith(form({ address: {} }))).toHaveLength(4);
  });

  it('asks nothing of the second and third lines, or the state', () => {
    expect(problemsWith(form({ address: { countryIso: 'CY', postalCode: '1010', city: 'Nicosia', line1: 'A' } }))).toEqual([]);
  });
});

describe('the packages', () => {
  it('needs at least one', () => {
    expect(complain(form({ packages: [] }))).toContain('at least one package');
  });

  it('needs a weight and all three dimensions on each', () => {
    const missing = problemsWith(form({ packages: [parcel({ weightKg: null, heightCm: null })] }));
    expect(missing.join(' ')).toContain('needs a weight');
    expect(missing.join(' ')).toContain('length, width and height');
  });

  it('needs a description of the goods', () => {
    expect(complain(form({ packages: [parcel({ goodsDescription: '  ' })] }))).toContain('description of the goods');
  });

  /** A form of four packages with one empty box is a hunt unless the message says which. */
  it('says which package is wrong when there are several', () => {
    const problems = problemsWith(form({ packages: [parcel(), parcel({ weightKg: 0 }), parcel()] }));
    expect(problems.join(' ')).toContain('Package 2 needs a weight');
  });

  it('says "the package" when there is only one', () => {
    expect(complain(form({ packages: [parcel({ weightKg: 0 })] }))).toContain('The package needs a weight');
  });
});

describe('dangerous goods', () => {
  it('must be answered either way', () => {
    expect(complain(form({ packages: [parcel({ dangerousGoods: null })] }))).toContain('whether it holds dangerous goods');
  });

  it('needs a battery type when the answer is yes', () => {
    expect(complain(form({ packages: [parcel({ dangerousGoods: true })] }))).toContain('needs a battery type');
  });

  it('accepts a battery type from the list', () => {
    expect(problemsWith(form({ packages: [parcel({ dangerousGoods: true, batteryType: 'li_ion_in_equipment' })] }))).toEqual([]);
  });

  it('refuses one that is not', () => {
    expect(complain(form({ packages: [parcel({ dangerousGoods: true, batteryType: 'AA batteries' })] }))).toContain('do not recognise');
  });

  /** The packing instruction is the point: a carrier's DG desk works in PI numbers. */
  it('offers the packing instructions a carrier asks for', () => {
    const labels = BATTERY_TYPES.map((b) => b.label).join(' ');
    for (const pi of ['PI 965', 'PI 966', 'PI 967', 'PI 968', 'PI 969', 'PI 970']) expect(labels).toContain(pi);
  });
});

describe('insurance', () => {
  it('is one per cent of the declared value', () => {
    expect(INSURANCE_RATE).toBe(0.01);
    expect(insuranceAmount(1000, true)).toBe(10);
    expect(insuranceAmount(149.99, true)).toBe(1.5);
  });

  it('is nothing when it was not asked for', () => {
    expect(insuranceAmount(1000, false)).toBeNull();
  });

  it('is nothing when there is no declared value to insure', () => {
    expect(insuranceAmount(null, true)).toBeNull();
    expect(insuranceAmount(0, true)).toBeNull();
  });

  /**
   * Refused rather than charged at zero: somebody who ticks insurance believes the parcel is
   * covered, and now is the moment to correct that rather than after a loss.
   */
  it('refuses a form that insures a parcel with no declared value', () => {
    expect(complain(form({ packages: [parcel({ insurance: true })] }))).toContain('needs a declared value');
  });

  it('adds up across the packages, counting only the insured ones', () => {
    const packages = [parcel({ insurance: true, declaredValue: 200 }), parcel({ declaredValue: 500 }), parcel({ insurance: true, declaredValue: 50 })];
    expect(totalInsurance(packages)).toBe(2.5);
  });

  it('is zero when nothing is insured', () => {
    expect(totalInsurance([parcel({ declaredValue: 900 })])).toBe(0);
  });
});

describe('what the shipment is worth', () => {
  it('adds every declared value, insured or not', () => {
    expect(totalDeclaredValue([parcel({ declaredValue: 200 }), parcel({ declaredValue: 49.5 }), parcel()])).toBe(249.5);
  });

  it('is zero when nothing was declared', () => {
    expect(totalDeclaredValue([parcel()])).toBe(0);
  });
});

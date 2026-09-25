import { describe, expect, it } from 'vitest';
import { normaliseSafety, onbuyProductData, onbuySafetyBody, parseOnbuyFields, readMeasurement, resolveOnbuyFields } from './onbuy-fields';

/** Shapes from OnBuy's own documented responses. */
const FEATURES = [
  { name: 'Colour', feature_id: 1, required: true, options: [{ option_id: 11, name: 'Black' }, { option_id: 12, name: 'Grey' }] },
  { name: 'Size', feature_id: 4149925, required: false, options: [{ option_id: 18137154, name: 'Small' }] },
];
const TECHNICAL = [
  { group_id: '2', group_name: 'Office Chair Dimensions', options: [
    { detail_id: '4', name: 'Seat Width', units: ['m', 'cm', 'mm', 'in'] },
    { detail_id: '9', name: 'Size', units: ['cm'] },
  ] },
  { group_id: '3', group_name: 'Weight', options: [{ detail_id: '20', name: 'Weight', units: ['kg'] }] },
  // Real categories carry details with no units at all: a colour, a warranty, a material.
  { group_id: '5', group_name: 'General Product Information', options: [
    { detail_id: '31', name: 'Finish' },
    { detail_id: '32', name: 'Manufacturer Warranty', units: [] },
  ] },
];

const rec = (value: string) => ({ value, origins: [{ kind: 'manufacturer' as const, value, url: 'https://x' }] });

describe('parseOnbuyFields', () => {
  it('reads features with their options and technical details with their units', () => {
    const fields = parseOnbuyFields(FEATURES, TECHNICAL);
    expect(fields.map((f) => f.name)).toEqual(['Colour', 'Size', 'Seat Width', 'Office Chair Dimensions › Size', 'Weight', 'Finish', 'Manufacturer Warranty']);
    expect(fields[0]).toMatchObject({ kind: 'feature', required: true, options: [{ id: '11', name: 'Black' }, { id: '12', name: 'Grey' }] });
    expect(fields[2]).toMatchObject({ kind: 'technical', detailId: '4', units: ['m', 'cm', 'mm', 'in'] });
  });
});

describe('readMeasurement', () => {
  it('reads a number and a unit in the spellings sources use', () => {
    expect(readMeasurement('45 cm', ['cm', 'mm'])).toEqual({ value: '45', unit: 'cm' });
    expect(readMeasurement('4,5 kilograms', ['kg'])).toEqual({ value: '4.5', unit: 'kg' });
    expect(readMeasurement('17"', ['cm', 'in'])).toEqual({ value: '17', unit: 'in' });
  });
  it('takes the only unit when none is written, and refuses a guess otherwise', () => {
    expect(readMeasurement('9', ['kg'])).toEqual({ value: '9', unit: 'kg' });
    expect(readMeasurement('9', ['cm', 'in'])).toHaveProperty('why');
    expect(readMeasurement('45 ft', ['cm'])).toHaveProperty('why');
    expect(readMeasurement('about 45cm', ['cm'])).toHaveProperty('why');
  });
});

describe('resolveOnbuyFields', () => {
  const fields = parseOnbuyFields(FEATURES, TECHNICAL);

  /**
   * The failure this was written for. Every technical detail went through the measurement reader,
   * which checks the unit against the field's list - so a field with an EMPTY list rejected every
   * answer whatever it said. A live OnBuy listing was refused with Colour "Black" called "not a
   * single number with a unit", and Capacity "9.2 L" called a unit OnBuy does not take "()".
   * A list we do not have is not a list that forbids everything.
   */
  it('sends a detail with no units as the text it is', () => {
    const r = resolveOnbuyFields(fields, { Finish: rec('Black'), 'Manufacturer Warranty': rec('2 years') });
    expect(r.technical).toEqual([{ detail_id: 31, value: 'Black' }, { detail_id: 32, value: '2 years' }]);
    expect(r.rejected).toEqual([]);
  });

  /** A detail that DOES declare units is still a measurement, and a wrong unit is still refused. */
  it('still holds measurements to the units OnBuy lists', () => {
    const r = resolveOnbuyFields(fields, { 'Seat Width': rec('52 ft') });
    expect(r.technical).toEqual([]);
    expect(r.rejected[0].why).toContain('not one OnBuy takes here');
  });

  it('sends an option by its id and a measurement with its unit', () => {
    const r = resolveOnbuyFields(fields, { Colour: rec('black'), 'Seat Width': rec('52 cm'), Weight: rec('9') });
    expect(r.features).toEqual([{ option_id: 11 }]);
    expect(r.technical).toEqual([{ detail_id: 4, value: '52', unit: 'cm' }, { detail_id: 20, value: '9', unit: 'kg' }]);
    expect(r.missing).toEqual([]);
  });

  it('reports a required feature with no usable answer, and an answer off OnBuy’s list', () => {
    const r = resolveOnbuyFields(fields, { Colour: rec('Navy') });
    expect(r.missing).toEqual(['Colour']);
    expect(r.rejected).toEqual([{ name: 'Colour', value: 'Navy', why: 'not one of OnBuy’s options for it' }]);
  });

  it('does not send a held-back suggestion', () => {
    // A single web page is a suggestion, not an answer.
    const r = resolveOnbuyFields(fields, { Colour: { value: 'Black', origins: [{ kind: 'web', value: 'Black', url: 'https://shop.example' }] } });
    expect(r.features).toEqual([]);
    expect(r.missing).toEqual(['Colour']);
  });
});

describe('product data and safety', () => {
  it('builds the spec table from verified specifics, without repeating brand and codes', () => {
    expect(onbuyProductData({ Brand: 'Casio', MPN: 'X1', Colour: 'Black', 'Case Material': 'Steel' }, { Colour: 'Design' }))
      .toEqual([{ label: 'Colour', value: 'Black', group: 'Design' }, { label: 'Case Material', value: 'Steel' }]);
  });
  it('sends only the safety parts that were written', () => {
    const s = normaliseSafety({ warnings: '  Keep away from children. ', usageInstructions: '', ingredients: null });
    expect(onbuySafetyBody(s)).toEqual({ warnings: 'Keep away from children.' });
    expect(onbuySafetyBody(normaliseSafety(null))).toBeNull();
  });
});

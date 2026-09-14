import { describe, expect, it } from 'vitest';
import { comparable, groupByMeaning, valuesAgree } from './value-match';

describe('valuesAgree — spellings of one answer', () => {
  it('sees through unit words, spacing and casing', () => {
    expect(valuesAgree('1200 Watts', '1200W')).toBe(true);
    expect(valuesAgree('1200 W', '1200 watt')).toBe(true);
    expect(valuesAgree('Stainless Steel', 'stainless steel ')).toBe(true);
  });

  it('sees through thousands separators and trailing zeros', () => {
    expect(valuesAgree('1,200 W', '1200 W')).toBe(true);
    expect(valuesAgree('1.50 kg', '1.5 kg')).toBe(true);
    expect(valuesAgree('2.0 L', '2 litres')).toBe(true);
  });

  it('sees through British and American spelling', () => {
    expect(valuesAgree('Colour: Grey', 'Color: Gray')).toBe(true);
    expect(valuesAgree('Aluminium', 'aluminum')).toBe(true);
  });

  it('sees through how a dimension is punctuated', () => {
    expect(valuesAgree('30 x 40 cm', '30x40cm')).toBe(true);
    expect(valuesAgree('30 × 40 cm', '30 x 40 centimetres')).toBe(true);
  });
});

/**
 * The half that matters more. Every case here is one where a looser normaliser would invent an
 * agreement, and an invented agreement publishes a value nobody checked.
 */
describe('valuesAgree — what must never be called agreement', () => {
  it('does not convert between units', () => {
    expect(valuesAgree('1200 W', '1.2 kW')).toBe(false);
    expect(valuesAgree('500 g', '0.5 kg')).toBe(false);
    expect(valuesAgree('1 m', '100 cm')).toBe(false);
  });

  it('does not confuse one unit for another', () => {
    expect(valuesAgree('12 V', '12 W')).toBe(false);
    expect(valuesAgree('50 Hz', '50 W')).toBe(false);
  });

  it('does not treat different numbers as close enough', () => {
    expect(valuesAgree('1200 W', '1250 W')).toBe(false);
    expect(valuesAgree('1200 W', '12000 W')).toBe(false);
  });

  it('does not treat different words as the same colour', () => {
    expect(valuesAgree('Silver', 'Grey')).toBe(false);
    expect(valuesAgree('Stainless Steel', 'Steel')).toBe(false);
  });

  /**
   * Two sources finding nothing is no evidence, not corroboration. Agreement on blank would write
   * an empty item specific carrying a confident provenance.
   */
  it('never lets blank agree with anything, including blank', () => {
    expect(valuesAgree('', '')).toBe(false);
    expect(valuesAgree('   ', '')).toBe(false);
    expect(valuesAgree('1200 W', '')).toBe(false);
  });
});

describe('comparable', () => {
  it('is only a comparison key — the original spelling is never touched', () => {
    // What it produces is deliberately ugly; nothing shows it to anybody.
    expect(comparable('1,200 Watts')).toBe('1200w');
    expect(comparable('  Stainless   Steel ')).toBe('stainless steel');
  });

  it('leaves a prefixed unit alone, so it cannot collapse into the base unit', () => {
    expect(comparable('1.2 kW')).not.toBe(comparable('1200 W'));
    expect(comparable('5 mg')).not.toBe(comparable('5 g'));
  });

  it('does not mangle an identifier that happens to contain a unit letter', () => {
    expect(comparable('LR200-W')).toBe('lr200-w');
    expect(comparable('A4')).toBe('a4');
  });
});

describe('groupByMeaning', () => {
  const say = (kind: string, value: string) => ({ kind, value });

  it('groups the spellings and keeps the first one', () => {
    const out = groupByMeaning(
      [say('manufacturer', '1200 W'), say('amazon', '1200 Watts'), say('ebay', '1500 W')],
      (x) => x.value,
    );
    expect(out).toEqual([
      { value: '1200 W', items: [say('manufacturer', '1200 W'), say('amazon', '1200 Watts')] },
      { value: '1500 W', items: [say('ebay', '1500 W')] },
    ]);
  });

  /** Source order is priority order, so the stored spelling is the best source's own words. */
  it('keeps the first spelling even when a later one is repeated more often', () => {
    const out = groupByMeaning(
      [say('manufacturer', '1200 W'), say('amazon', '1200 Watts'), say('ebay', '1200 watts')],
      (x) => x.value,
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('1200 W');
  });

  it('drops anything blank rather than grouping it', () => {
    expect(groupByMeaning([say('amazon', '  '), say('ebay', '1200 W')], (x) => x.value))
      .toEqual([{ value: '1200 W', items: [say('ebay', '1200 W')] }]);
  });
});

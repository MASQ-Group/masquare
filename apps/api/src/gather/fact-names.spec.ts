import { describe, expect, it } from 'vitest';
import { byCanonicalName, canonicalFactName, factFor, sameFact, withSharedFacts } from './fact-names';

describe('one name for a fact', () => {
  /**
   * The ways a marketplace can spell the same field without meaning anything different: a group
   * prefix, punctuation, case, a parenthetical unit. Treating these as different fields is how the
   * same answer came to be researched once for eBay and again for OnBuy.
   */
  it('takes off what does not change the meaning', () => {
    expect(canonicalFactName('General Product Information › Colour')).toBe('colour');
    expect(canonicalFactName('  COLOUR ')).toBe('colour');
    expect(canonicalFactName('Weight (kg)')).toBe('weight');
    expect(canonicalFactName('Manufacturer-Part-Number')).toBe('mpn');
    expect(canonicalFactName('')).toBe('');
  });

  it('folds the genuine synonyms and nothing else', () => {
    expect(sameFact('Color', 'Colour')).toBe(true);
    expect(sameFact('Wattage', 'Power consumption')).toBe(true);
    expect(sameFact('Manufacturer Warranty', 'Warranty period')).toBe(true);
    /**
     * Capacity and Volume are deliberately NOT synonyms. A kettle's capacity is its volume; a
     * battery's is not. A mapping right most of the time is the kind that puts a wrong figure on a
     * listing and is never noticed.
     */
    expect(sameFact('Capacity', 'Volume')).toBe(false);
  });

  it('leaves a name it has never been taught alone', () => {
    expect(canonicalFactName('Blade Retention System')).toBe('blade retention system');
    expect(sameFact('Blade Retention System', 'Blade guard')).toBe(false);
  });
});

describe('finding what we hold, by the name a channel uses', () => {
  const store = { Colour: 'Black', 'Seat Width': '52 cm' };

  /** Exact first: a store already holding the channel's own spelling is not reinterpreted. */
  it('prefers the exact name, then falls back to the canonical one', () => {
    expect(factFor(store, 'Colour')).toBe('Black');
    expect(factFor(store, 'Color')).toBe('Black');
    expect(factFor(store, 'General Product Information › Colour')).toBe('Black');
    expect(factFor(store, 'Seat width')).toBe('52 cm');
    expect(factFor(store, 'Wattage')).toBeUndefined();
  });

  it('keys everything canonically, keeping the spelling each answer came under', () => {
    const m = byCanonicalName(store);
    expect(m.get('colour')).toEqual({ name: 'Colour', value: 'Black' });
    expect([...m.keys()]).toEqual(['colour', 'seat width']);
  });

  /** Two spellings of one fact keep the first, so the result never depends on iteration order. */
  it('does not let the last one seen win', () => {
    const m = byCanonicalName({ Colour: 'Black', Color: 'Grey' });
    expect(m.get('colour')!.value).toBe('Black');
    expect(m.size).toBe(1);
  });
});

describe('a channel reading what is known generally', () => {
  const shared = { colour: 'Black', power: '2100 W', 'seat width': '52 cm' };

  /**
   * The channel's own record always wins: it was researched against that channel's field, may carry
   * a person's edit, and is the answer somebody reviewed. The shared store is the floor underneath.
   */
  it('never overwrites an answer the channel already has', () => {
    const out = withSharedFacts({ Colour: 'Grey' }, shared, ['Colour', 'Wattage']);
    expect(out.Colour).toBe('Grey');
    expect(out.Wattage).toBe('2100 W');
  });

  /** Filled under the name the CHANNEL uses, so the resolver needs no idea this happened. */
  it('answers under the channel’s own spelling', () => {
    expect(withSharedFacts({}, shared, ['Color'])).toEqual({ Color: 'Black' });
    expect(withSharedFacts({}, shared, ['General Product Information › Colour']))
      .toEqual({ 'General Product Information › Colour': 'Black' });
  });

  /** A known fact no field asks for is not smuggled into a payload because it happens to exist. */
  it('fills only the fields asked for', () => {
    expect(withSharedFacts({}, shared, ['Colour'])).toEqual({ Colour: 'Black' });
  });

  it('leaves a field nothing answers alone', () => {
    expect(withSharedFacts({}, shared, ['Blade Retention System'])).toEqual({});
  });
});

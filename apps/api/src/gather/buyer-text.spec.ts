import { describe, expect, it } from 'vitest';
import { checkBuyerText, TEXT_LIMITS } from './buyer-text';

const SKUS = ['3G-RP-HJE201E-K-FOC', 'IT45604'];

const problemsIn = (text: string) => checkBuyerText({ intro: text }, SKUS).map((p) => p.problem);

describe('checkBuyerText', () => {
  it('passes ordinary selling prose', () => {
    expect(checkBuyerText({
      intro: 'Everyday earphones with a comfortable fit.\n\nThe 9 mm drivers deliver a warm sound.',
      features: ['9 mm neodymium drivers', '1.2 m cable'],
    }, SKUS)).toEqual([]);
  });

  /** The business rule: our own code means nothing to a buyer and says how the catalogue works. */
  it('refuses our internal SKU, wherever it appears', () => {
    expect(problemsIn('Great earphones, 3G-RP-HJE201E-K-FOC, in black')[0]).toContain('internal SKU');
    expect(checkBuyerText({ features: ['Model it45604 shown'] }, SKUS)[0].problem).toContain('internal SKU');
  });

  /** But not the manufacturer's — buyers search for that. */
  it('allows the manufacturer part number', () => {
    expect(checkBuyerText({ intro: 'The Panasonic RP-HJE201E-K in black.' }, SKUS)).toEqual([]);
  });

  it('refuses what eBay bans in a description', () => {
    expect(problemsIn('Questions? sales@example.com')[0]).toContain('email');
    expect(problemsIn('See www.example.com for more')[0]).toContain('web address');
    expect(problemsIn('Call 01234 567890')[0]).toContain('phone number');
  });

  it('refuses markup, because the platform does the formatting', () => {
    expect(problemsIn('<p>Nice earphones</p>')[0]).toContain('HTML');
  });

  it('refuses text that is too long, rather than cutting it mid-sentence', () => {
    expect(problemsIn('x'.repeat(TEXT_LIMITS.intro + 1))[0]).toContain('longer than');
    expect(checkBuyerText({ features: ['y'.repeat(TEXT_LIMITS.feature + 1)] }, SKUS)[0].where).toBe('feature 1');
  });

  it('refuses a wall of feature lines', () => {
    const many = Array.from({ length: TEXT_LIMITS.features + 1 }, (_, i) => `Feature ${i}`);
    expect(checkBuyerText({ features: many }, SKUS)[0].problem).toContain('more than');
  });

  it('says which line is wrong, so it can be rewritten rather than all of it', () => {
    const out = checkBuyerText({ features: ['Fine', 'Call 01234 567890', 'Also fine'] }, SKUS);
    expect(out).toHaveLength(1);
    expect(out[0].where).toBe('feature 2');
  });

  it('ignores a code too short to match anything but by accident', () => {
    expect(checkBuyerText({ intro: 'Comes in a set of ABC' }, ['ABC'])).toEqual([]);
  });

  it('is happy with nothing at all', () => {
    expect(checkBuyerText({}, SKUS)).toEqual([]);
    expect(checkBuyerText({ intro: '   ', features: ['', '  '] }, SKUS)).toEqual([]);
  });
});

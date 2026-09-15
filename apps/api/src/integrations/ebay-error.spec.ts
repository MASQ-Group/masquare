import { describe, expect, it } from 'vitest';
import { ebayErrorText } from './ebay-error';

describe('ebayErrorText', () => {
  /** The shape eBay uses: a generic wrapper first, the actual reason after it. */
  it('keeps every error, not just the first', () => {
    const text = ebayErrorText({
      errors: [
        { errorId: 25019, message: 'Cannot revise listing', longMessage: 'The item cannot be listed or modified.' },
        { errorId: 25002, message: 'A user error has occurred. Brand not allowed in this category.' },
      ],
    });
    expect(text).toBe('[25019] Cannot revise listing — The item cannot be listed or modified. | [25002] A user error has occurred. Brand not allowed in this category.');
  });

  it('includes the reason eBay tucks into the parameters', () => {
    const text = ebayErrorText({
      errors: [{
        errorId: 25019,
        message: 'Cannot revise listing',
        parameters: [{ name: 'offerId', value: '266554920011' }, { name: '0', value: 'The listing contains words that are not allowed: "Cordura".' }],
      }],
    });
    expect(text).toContain('words that are not allowed');
    expect(text).not.toContain('266554920011');
  });

  it('says a repeated message once', () => {
    expect(ebayErrorText({ errors: [{ message: 'Invalid SKU', longMessage: 'Invalid SKU' }] })).toBe('Invalid SKU');
  });

  it('is empty for a body with no errors', () => {
    expect(ebayErrorText(null)).toBe('');
    expect(ebayErrorText({ errors: [] })).toBe('');
  });

  it('caps a runaway answer', () => {
    const long = ebayErrorText({ errors: [{ message: 'x '.repeat(2000) }] }, 100);
    expect(long.length).toBeLessThanOrEqual(100);
  });
});

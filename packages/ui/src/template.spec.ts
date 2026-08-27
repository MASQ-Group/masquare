import { describe, expect, it } from 'vitest';
import { columnLetter } from './template';

/**
 * Excel column letters are base-26 with no zero, which is the kind of arithmetic that looks right
 * and is wrong at the boundary. An off-by-one here does not throw: it points a dropdown at the
 * neighbouring column, so the template opens, looks correct, and validates the wrong thing.
 *
 * The FBA template wants Sales Channel on C and Shipping Service on D — indexes 2 and 3.
 */
describe('columnLetter', () => {
  it('maps the columns the FBA template actually uses', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(2)).toBe('C'); // Sales Channel
    expect(columnLetter(3)).toBe('D'); // Shipping Service
  });

  it('handles the end of the first block, where naive base-26 breaks', () => {
    expect(columnLetter(24)).toBe('Y');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
  });

  it('carries correctly at the next boundary', () => {
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
    expect(columnLetter(701)).toBe('ZZ');
    expect(columnLetter(702)).toBe('AAA');
  });

  it('never produces an empty reference', () => {
    // An empty letter would build a formula like Lists!$$2:$$9, which Excel rejects by silently
    // dropping the validation — free text accepted again, with nothing to show it happened.
    for (let i = 0; i < 200; i++) expect(columnLetter(i)).toMatch(/^[A-Z]+$/);
  });
});

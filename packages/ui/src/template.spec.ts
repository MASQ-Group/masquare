import { describe, expect, it } from 'vitest';
import { columnLetter, validationRange } from './template';

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

/**
 * Which rows carry the dropdown.
 *
 * The original range started below the sample rows, which is correct for a blank template and
 * wrong for a file exported to be edited: there the rows ARE the data, so the dropdowns landed
 * everywhere except the cells anyone was going to touch.
 */
describe('validationRange', () => {
  it('arms rows that already hold data, not just the blank ones under them', () => {
    // 200 exported products: every one of rows 2–201 must be armed.
    const r = validationRange(200);
    expect(r.first).toBe(2);
    expect(r.last).toBeGreaterThanOrEqual(201);
  });

  it('starts directly under the header, never at the header', () => {
    // Row 1 is the header. Arming it would put a dropdown on a column name.
    for (const n of [0, 1, 5, 1000]) expect(validationRange(n).first).toBe(2);
  });

  it('keeps blank rows to fill in below whatever is already there', () => {
    // A blank template still needs room to type into; an export still needs room to add rows.
    expect(validationRange(0, 500).last).toBe(501);
    expect(validationRange(200, 500).last).toBe(701);
  });

  it('covers every sample row plus the spare capacity, with no off-by-one at the join', () => {
    const rows = 3;
    const spare = 10;
    const r = validationRange(rows, spare);
    // rows 2,3,4 are the samples; 5..14 are spare. Last armed row is 14.
    expect(r.last).toBe(1 + rows + spare);
    expect(r.last - r.first + 1).toBe(rows + spare);
  });
});

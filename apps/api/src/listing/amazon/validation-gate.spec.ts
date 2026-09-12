import { describe, expect, it } from 'vitest';
import { readValidation } from './validation-gate';

/**
 * The one refusal worth testing for real, and every refusal that is not.
 *
 * The listing flow validates immediately before submitting. Treating that as final made
 * `VALIDATION_PREVIEW` the final word — and for 100398 it is demonstrably not: Seller Central
 * creates the same SKU on the same marketplace that validation refuses. Believing it cost a
 * permanent SKU split every time.
 */

const err = (code: string, message = 'x') => ({ code, message, severity: 'ERROR' });
const warn = (code: string, message = 'x') => ({ code, message, severity: 'WARNING' });

const SKU_IN_USE = err('100398', "SKU 'IT33136' already exists in other Amazon marketplace(s). Use a new SKU and resubmit your listing.");

describe('readValidation', () => {
  it('does not block on a lone SKU-in-use error — Amazon gets asked for real', () => {
    const v = readValidation([SKU_IN_USE]);
    expect(v.blocked).toBe(false);
    expect(v.skuInUse).toBe(true);
  });

  /** Recognised by wording as well as code, since the code has not always been present. */
  it('recognises the refusal from its wording alone', () => {
    const v = readValidation([{ code: '', message: 'Use a new SKU and resubmit your listing.', severity: 'ERROR' }]);
    expect(v.blocked).toBe(false);
    expect(v.skuInUse).toBe(true);
  });

  it('blocks on any other error', () => {
    const v = readValidation([err('4000001', 'The attribute brand is required')]);
    expect(v.blocked).toBe(true);
    expect(v.skuInUse).toBe(false);
    expect(v.blockingIssues).toHaveLength(1);
  });

  /**
   * The case that decides this is judged per issue rather than per list.
   *
   * A reply carrying both would otherwise sail through on the strength of the SKU error, then fail
   * the real submit for the missing attribute — looking like we ignored Amazon twice.
   */
  it('blocks when a SKU error arrives alongside a real one, and names the real one', () => {
    const v = readValidation([SKU_IN_USE, err('4000001', 'The attribute brand is required')]);
    expect(v.blocked).toBe(true);
    expect(v.skuInUse).toBe(true);
    expect(v.blockingIssues.map((i) => i.code)).toEqual(['4000001']);
  });

  /**
   * The ASIN-binding refusal is a different problem with a different fix — one SKU cannot point at
   * two ASINs across a region — and a new SKU name would not solve it. It must still block.
   */
  it('blocks on the ASIN-binding refusal rather than offering a new name', () => {
    const v = readValidation([err('101077', 'the seller-suggested ASIN value is not uniform across active Amazon sales sites: B01BM58XJQ, B01FAWGUTW')]);
    expect(v.blocked).toBe(true);
    expect(v.skuInUse).toBe(false);
  });

  it('ignores warnings, which Amazon returns on submissions it accepts', () => {
    const v = readValidation([warn('99001', 'Image is smaller than recommended')]);
    expect(v.blocked).toBe(false);
    expect(v.skuInUse).toBe(false);
  });

  /** Severity is absent often enough that assuming ERROR is the safe reading. */
  it('treats an issue with no severity as an error', () => {
    const v = readValidation([{ code: '4000001', message: 'The attribute brand is required' }]);
    expect(v.blocked).toBe(true);
  });

  it('does not block on nothing at all', () => {
    expect(readValidation([]).blocked).toBe(false);
  });
});

/**
 * The case the gate existed for and could not reach.
 *
 * `readValidation` was applied on the submit path from the start, but the PREVIEW still reported
 * "Amazon raised nothing" and the page hides its List button on that. So a lone SKU-in-use refusal
 * left the button absent — not disabled, absent — and the tolerance the gate provides was
 * unreachable through the interface. 90-ELIT200BL sat in DRAFT on Amazon BE while Seller Central
 * listed the identical SKU on request.
 *
 * These assert the shape the preview now returns, which is what decides whether the button appears.
 */
describe('what the preview reports to the page', () => {
  const skuInUse = { code: '100398', message: "SKU '90-ELIT200BL' already exists in other Amazon marketplace(s). Use a new SKU and resubmit your listing.", severity: 'ERROR' };
  const warranty = { code: '90000900', message: 'You submitted an attribute Product Warranty that does not belong', severity: 'WARNING' };

  /** Exactly the screenshot: one SKU error, one warning. The button has to appear. */
  it('does not block on the SKU refusal even alongside a warning', () => {
    const v = readValidation([warranty, skuInUse]);
    expect(v.blocked).toBe(false);
    expect(v.skuInUse).toBe(true);
    expect(v.blockingIssues).toEqual([]);
  });

  /** A real error alongside it still stops, and names itself rather than the SKU complaint. */
  it('blocks on a genuine error beside the SKU refusal, and reports that one', () => {
    const missing = { code: '4000001', message: 'The attribute brand is required', severity: 'ERROR' };
    const v = readValidation([skuInUse, missing]);
    expect(v.blocked).toBe(true);
    expect(v.skuInUse).toBe(true);
    expect(v.blockingIssues.map((i) => i.code)).toEqual(['4000001']);
  });

  /** Nothing wrong at all is not the same state, and must not show the SKU wording. */
  it('separates a clean pass from a tolerated SKU refusal', () => {
    const clean = readValidation([]);
    expect(clean.blocked).toBe(false);
    expect(clean.skuInUse).toBe(false);
  });
});

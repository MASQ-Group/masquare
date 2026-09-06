import { describe, expect, it } from 'vitest';
import { isSkuInUseRejection } from './sku-collision';

/**
 * A different SKU is offered only when Amazon has actually refused the name.
 *
 * Two earlier versions of this tried to predict the refusal from our own records — first from any
 * reuse of the SKU, then from reuse in a different seller account. Both were wrong, because the
 * same SKU IS normally accepted across marketplaces and accounts: EU to AU, EU to US. The refusal
 * happens sometimes, on conditions nobody here has decoded.
 *
 * Predicting was the mistake, not the particular prediction. A false warning splits a SKU that
 * never needed splitting and the split is permanent — the catalogue carries RE-S8540-AU, -US, -FR
 * forever to dodge a problem that was never there.
 *
 * So this reacts, and only to the one rejection it understands.
 */
describe('recognising Amazon refusing a SKU name', () => {
  it('recognises it by Amazon code', () => {
    expect(isSkuInUseRejection([{ code: '100398', message: 'anything at all' }])).toBe(true);
  });

  it('recognises it by wording, in case the code is missing', () => {
    expect(isSkuInUseRejection([
      { code: null, message: "SKU 'IT33136' already exists in other Amazon marketplace(s). Use a new SKU and resubmit your listing." },
    ])).toBe(true);
  });

  it('finds it among other issues', () => {
    expect(isSkuInUseRejection([
      { code: '90220', message: 'Missing attribute: item_weight' },
      { code: '100398', message: "SKU already exists in other Amazon marketplace(s)." },
    ])).toBe(true);
  });

  it('stays silent for every other rejection', () => {
    // A missing attribute, a restricted brand, a bad price — all real problems, none of them fixed
    // by renaming the SKU. Offering a new name for those is noise dressed as help.
    expect(isSkuInUseRejection([{ code: '90220', message: 'Missing attribute: item_weight' }])).toBe(false);
    expect(isSkuInUseRejection([{ code: '8541', message: 'You are not approved to list this brand' }])).toBe(false);
    expect(isSkuInUseRejection([{ code: '99001', message: 'Price is below the minimum allowed' }])).toBe(false);
  });

  it('says nothing when Amazon raised nothing', () => {
    expect(isSkuInUseRejection([])).toBe(false);
  });

  it('does not trip on an issue that merely mentions a SKU', () => {
    expect(isSkuInUseRejection([{ code: '4000', message: 'The SKU field is required' }])).toBe(false);
  });
});

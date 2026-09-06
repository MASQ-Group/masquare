/**
 * Reacting to Amazon refusing a seller SKU — never predicting it.
 *
 * An earlier version of this file tried to work out in advance whether Amazon would accept a SKU,
 * from which marketplaces already used it and which seller account each belonged to. Two rules were
 * written and both were wrong, because the real behaviour is not what either assumed: the same SKU
 * IS normally accepted across accounts — EU to AU, EU to US — and the refusal only appears
 * sometimes, on conditions we have not decoded.
 *
 * Guessing was the mistake, not the particular guess. A false warning pushes someone to split a SKU
 * that never needed splitting, and that split is permanent; the platform ends up carrying
 * RE-S8540-AU, -US, -FR forever to avoid a problem that did not exist.
 *
 * So nothing here predicts. Amazon is asked for real, in validation mode, and only when it actually
 * comes back with "use a new SKU" does the platform offer one.
 */

/**
 * Amazon's own code for a SKU it will not create because the name is in use elsewhere.
 *
 *   100398 — SKU 'IT33136' already exists in other Amazon marketplace(s).
 *            Use a new SKU and resubmit your listing.
 */
const SKU_IN_USE_CODE = '100398';

/** The wording, for the cases where the code is absent or Amazon changes it. */
const SKU_IN_USE_TEXT = /already exists in other amazon marketplace|use a new sku/i;

/**
 * Did Amazon refuse this offer because the SKU name is taken?
 *
 * Narrow on purpose. Every other rejection — a missing attribute, a restricted brand, a bad price —
 * is a different problem, and offering a new SKU for any of them would be noise dressed as help.
 */
export function isSkuInUseRejection(issues: { code?: string | null; message?: string | null }[]): boolean {
  return issues.some(
    (i) => (i.code ?? '').trim() === SKU_IN_USE_CODE || SKU_IN_USE_TEXT.test(i.message ?? ''),
  );
}

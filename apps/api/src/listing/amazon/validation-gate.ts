import { isSkuInUseRejection } from './sku-collision';

/**
 * Whether a VALIDATION refusal should stop us short of asking Amazon for real.
 *
 * The listing flow validates immediately before submitting and treats a refusal as final. That is
 * still a prediction — just Amazon's rather than ours — and for one particular refusal it is a
 * prediction that has been wrong in practice: `VALIDATION_PREVIEW` returns 100398, "SKU already
 * exists in other Amazon marketplace(s)", for a SKU that Seller Central creates on the same
 * marketplace without complaint.
 *
 * The cost of believing it is permanent. The way out we offered was an alias — RE-S8540-FR — and a
 * SKU split to avoid a problem that did not exist is carried forever, in orders, reports and
 * returns, by every system that reads it.
 *
 * So this narrows what "refused" means: an error Amazon will certainly repeat still stops us, but a
 * lone SKU-in-use error does not. The real submit is attempted and Amazon decides for real. If it
 * refuses there too, the alias is offered exactly as before — the way out is not removed, only
 * moved behind a genuine answer.
 *
 * WARNING-severity issues never blocked and still do not: Amazon returns them on submissions it
 * accepts.
 */
export interface AmazonIssue {
  code?: string | null;
  message?: string | null;
  severity?: string | null;
}

export interface ValidationVerdict {
  /** Stop here. The listing cannot be submitted as it stands. */
  blocked: boolean;
  /** Amazon objected to the SKU name — the one refusal worth testing for real. */
  skuInUse: boolean;
  /** The errors that justify stopping, so a message can name the real reason rather than the first. */
  blockingIssues: AmazonIssue[];
}

const isError = (i: AmazonIssue): boolean => (i.severity ?? 'ERROR').toUpperCase() === 'ERROR';

export function readValidation(issues: AmazonIssue[]): ValidationVerdict {
  const errors = (issues ?? []).filter(isError);
  const skuInUse = isSkuInUseRejection(errors);

  /**
   * Every error EXCEPT the SKU-name one.
   *
   * Judged per issue rather than "does the list contain a SKU error": a reply carrying both 100398
   * and a missing required attribute is genuinely blocked, and submitting it would fail for the
   * second reason while looking like we ignored the first.
   */
  const blockingIssues = errors.filter((i) => !isSkuInUseRejection([i]));

  return { blocked: blockingIssues.length > 0, skuInUse, blockingIssues };
}

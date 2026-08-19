// Pure parser for a getMyFeesEstimate (Product Fees API) FeesEstimateResult (spec §4.3). Extracts
// the PRICE-INDEPENDENT fees the floor solver needs as fixed inputs — FBA fulfilment + media
// closing fee — plus the referral fee at the queried price (for audit/validation; the solver
// itself derives referral % from the bracket schedule, since it varies with price). PURE, so it
// is unit-tested against a sample payload without any live SP-API call.

export interface ParsedFees {
  referralFeeCents: number | null;
  fbaFulfillmentFeeCents: number | null;
  closingFeeCents: number | null;
  totalFeeCents: number | null;
}

function amountToCents(m: { Amount?: number } | undefined | null): number | null {
  if (m?.Amount == null || !Number.isFinite(m.Amount)) return null;
  return Math.round(m.Amount * 100);
}

/**
 * Parse a FeesEstimateResult payload. Sums fee-detail entries by type (defensive to Amazon's
 * naming variants). Uses FinalFee (net of any promotion) when present, else FeeAmount.
 */
export function parseFeesEstimate(result: unknown): ParsedFees {
  const r = result as Record<string, any> | null;
  const estimate = r?.FeesEstimate ?? r?.feesEstimate;
  const details: any[] = estimate?.FeeDetailList ?? [];

  let referralFeeCents: number | null = null;
  let fbaFulfillmentFeeCents: number | null = null;
  let closingFeeCents: number | null = null;

  for (const d of details) {
    const amount = amountToCents(d?.FinalFee ?? d?.FeeAmount);
    if (amount == null) continue;
    switch (d?.FeeType) {
      case 'ReferralFee':
        referralFeeCents = amount;
        break;
      case 'FBAFees':
      case 'FulfillmentFees':
        fbaFulfillmentFeeCents = amount;
        break;
      case 'VariableClosingFee':
      case 'PerItemFee':
        closingFeeCents = (closingFeeCents ?? 0) + amount;
        break;
      default:
        break; // other fee types don't feed the floor
    }
  }

  return {
    referralFeeCents,
    fbaFulfillmentFeeCents,
    closingFeeCents,
    totalFeeCents: amountToCents(estimate?.TotalFeesEstimate),
  };
}

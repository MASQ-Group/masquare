/**
 * What one sale line actually earned, from the figures stored on it at the time.
 *
 * Every number here was frozen when the sale was recorded: the price, the channel's fee, the FBA
 * fee, the VAT, the unit cost snapshot and the exchange rate of the day. Reports are built from
 * those and never from today's cost — otherwise last quarter's profit changes every time somebody
 * corrects a purchase price, and nobody can tell a restated figure from a wrong one.
 *
 * Fees come from the order where the channel has settled them and from our estimate before that,
 * and the answer says which it used, so a report can show the difference rather than hide it.
 *
 * Everything is returned in EUR cents, the platform's own currency, because a report spanning five
 * marketplaces cannot add five currencies together.
 *
 * PURE.
 */

export type FeeBasis = 'actual' | 'estimated' | 'none';

export interface SaleLine {
  quantity: number;
  /** Net of VAT, in the order's currency. */
  netSalesAmount: number | null;
  shippingAmount: number | null;
  /** The channel's selling/referral fee, as the order settled it. Null until it settles. */
  salesChannelSalesFeeAmount: number | null;
  fbaFulfilmentFeeAmount: number | null;
  /** Amazon Points awarded (JP): a deduction from our proceeds. */
  amazonPointsAmount: number | null;
  /** Unit cost as at the sale, in EUR. */
  unitCostSnapshotEur: number | null;
}

export interface SaleContext {
  /** Order currency → EUR. 1 when the order is in EUR. */
  exchangeRate: number | null;
  /** Fee currency → EUR, when fees were charged in another currency. */
  feeExchangeRate: number | null;
  /** Referral percentage to assume while the real fee is unknown (0.15 = 15%). */
  estimatedFeePct: number | null;
}

export interface SaleLineProfit {
  revenueCents: number;
  feesCents: number;
  costCents: number;
  profitCents: number;
  /** Profit as a share of revenue, one decimal place. Null when nothing was sold. */
  marginPct: number | null;
  feeBasis: FeeBasis;
}

const eur = (amount: number | null | undefined, rate: number | null | undefined): number =>
  Math.round((Number(amount ?? 0) * (rate && rate > 0 ? rate : 1)) * 100);

export function saleLineProfit(line: SaleLine, ctx: SaleContext): SaleLineProfit {
  const qty = Math.max(0, Number(line.quantity) || 0);
  // Revenue is what the sale is worth to us: net of VAT, including what the buyer paid for postage.
  const revenueCents = eur(line.netSalesAmount, ctx.exchangeRate) + eur(line.shippingAmount, ctx.exchangeRate);

  const settledFee = line.salesChannelSalesFeeAmount != null;
  const feeRate = ctx.feeExchangeRate ?? ctx.exchangeRate;
  const feesCents = settledFee
    ? eur(line.salesChannelSalesFeeAmount, feeRate) + eur(line.fbaFulfilmentFeeAmount, feeRate) + eur(line.amazonPointsAmount, feeRate)
    // No settled fee yet: the referral percentage is the only honest stand-in, and the FBA fee is
    // whatever the order already carries (it settles separately).
    : Math.round(revenueCents * (ctx.estimatedFeePct ?? 0)) + eur(line.fbaFulfilmentFeeAmount, feeRate);

  const costCents = Math.round(Number(line.unitCostSnapshotEur ?? 0) * 100 * qty);
  const profitCents = revenueCents - feesCents - costCents;

  return {
    revenueCents,
    feesCents,
    costCents,
    profitCents,
    marginPct: revenueCents > 0 ? Math.round((profitCents / revenueCents) * 1000) / 10 : null,
    feeBasis: settledFee ? 'actual' : ctx.estimatedFeePct != null ? 'estimated' : 'none',
  };
}

/** How a day's lines were costed, when some settled and some did not. */
export function combineFeeBasis(bases: readonly FeeBasis[]): 'actual' | 'estimated' | 'mixed' | 'none' | null {
  const seen = new Set(bases);
  if (seen.size === 0) return null;
  if (seen.size === 1) return [...seen][0];
  // "none" beside anything else still means part of the day is uncosted; say mixed and show it.
  return 'mixed';
}

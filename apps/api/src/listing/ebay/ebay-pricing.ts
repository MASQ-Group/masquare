/**
 * What an eBay listing should sell for, and what it earns at any price.
 *
 * eBay's arithmetic differs from Amazon's in two ways that matter, which is why this is its own
 * module rather than a parameter to the repricing engine:
 *
 *   - eBay's final value fee is charged on the WHOLE amount the buyer pays, and there is a fixed fee
 *     per order on top. A percentage-only model quietly overstates profit on cheap items, which is
 *     exactly where the margin is thinnest.
 *   - A UK price is what the buyer pays, VAT included. Profit is earned on the net, so a margin
 *     worked out against the sticker price flatters itself by a fifth.
 *
 * Margin here means profit as a share of NET revenue — what is left after VAT, fees and cost, over
 * what we actually keep. Quoted that way because it is the number the business runs on; a markup on
 * cost would read higher for the same money.
 *
 * PURE. Every rate is supplied — nothing is assumed about a marketplace here.
 */

export interface EbayCostInputs {
  /** What the unit costs us, excluding VAT, in minor units. */
  costCents: number;
  /** 0.2 for the UK's 20%. */
  vatRate: number;
  /** eBay's final value fee as a fraction of the buyer's total — 0.128 for 12.8%. */
  feePct: number;
  /** The per-order fixed fee, in minor units. */
  fixedFeeCents: number;
}

export interface PriceOutcome {
  priceCents: number;
  /** VAT owed on that price. */
  vatCents: number;
  feesCents: number;
  costCents: number;
  profitCents: number;
  /** Profit as a percentage of net revenue. Negative when the price does not cover the costs. */
  marginPct: number;
}

/** What one price actually earns, once VAT, eBay and the cost of the unit are taken out. */
export function profitAt(priceCents: number, inputs: EbayCostInputs): PriceOutcome {
  const price = Math.max(0, Math.round(priceCents));
  const netCents = Math.round(price / (1 + inputs.vatRate));
  const vatCents = price - netCents;
  const feesCents = Math.round(price * inputs.feePct) + inputs.fixedFeeCents;
  const profitCents = netCents - feesCents - inputs.costCents;
  return {
    priceCents: price,
    vatCents,
    feesCents,
    costCents: inputs.costCents,
    profitCents,
    // Against net revenue, so the percentage means what the business means by it.
    marginPct: netCents > 0 ? Math.round((profitCents / netCents) * 1000) / 10 : 0,
  };
}

export type PriceSuggestion =
  | { ok: true; outcome: PriceOutcome; targetMarginPct: number }
  | { ok: false; reason: string };

/**
 * The price that earns `targetMarginPct` of net revenue.
 *
 * Solving rather than guessing-and-checking, because the fee depends on the price it is helping to
 * choose. With `P` the price, `v` VAT, `f` the fee rate, `F` the fixed fee, `c` the cost and `m` the
 * target margin:
 *
 *     P/(1+v) − (P·f + F) − c  =  m · P/(1+v)
 *     P · [ (1−m)/(1+v) − f ]  =  F + c
 *
 * The bracket is what one pound of price contributes after VAT, fees and the margin are taken out.
 * At a high enough fee or margin it reaches zero or turns negative — no price satisfies it, and the
 * honest answer is to say so rather than return an enormous number.
 */
export function suggestPrice(inputs: EbayCostInputs, targetMarginPct: number): PriceSuggestion {
  const m = targetMarginPct / 100;
  if (!(m < 1)) return { ok: false, reason: 'a margin of 100% or more cannot be reached at any price' };
  if (inputs.costCents < 0) return { ok: false, reason: 'the cost is not known' };

  const contribution = (1 - m) / (1 + inputs.vatRate) - inputs.feePct;
  if (contribution <= 0) {
    return {
      ok: false,
      reason: `eBay's fees and VAT leave nothing towards a ${targetMarginPct}% margin — no price reaches it`,
    };
  }

  // Rounded UP: rounding down would land a penny under the margin that was asked for.
  const priceCents = Math.ceil((inputs.fixedFeeCents + inputs.costCents) / contribution);
  return { ok: true, outcome: profitAt(priceCents, inputs), targetMarginPct };
}

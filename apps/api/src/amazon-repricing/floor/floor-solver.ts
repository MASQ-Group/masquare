// The breakeven floor solver (spec §4.3) — the crown jewel of Phase 1.
//
// PURE and stack-agnostic by design: no NestJS, no Prisma, no I/O, no Date.now(). Every input
// is data supplied by the caller (floor.service pulls fees from getMyFeesEstimate and the VAT
// rate from the ERP's Country/VatClass; §9-#20 referral-fee VAT basis is still `TO VERIFY`).
// This is what lets us table-test it exhaustively (floor-solver.spec.ts).
//
// WHY a solver and not a multiplication: the Amazon referral fee is a *percentage of the price*,
// and in several EU categories that percentage is *tiered by price bracket*. Since the fee
// depends on the price and the minimum viable price depends on the fee, the floor must be
// SOLVED, not computed in closed form. NetRevenue(P) is monotone-increasing in P *within* a
// referral bracket but DISCONTINUOUS (jumps down) at bracket edges where the percentage steps
// up — so we solve each bracket independently and take the smallest feasible price across them.
//
// All money is integer euro cents (spec §4.1). Rates are fractions (0.19 = 19%).

/** A tier of Amazon's referral-fee schedule: `pct` applies to prices in [minCents, maxCents]. */
export interface ReferralBracket {
  /** Inclusive lower bound of the gross price this bracket applies to, in cents. */
  minCents: number;
  /** Inclusive upper bound, in cents. Use Number.MAX_SAFE_INTEGER for the open top bracket. */
  maxCents: number;
  /** Referral percentage as a fraction (0.15 = 15%). */
  pct: number;
}

/**
 * Where Amazon charges the referral percentage. `TO VERIFY` with finance per marketplace
 * (spec §4.3, §9-#20 — blocking for the solver). Spec text says the fee is calculated on the
 * VAT-inclusive total ⇒ default 'gross'. Kept configurable so we never bake in an unverified
 * assumption.
 */
export type ReferralFeeBasis = 'gross' | 'net';

export interface FloorInputs {
  /** VAT rate as a fraction (DE 0.19, FR 0.20, ES 0.21 standard; reduced per product tax code). */
  vatRate: number;
  /** Referral-fee schedule, sorted ascending, contiguous over the search range. */
  referralBrackets: ReferralBracket[];
  /** Per-item minimum referral fee in cents (Amazon floors the referral fee). Default 0. */
  perItemMinReferralFeeCents?: number;
  /** See ReferralFeeBasis. Default 'gross'. */
  referralFeeBasis?: ReferralFeeBasis;

  /** FBA fulfilment fee in cents (from getMyFeesEstimate). 0 for FBM; FBM ship cost goes in fixed. */
  fbaFulfillmentFeeCents?: number;
  /** Media closing fee in cents (media categories only). Default 0. */
  closingFeeCents?: number;
  /** Landed unit cost: purchase cost + inbound freight to FC/warehouse, in cents. Required. */
  cogsLandedCents: number;
  /** Amortised monthly storage per unit in cents (Oct–Dec ≈ 3× rate). Default 0. */
  storagePerUnitCents?: number;
  /** Aged-inventory surcharge per unit in cents if projected age > 180 days. Default 0. */
  agedSurchargePerUnitCents?: number;
  /** Per-unit ad spend (TACOS) in cents if ads run on the SKU. Default 0 (excluded from floor v1). */
  adCostPerUnitCents?: number;
  /** Packaging, handling, overhead allocation (and FBM ship cost) per unit, in cents. Default 0. */
  fixedPerUnitCents?: number;

  /** Category/SKU returns rate as a fraction (0.05 = 5%). Default 0. */
  returnsRate?: number;
  /** Refund administration fee charged per returned unit, in cents. Default 0. */
  refundAdminFeeCents?: number;

  /** Search bounds in cents. Defaults: [1, amazonMaxAllowed or 10_000_00]. */
  searchLoCents?: number;
  searchHiCents?: number;
}

export interface FloorResult {
  /** Absolute never-cross line (0% margin). null ⇒ no feasible price ⇒ SKU EXCLUDED. */
  breakevenCents: number | null;
  /** breakeven + minimum margin. null ⇒ infeasible at the requested margin. */
  strategyFloorCents: number | null;
}

const DEFAULT_SEARCH_HI = 10_000_00; // €10,000 — generous upper bound for bisection.

// ---------------------------------------------------------------------------
// Core cost model
// ---------------------------------------------------------------------------
//
// Sub-amounts (net-of-VAT revenue, referral fee, returns allowance) are computed in EXACT
// arithmetic and only the FINAL NetRevenue is rounded to whole cents. Rounding each component
// independently would let NetRevenue dip by a cent as the price rises (round(P/1.19) can hold
// flat while round(pct·P) ticks up), breaking the monotonicity the solver relies on. Rounding
// once keeps NetRevenue non-decreasing within a bracket; the solver itself drives the exact
// (unrounded) function so its bisection is provably correct.

/** Net-of-VAT revenue for a gross (VAT-inclusive) price, in exact cents. */
function grossToNet(priceCents: number, vatRate: number): number {
  return priceCents / (1 + vatRate);
}

/** The referral bracket a gross price falls in. Throws if the schedule doesn't cover it. */
export function referralPctAt(priceCents: number, brackets: ReferralBracket[]): number {
  for (const b of brackets) {
    if (priceCents >= b.minCents && priceCents <= b.maxCents) return b.pct;
  }
  throw new Error(`No referral bracket covers price ${priceCents}c`);
}

/** Referral fee in exact cents for a gross price: max(per-item minimum, pct × basis). */
function referralFee(priceCents: number, inp: FloorInputs): number {
  const pct = referralPctAt(priceCents, inp.referralBrackets);
  const basis =
    (inp.referralFeeBasis ?? 'gross') === 'gross'
      ? priceCents
      : grossToNet(priceCents, inp.vatRate);
  return Math.max(inp.perItemMinReferralFeeCents ?? 0, pct * basis);
}

/**
 * Returns allowance in exact cents for a gross price. Modelled as: a `returnsRate` fraction of
 * units are refunded — we lose that share of net revenue and pay a refund-admin fee per return.
 * P-only (no dependence on the full NetRevenue), so the solver stays non-circular.
 * NOTE: the exact returns basis is a modelling choice to confirm with finance (spec §3.3, §9-#14).
 */
function returnsAllowance(priceCents: number, inp: FloorInputs): number {
  const rate = inp.returnsRate ?? 0;
  if (rate <= 0) return 0;
  return rate * grossToNet(priceCents, inp.vatRate) + rate * (inp.refundAdminFeeCents ?? 0);
}

/**
 * NetRevenue(P) in exact (unrounded) cents — the strictly-increasing (within-bracket) function
 * the solver drives, and the authoritative definition of the floor: breakeven is the smallest
 * integer price with `netRevenueExactCents ≥ 0`. Exported for property tests; production display
 * uses the whole-cent `netRevenueCents`.
 */
export function netRevenueExactCents(priceCents: number, inp: FloorInputs): number {
  return (
    grossToNet(priceCents, inp.vatRate) -
    referralFee(priceCents, inp) -
    (inp.fbaFulfillmentFeeCents ?? 0) -
    (inp.closingFeeCents ?? 0) -
    inp.cogsLandedCents -
    (inp.storagePerUnitCents ?? 0) -
    (inp.agedSurchargePerUnitCents ?? 0) -
    returnsAllowance(priceCents, inp) -
    (inp.adCostPerUnitCents ?? 0) -
    (inp.fixedPerUnitCents ?? 0)
  );
}

/**
 * NetRevenue(P) in whole cents (spec §4.3): rounded once from the exact P&L. Non-decreasing in P
 * within a referral bracket; discontinuous (jumps down) at bracket edges where the referral
 * percentage steps up. Public for auditing/display; the solver uses the exact form internally.
 */
export function netRevenueCents(priceCents: number, inp: FloorInputs): number {
  return Math.round(netRevenueExactCents(priceCents, inp));
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/**
 * Smallest integer price (cents) in the search range whose NetRevenue meets the required margin,
 * or null if none exists. `requiredMarginOfNet` is the strategy margin as a fraction of net
 * revenue (0 ⇒ breakeven). Solves each referral bracket independently (the function is
 * increasing within a bracket, discontinuous between) and returns the global minimum.
 */
function solveMinFeasiblePrice(inp: FloorInputs, requiredMarginOfNet: number): number | null {
  const searchLo = Math.max(1, inp.searchLoCents ?? 1);
  const searchHi = inp.searchHiCents ?? DEFAULT_SEARCH_HI;
  if (searchLo > searchHi) return null;

  // surplus(P) = NetRevenue(P) − requiredMargin(P); we want the smallest P with surplus ≥ 0.
  // Both terms are exact and P-only, and NetRevenue's slope exceeds the margin term's for any
  // sane margin < 1, so surplus is STRICTLY increasing within a bracket ⇒ bisection is exact.
  const surplus = (p: number): number =>
    netRevenueExactCents(p, inp) - requiredMarginOfNet * grossToNet(p, inp.vatRate);

  let best: number | null = null;

  for (const bracket of inp.referralBrackets) {
    const lo = Math.max(bracket.minCents, searchLo);
    const hi = Math.min(bracket.maxCents, searchHi);
    if (lo > hi) continue;

    // Within [lo, hi] surplus is monotone non-decreasing. If not feasible at the top, skip.
    if (surplus(hi) < 0) continue;

    let candidate: number;
    if (surplus(lo) >= 0) {
      candidate = lo; // feasible from the very bottom of this bracket
    } else {
      // Binary-search the smallest integer P in (lo, hi] with surplus(P) ≥ 0.
      let low = lo;
      let high = hi;
      while (low < high) {
        const mid = low + Math.floor((high - low) / 2);
        if (surplus(mid) >= 0) high = mid;
        else low = mid + 1;
      }
      candidate = low;
    }

    if (best === null || candidate < best) best = candidate;
  }

  return best;
}

/**
 * Solve both floors for a SKU. `minMarginPct` is the strategy's minimum net margin as a fraction
 * (0.12 = 12%, spec §9-#1). A null result means no price in range clears the bar ⇒ the caller
 * excludes the SKU from automation (spec §4.3 — the engine never guesses a floor).
 */
export function solveFloors(inp: FloorInputs, minMarginPct: number): FloorResult {
  validateInputs(inp);
  return {
    breakevenCents: solveMinFeasiblePrice(inp, 0),
    strategyFloorCents: solveMinFeasiblePrice(inp, minMarginPct),
  };
}

/** Guard against the input classes §6.1 quarantines (null/zero/negative costs, empty schedule). */
function validateInputs(inp: FloorInputs): void {
  if (!Number.isFinite(inp.vatRate) || inp.vatRate < 0) {
    throw new Error(`Invalid vatRate ${inp.vatRate}`);
  }
  if (!inp.referralBrackets?.length) {
    throw new Error('referralBrackets must be a non-empty schedule');
  }
  if (!Number.isInteger(inp.cogsLandedCents) || inp.cogsLandedCents <= 0) {
    // A null/zero/negative COGS is exactly the §6.1 quarantine case — refuse to solve.
    throw new Error(`cogsLandedCents must be a positive integer, got ${inp.cogsLandedCents}`);
  }
}

import { ReferralBracket } from '../floor/floor-solver';

// Amazon referral-fee SCHEDULE — the bracket structure the solver needs to compute a floor across
// prices (getMyFeesEstimate only returns the fee at ONE price; the solver must know the tiers to
// find the minimum viable price across bracket edges — spec §4.3).
//
// `TO VERIFY` (spec §3.3, §4.3, §9-#20 — BLOCKING for the solver): these percentages and bracket
// edges must be confirmed against the CURRENT published EU schedule at implementation. Amazon cut
// EU referral/FBA fees on Dec 15 2025 / Jan 5 2026, which is exactly why fees are DATA, not code —
// the per-SKU fixed fees (FBA fulfilment, closing) come live from getMyFeesEstimate; only the
// referral *bracket structure* lives here, and it is re-checked whenever FEE_PROMOTION fires.
//
// The values below are a conservative placeholder (flat 15%, the common general-category rate)
// until finance confirms the per-category tiers. A category with genuine tiers (e.g. clothing
// 5% ≤ €15 / 10% €15–20 / 15% above) is added as its own keyed schedule.

const MAX = Number.MAX_SAFE_INTEGER;

/** Conservative fallback: flat 15% across all prices. Overridden per category once confirmed. */
export const DEFAULT_REFERRAL_SCHEDULE: ReferralBracket[] = [{ minCents: 1, maxCents: MAX, pct: 0.15 }];

/**
 * Per-category referral schedules, keyed by a category key we control. EMPTY until finance signs
 * off the tiers (§9-#20). Until then every SKU uses DEFAULT_REFERRAL_SCHEDULE and the floor spot-
 * check (Phase 1 exit gate) surfaces any category whose real fee differs.
 */
export const REFERRAL_SCHEDULE_BY_CATEGORY: Record<string, ReferralBracket[]> = {
  // e.g. clothing: [
  //   { minCents: 1, maxCents: 1500, pct: 0.05 },
  //   { minCents: 1501, maxCents: 2000, pct: 0.10 },
  //   { minCents: 2001, maxCents: MAX, pct: 0.15 },
  // ],  // TO VERIFY with finance before enabling
};

/** Resolve the referral schedule for a SKU's category, falling back to the flat default. */
export function referralScheduleFor(categoryKey?: string | null): ReferralBracket[] {
  if (categoryKey && REFERRAL_SCHEDULE_BY_CATEGORY[categoryKey]) {
    return REFERRAL_SCHEDULE_BY_CATEGORY[categoryKey];
  }
  return DEFAULT_REFERRAL_SCHEDULE;
}

/**
 * A schedule built from one sales channel's configured fee.
 *
 * The engine used to hard-code 15% while Individual Pricing read the channel's own
 * generalSalesFeePct. They agreed only because both happened to be 15 — changing a fee in Settings
 * would have made two screens disagree about the same sale.
 *
 * A zero fee is a real answer: some channels genuinely charge none, and treating it as "unknown"
 * would quietly restore a 15% deduction that nobody configured. Only an absent fee falls back.
 */
export function scheduleFromChannelFee(pct: number | null | undefined): ReferralBracket[] {
  if (pct == null || !Number.isFinite(pct) || pct < 0) return DEFAULT_REFERRAL_SCHEDULE;
  return [{ minCents: 1, maxCents: MAX, pct: pct / 100 }];
}

/**
 * Assert a schedule is well-formed: sorted, contiguous, gap-free, covering [1, MAX]. The solver
 * assumes this; a malformed schedule would silently mis-price a floor. Throws on violation.
 */
export function assertValidSchedule(brackets: ReferralBracket[]): void {
  if (!brackets.length) throw new Error('referral schedule is empty');
  if (brackets[0].minCents !== 1) throw new Error('referral schedule must start at 1 cent');
  for (let i = 0; i < brackets.length; i += 1) {
    const b = brackets[i];
    if (b.minCents > b.maxCents) throw new Error(`bracket ${i} has minCents > maxCents`);
    if (b.pct < 0 || b.pct >= 1) throw new Error(`bracket ${i} pct out of range: ${b.pct}`);
    if (i > 0 && b.minCents !== brackets[i - 1].maxCents + 1) {
      throw new Error(`bracket ${i} is not contiguous with the previous bracket`);
    }
  }
  if (brackets[brackets.length - 1].maxCents !== MAX) {
    throw new Error('referral schedule must cover the open top bracket (maxCents = MAX_SAFE_INTEGER)');
  }
}

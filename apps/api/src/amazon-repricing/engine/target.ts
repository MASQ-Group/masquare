import { Branch, CompetitorSet, MarketSnapshot, Offer, Strategy, deliveryTier, landedCents } from './types';
import { MatrixParams, landedTargetAgainst } from './matrix';

// Step 2 — raw target price in LANDED cents (spec §5.4). PURE. Given the branch, our strategy, the
// effective set, our delivery tier, engine state (are we holding the Buy Box, our probe anchor) and
// optional signals (FOEP, Amazon-Retail landed, restore reference), produce a target — or a HOLD.
// Floors/ceilings are NOT applied here; the clamp chain (§5.5) does that next.
//
// Deferred to the I/O shell (need history/config not available to a pure fn), tracked as follow-ups:
//   • full undercut-loop state machine (§5.5 C-5) — here we only honour a precomputed `holdForLoop`.
//   • velocity controller target source (§9-#16) — here Branch A/velocity needs `velocity` supplied.
//   • wait-for-sellout (§5.4 C-6, default off).

export interface TargetParams extends MatrixParams {
  /** Buy-Box hold probe step (§9-#6, default 1%). */
  probeStepPct: number;
  /** Amazon-Retail wait premium above Amazon's landed (§9-#5, default +2%). */
  amazonRetailWaitPremiumPct: number;
  /** Hard cap on a single upward step — never ≥ 10% (suppression trigger, §1.5). */
  maxUpStepPct: number;
}

export interface EngineState {
  currentPriceLandedCents: number | null;
  holdingBuyBox: boolean;
  probeAnchorCents: number | null;
  /** The effective set shrank vs the last evaluation (a competitor left/stocked out) → probe faster.
   *  Derived in decide() from `prevCompetitorCount` and the freshly-built set. */
  competitorSetShrank?: boolean;
  /** Effective-competitor count at the previous evaluation for this listing (from decision history),
   *  or null if none. decide() compares it to the current set to set `competitorSetShrank`. */
  prevCompetitorCount?: number | null;
  /** Precomputed undercut-loop verdict (§5.5 C-5): true ⇒ stop following, hold. */
  holdForLoop?: boolean;
}

export interface TargetSignals {
  /** Fresh (< 24h) FOEP landed price, if enrichment has one (§5.4 C-2 priority 1). */
  foepLandedCents?: number | null;
  /** Amazon Retail's landed price for Branch B. */
  amazonRetailLandedCents?: number | null;
  /** Branch D restore constraint: the reference landed price to get back under. */
  restoreReferenceLandedCents?: number | null;
  /** Branch A / velocity: trailing vs target 30-day unit velocity. */
  velocity?: { trailing: number; target: number } | null;
}

export interface Bounds {
  breakevenCents: number;
  strategyFloorCents: number;
  maxPriceCents?: number | null;
}

export interface TargetOutcome {
  /** null ⇒ HOLD (no price change this evaluation). */
  targetCents: number | null;
  reason: string;
  /** Raise an ops alert alongside the decision (e.g. structurally unprofitable, §5.3 Branch D). */
  alert?: boolean;
  /** Updated probe anchor to persist (set when we probe up from a winning price). */
  newProbeAnchorCents?: number | null;
}

/** Our delivery tier, and the best (lowest-landed) effective competitor's tier. */
function tiers(ourOffer: Offer, set: CompetitorSet): { ourTier: number; compTier: number; runnerUp: Offer | null } {
  const runnerUp = set.effective[0] ?? null;
  return {
    ourTier: deliveryTier(ourOffer),
    compTier: runnerUp ? deliveryTier(runnerUp) : 0,
    runnerUp,
  };
}

export function computeRawTarget(
  branch: Branch,
  strategy: Strategy,
  snapshot: MarketSnapshot,
  set: CompetitorSet,
  ourOffer: Offer,
  state: EngineState,
  bounds: Bounds,
  params: TargetParams,
  signals: TargetSignals = {},
): TargetOutcome {
  switch (branch) {
    case 'A_SOLE':
      return velocityTarget(state, bounds, params, signals, 'Branch A: sole seller');
    case 'B_AMAZON':
      return amazonPresentTarget(bounds, params, signals);
    case 'D_RESTORE':
      return restoreTarget(bounds, signals);
    case 'C_CONTESTED':
      return contestedTarget(strategy, set, ourOffer, state, bounds, params, signals);
  }
}

// --- Branch C — contested main path (§5.4) ---
function contestedTarget(
  strategy: Strategy,
  set: CompetitorSet,
  ourOffer: Offer,
  state: EngineState,
  bounds: Bounds,
  params: TargetParams,
  signals: TargetSignals,
): TargetOutcome {
  if (state.holdForLoop) {
    return { targetCents: null, reason: 'C-5 undercut-loop: holding, not following' };
  }

  const { ourTier, compTier, runnerUp } = tiers(ourOffer, set);

  // C-3 LOWEST_PRICE strategy: target the lowest qualified landed in our segment (match by default).
  if (strategy === 'LOWEST_PRICE') {
    if (!runnerUp) return { targetCents: null, reason: 'C-3 LOWEST_PRICE: no competitor to anchor' };
    return { targetCents: Math.max(0, landedCents(runnerUp) - params.beatByCents), reason: 'C-3 LOWEST_PRICE: match lowest' };
  }

  // C-1 holding the Buy Box: never lower — probe up, bounded by the runner-up threat price.
  if (state.holdingBuyBox && state.currentPriceLandedCents != null) {
    return probeUp(state, set, ourTier, compTier, runnerUp, bounds, params);
  }

  // C-2 not holding: target the winning price (not the bottom). FOEP first, else BB × matrix.
  const foep = signals.foepLandedCents;
  if (foep != null && isSaneFoep(foep, set.buyBoxLandedCents, bounds)) {
    return { targetCents: foep, reason: 'C-2 FOEP anchor' };
  }
  if (set.buyBoxLandedCents != null) {
    return {
      targetCents: landedTargetAgainst(set.buyBoxLandedCents, ourTier, compTier, params),
      reason: 'C-2 Buy Box landed × FBA/FBM matrix',
    };
  }
  if (runnerUp) {
    return {
      targetCents: landedTargetAgainst(landedCents(runnerUp), ourTier, compTier, params),
      reason: 'C-2 no Buy Box price: lowest qualified landed ± matrix',
    };
  }
  return { targetCents: null, reason: 'C-2 no anchor available' };
}

function probeUp(
  state: EngineState,
  set: CompetitorSet,
  ourTier: number,
  compTier: number,
  runnerUp: Offer | null,
  bounds: Bounds,
  params: TargetParams,
): TargetOutcome {
  const current = state.currentPriceLandedCents!;
  const step = state.competitorSetShrank ? params.probeStepPct * 2 : params.probeStepPct;
  const cappedStep = Math.min(step, params.maxUpStepPct - 0.0001); // never a single step ≥ 10%
  let target = Math.round(current * (1 + cappedStep));

  // Bound by the runner-up threat price: runnerUpLanded × (1 + our advantage premium).
  if (runnerUp) {
    const advantage = ourTier > compTier ? params.fbmPremiumPct : 0;
    const threat = Math.round(landedCents(runnerUp) * (1 + advantage));
    if (target > threat) target = Math.max(current, threat); // don't probe past where we'd lose
  }
  if (bounds.maxPriceCents != null) target = Math.min(target, bounds.maxPriceCents);
  target = Math.max(target, current); // C-1: never lower while holding

  return {
    targetCents: target,
    reason: state.competitorSetShrank ? 'C-1 probe up (2× step, set shrank)' : 'C-1 probe up',
    newProbeAnchorCents: current, // last known-winning price
  };
}

/** FOEP sanity (§5.4 C-2): reject if < breakeven, > maxPrice, or > 20% off the current Buy Box landed. */
function isSaneFoep(foep: number, buyBoxLanded: number | null | undefined, bounds: Bounds): boolean {
  if (foep < bounds.breakevenCents) return false;
  if (bounds.maxPriceCents != null && foep > bounds.maxPriceCents) return false;
  if (buyBoxLanded != null && Math.abs(foep - buyBoxLanded) / buyBoxLanded > 0.2) return false;
  return true;
}

// --- Branch B — Amazon Retail present: never undercut; hold a wait price above (§5.3) ---
function amazonPresentTarget(bounds: Bounds, params: TargetParams, signals: TargetSignals): TargetOutcome {
  const amz = signals.amazonRetailLandedCents;
  if (amz == null) return { targetCents: null, reason: 'Branch B: Amazon landed unknown, hold' };
  const wait = Math.round(amz * (1 + params.amazonRetailWaitPremiumPct));
  // Match exactly only if the match is ≥ strategy floor; else sit at the wait price.
  const target = Math.max(wait, bounds.strategyFloorCents);
  return { targetCents: target, reason: 'Branch B: wait price above Amazon Retail' };
}

// --- Branch D — restore eligibility: price under the reference constraint, ≥ breakeven (§5.3) ---
function restoreTarget(bounds: Bounds, signals: TargetSignals): TargetOutcome {
  const ref = signals.restoreReferenceLandedCents;
  if (ref == null) return { targetCents: bounds.strategyFloorCents, reason: 'Branch D: no reference, park at floor' };
  if (ref < bounds.breakevenCents) {
    // Structurally unprofitable on Amazon — do not comply; park at floor and alert (business call).
    return { targetCents: bounds.strategyFloorCents, reason: 'Branch D: reference < breakeven — park + alert', alert: true };
  }
  return { targetCents: Math.max(ref, bounds.strategyFloorCents), reason: 'Branch D: price under reference constraint' };
}

// --- Branch A / velocity controller (§5.4 C-4, §5.3 Branch A) ---
function velocityTarget(
  state: EngineState,
  bounds: Bounds,
  params: TargetParams,
  signals: TargetSignals,
  label: string,
): TargetOutcome {
  if (!signals.velocity || state.currentPriceLandedCents == null) {
    return { targetCents: null, reason: `${label}: no velocity signal, hold` };
  }
  const { trailing, target } = signals.velocity;
  const current = state.currentPriceLandedCents;
  // Above target velocity → raise one step; below → lower one step. Clamped later by §5.5.
  if (trailing > target) return { targetCents: Math.round(current * (1 + params.probeStepPct)), reason: `${label}: above target velocity, raise` };
  if (trailing < target) return { targetCents: Math.round(current * (1 - params.probeStepPct)), reason: `${label}: below target velocity, lower` };
  return { targetCents: null, reason: `${label}: at target velocity, hold` };
}

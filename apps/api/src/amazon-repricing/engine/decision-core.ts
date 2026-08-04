import { buildCompetitorSet, CompetitorSetOptions } from './competitor-set';
import { classifyBranch } from './branch';
import { computeRawTarget, Bounds, EngineState, TargetParams, TargetSignals } from './target';
import { applyClamps, ClampBounds, ClampStep } from './clamps';
import { shouldEmit, EmitParams } from './emit';
import { AutomationState, Branch, CompetitorFilters, CompetitorSet, MarketSnapshot, Offer, Strategy } from './types';

// The pure decision core (spec §5.1) — one evaluation for one ASIN × marketplace. Composes the
// steps: effective competitor set → market-structure branch → raw target → ordered clamps →
// emit-if-meaningful. Returns a full, auditable decision (§6.6). NO I/O, NO safety-layer call
// (the writer runs §6.3 last, with LIVE state) — this produces the INTENDED price only, which is
// exactly what shadow mode logs (§6.5).

export interface DecideInput {
  snapshot: MarketSnapshot;
  ourOffer: Offer;
  strategy: Strategy;
  automationState: AutomationState;
  filters: CompetitorFilters;
  competitorSetOptions?: CompetitorSetOptions;
  bounds: Bounds;
  clampBounds: ClampBounds;
  state: EngineState;
  signals?: TargetSignals;
  targetParams: TargetParams;
  emitParams: EmitParams;
  lastSubmissionAtMs: number | null;
  nowMs: number;
  /** Event is PRICING_HEALTH or a floor breach → override cooldown (§5.6). */
  safetyOverride?: boolean;
}

export type DecisionOutcome = 'SKIPPED' | 'HELD' | 'QUARANTINED' | 'PRICED';

export interface Decision {
  outcome: DecisionOutcome;
  branch: Branch | null;
  competitorSet: CompetitorSet | null;
  rawTargetCents: number | null;
  finalPriceCents: number | null;
  clampSteps: ClampStep[];
  reason: string;
  alert: boolean;
  newProbeAnchorCents?: number | null;
}

export function decide(input: DecideInput): Decision {
  const empty = (outcome: DecisionOutcome, reason: string, branch: Branch | null = null, set: CompetitorSet | null = null): Decision => ({
    outcome,
    branch,
    competitorSet: set,
    rawTargetCents: null,
    finalPriceCents: null,
    clampSteps: [],
    reason,
    alert: false,
  });

  // 1. Non-automatable states never price (§5.1). MANUAL_ONLY evaluates but never writes.
  if (input.automationState === 'EXCLUDED' || input.automationState === 'KILLED') {
    return empty('SKIPPED', `automationState=${input.automationState}`);
  }
  if (input.strategy === 'MANUAL_ONLY') {
    return empty('SKIPPED', 'MANUAL_ONLY: evaluate-and-log only');
  }

  // 2. Effective competitor set → 3. branch.
  const set = buildCompetitorSet(input.snapshot, input.filters, input.competitorSetOptions);
  const branch = classifyBranch(input.snapshot, set);

  // 4. Raw target.
  const target = computeRawTarget(
    branch,
    input.strategy,
    input.snapshot,
    set,
    input.ourOffer,
    input.state,
    input.bounds,
    input.targetParams,
    input.signals ?? {},
  );
  if (target.targetCents == null) {
    return { ...empty('HELD', target.reason, branch, set), alert: target.alert ?? false };
  }

  // 5. Ordered constraint clamps. A floor/ceiling conflict quarantines (§5.5).
  const clamp = applyClamps(target.targetCents, input.clampBounds);
  if (!clamp.ok) {
    return {
      ...empty('QUARANTINED', `clamp conflict: ${clamp.conflict}`, branch, set),
      rawTargetCents: target.targetCents,
      clampSteps: clamp.steps,
    };
  }

  // 6. Emit-if-meaningful (epsilon + cooldown). Safety layer (§6.3) runs later, in the writer.
  const emit = shouldEmit(
    {
      newPriceCents: clamp.priceCents,
      currentPriceCents: input.state.currentPriceLandedCents,
      lastSubmissionAtMs: input.lastSubmissionAtMs,
      nowMs: input.nowMs,
      safetyOverride: input.safetyOverride,
    },
    input.emitParams,
  );

  const baseline = {
    branch,
    competitorSet: set,
    rawTargetCents: target.targetCents,
    finalPriceCents: clamp.priceCents,
    clampSteps: clamp.steps,
    alert: target.alert ?? false,
    newProbeAnchorCents: target.newProbeAnchorCents ?? null,
  };

  if (!emit.emit) {
    return { ...baseline, outcome: 'HELD', finalPriceCents: clamp.priceCents, reason: `${target.reason}; skipped: ${emit.skip}` };
  }
  return { ...baseline, outcome: 'PRICED', reason: target.reason };
}

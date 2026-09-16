/**
 * Turning one SKU's automation on or off, by hand.
 *
 * This is how a pilot is run: put two or three SKUs live, leave the rest in shadow, and watch. The
 * states are a ladder rather than a set of equals —
 *
 *   EXCLUDED    something needed is missing (cost, VAT, fees, a feasible floor, a fresh floor).
 *   SHADOW      evaluated in full, every decision logged, nothing sent.
 *   LIVE        the same, and the price is actually sent to Amazon.
 *   QUARANTINED the floor conflicts with a ceiling; a person resolves it back to shadow.
 *   KILLED      switched off by a person; nothing moves it back on its own.
 *
 * Going LIVE is the only step that can cost money, so it is the only one with conditions: the SKU
 * must already be evaluating cleanly in shadow, on floors that are known and fresh. Everything else
 * is a way of stopping, and stopping is always allowed.
 *
 * PURE.
 */

export type AutomationTarget = 'LIVE' | 'SHADOW' | 'KILLED';

export interface StateRow {
  automationState: string;
  exclusionReason: string | null;
  breakevenCents: number | null;
  strategyFloorCents: number | null;
  /** Floors older than this are stale, and the hourly sweep excludes the SKU. */
  floorStaleAfter: Date | null;
  strategy: string;
}

export interface StatePlan {
  ok: boolean;
  /** Why it cannot be done, in words a person can act on. */
  problems: string[];
  /** True but worth saying — e.g. live writes are switched off platform-wide. */
  notes: string[];
}

export function planStateChange(
  row: StateRow,
  target: AutomationTarget,
  opts: { now: Date; liveWritesEnabled: boolean },
): StatePlan {
  const problems: string[] = [];
  const notes: string[] = [];

  if (row.automationState === target) {
    return { ok: false, problems: [`This SKU is already ${target.toLowerCase()}.`], notes };
  }

  // Stopping is always allowed, from any state.
  if (target === 'KILLED') return { ok: true, problems, notes: ['Nothing will move it back on its own.'] };

  if (row.automationState === 'QUARANTINED') {
    problems.push('This SKU is quarantined: its floor conflicts with a ceiling. Fix the conflict and press Resolve, which returns it to shadow.');
    return { ok: false, problems, notes };
  }

  if (target === 'SHADOW') {
    // Shadow sends nothing, so it is safe from anywhere — but say when it will not stay there.
    if (row.exclusionReason || row.breakevenCents == null || row.strategyFloorCents == null) {
      notes.push('Its floors are not known yet, so the next floor run will put it back to excluded.');
    }
    return { ok: true, problems, notes };
  }

  // ── LIVE ───────────────────────────────────────────────────────────────────────────────────────
  if (row.automationState !== 'SHADOW') {
    problems.push(`Only a SKU in shadow can be put live; this one is ${row.automationState.toLowerCase()}. Put it in shadow first and let it evaluate.`);
  }
  if (row.breakevenCents == null || row.strategyFloorCents == null) {
    problems.push('Its breakeven and floor have not been calculated, so there is nothing to protect the price.');
  }
  if (row.exclusionReason) {
    problems.push(`Something it needs is missing: ${row.exclusionReason}.`);
  }
  if (row.floorStaleAfter != null && row.floorStaleAfter.getTime() <= opts.now.getTime()) {
    problems.push('Its floors are stale. Recompute floors first — a floor solved on old costs is not a floor.');
  }
  if (row.strategy === 'MANUAL_ONLY') {
    notes.push('Its strategy is Manual only, so it will evaluate and log but never send a price. Change the strategy to have it price.');
  }
  if (!opts.liveWritesEnabled) {
    notes.push('Live writes are switched off platform-wide, so nothing reaches Amazon until that is turned on.');
  }
  return { ok: problems.length === 0, problems, notes };
}

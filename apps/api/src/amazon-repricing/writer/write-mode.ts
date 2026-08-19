import { AutomationState } from '../engine/types';

// The single, pure, safety-critical decision: does a computed price get SKIPPED, submitted as a
// VALIDATION_PREVIEW dry-run, or actually written LIVE? (spec §6.4/§6.5). Two independent gates
// must BOTH be satisfied for a real write:
//   1. the SKU is LIVE (a per-SKU promotion decision, §6.5 rollout), and
//   2. the global live-writes master switch is ON (env AMZ_REPRICING_LIVE_WRITES=true).
// Default is DRY_RUN — the writer can be wired into the live path safely and still touch no real
// price until BOTH gates are deliberately opened. A kill switch forces SKIP regardless (§6.4).

export type WriteMode = 'SKIP' | 'DRY_RUN' | 'LIVE';

export function resolveWriteMode(args: {
  automationState: AutomationState;
  liveWritesEnabled: boolean;
  killSwitchEngaged: boolean;
}): WriteMode {
  if (args.killSwitchEngaged) return 'SKIP'; // global/marketplace kill (§6.4) — never submit
  if (args.automationState === 'KILLED') return 'SKIP';
  // Only LIVE SKUs ever produce a real or preview write; everything else is shadow (logged elsewhere).
  if (args.automationState !== 'LIVE') return 'SKIP';
  return args.liveWritesEnabled ? 'LIVE' : 'DRY_RUN';
}

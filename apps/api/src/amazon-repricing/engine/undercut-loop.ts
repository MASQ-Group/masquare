// §5.4 C-5 — undercut-loop guard. If the same SellerId re-undercuts us repeatedly, chasing them
// down just feeds a price war we lose. When one seller undercuts us >= `count` times inside a
// `windowMs` burst we stop following (hold), and keep holding until that seller has gone quiet for
// `quietMs` (the loop has exhausted) — then normal targeting resumes. Pure and stateless: the
// caller supplies the recent undercut history; this only classifies it.

export interface UndercutEvent {
  /** When the undercut was observed (epoch ms). */
  atMs: number;
  /** The competitor that undercut us. */
  sellerId: string;
}

export interface UndercutLoopOptions {
  /** Undercuts within a burst that trip the guard (default REPRICING_DEFAULTS.undercutLoopCount). */
  count: number;
  /** Burst window in ms (undercutLoopWindowMinutes). */
  windowMs: number;
  /** Silence required from the offender before we resume following (undercutLoopQuietHours). */
  quietMs: number;
  nowMs: number;
}

export interface UndercutLoopResult {
  /** True ⇒ engine should hold current price and wait rather than chase (EngineState.holdForLoop). */
  hold: boolean;
  /** The worst repeat offender (for the ops-console / blocklist), or null if no loop was found. */
  offenderSellerId: string | null;
  /** How many undercuts that offender fired inside the burst window. */
  offenderCount: number;
}

/**
 * Detect a repeat-undercutter loop. An offender is a seller with >= `count` undercuts inside a
 * `windowMs` burst ending at their most recent undercut. We hold while that offender is still
 * active (last undercut newer than `quietMs`); once they have been quiet for `quietMs` the loop is
 * treated as exhausted and we resume. The worst offender is reported regardless, so ops can act.
 */
export function detectUndercutLoop(events: UndercutEvent[], opts: UndercutLoopOptions): UndercutLoopResult {
  const none: UndercutLoopResult = { hold: false, offenderSellerId: null, offenderCount: 0 };
  if (events.length === 0 || opts.count <= 0) return none;

  // Group timestamps per seller (ignore anything after "now" to keep bursts well-defined).
  const bySeller = new Map<string, number[]>();
  for (const e of events) {
    if (e.atMs > opts.nowMs) continue;
    const times = bySeller.get(e.sellerId);
    if (times) times.push(e.atMs);
    else bySeller.set(e.sellerId, [e.atMs]);
  }

  let offenderSellerId: string | null = null;
  let offenderCount = 0;
  let offenderLastMs = 0;

  for (const [sellerId, times] of bySeller) {
    times.sort((a, b) => a - b);
    const lastMs = times[times.length - 1];
    // Undercuts in the burst window ending at this seller's most recent undercut.
    const burst = times.filter((t) => t > lastMs - opts.windowMs).length;
    if (burst < opts.count) continue;
    // Worst offender = biggest burst, tie broken by most recent activity.
    if (burst > offenderCount || (burst === offenderCount && lastMs > offenderLastMs)) {
      offenderSellerId = sellerId;
      offenderCount = burst;
      offenderLastMs = lastMs;
    }
  }

  if (offenderSellerId == null) return none;
  const hold = opts.nowMs - offenderLastMs < opts.quietMs;
  return { hold, offenderSellerId, offenderCount };
}

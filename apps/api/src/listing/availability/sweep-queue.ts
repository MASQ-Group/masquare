/**
 * Which product × marketplace pairs to ask Amazon about next.
 *
 * Kept apart from the service that does the asking, because the interesting part is the choosing
 * and the choosing is worth testing without a marketplace on the other end. The service walks
 * whatever this returns.
 *
 * Measured against the live catalogue: about 11,600 product x marketplace pairs, of which some
 * 5,300 are already listed and answer themselves — leaving roughly 6,500 to ask about. Nothing here
 * can make that a small number; it can only make sure the calls are spent on the pairs whose answer
 * is missing or old, rather than on re-confirming what we asked yesterday.
 */

export interface SweepPair {
  productId: string;
  integrationId: string;
  /** When we last had an answer for this pair. Null means never asked. */
  checkedAt: Date | null;
}

export interface SweepSettings {
  /** Pairs per run. Roughly two SP-API calls each. */
  batchSize: number;
  /** Minutes between runs. */
  intervalMinutes: number;
  /** How old an answer may be before it is asked again. */
  recheckDays: number;
}

/** A pair is identified by both halves; either alone repeats across the set. */
export const pairKey = (p: { productId: string; integrationId: string }) => `${p.productId}:${p.integrationId}`;

/**
 * The next batch.
 *
 * Never-asked pairs come first, oldest answers after them. That ordering matters more than it
 * looks: with recency-first, a catalogue that keeps growing would re-confirm its established
 * products forever and the newest ones — the whole reason anyone opened the page — would sit at the
 * back of a queue they never reach.
 *
 * Pairs already listed are dropped rather than ranked last. "Where could we list this" is not a
 * question about a marketplace we are already selling on, and asking it there spends two calls to
 * learn something the listings table already says. This is the caller's own instruction and it is
 * also the single biggest saving available: a third of all pairs.
 */
export function nextBatch(
  pairs: SweepPair[],
  listed: Set<string>,
  settings: SweepSettings,
  now: Date,
): SweepPair[] {
  const recheckBefore = new Date(now.getTime() - settings.recheckDays * 24 * 60 * 60 * 1000);

  const due = pairs.filter((p) => {
    if (listed.has(pairKey(p))) return false;
    // A pair asked inside the window is settled. Re-asking is not free and the answer does not move
    // on that timescale.
    return p.checkedAt == null || p.checkedAt < recheckBefore;
  });

  due.sort((a, b) => {
    if (a.checkedAt == null && b.checkedAt == null) return 0;
    if (a.checkedAt == null) return -1;
    if (b.checkedAt == null) return 1;
    return a.checkedAt.getTime() - b.checkedAt.getTime();
  });

  return due.slice(0, Math.max(0, settings.batchSize));
}

/**
 * How long one pass over everything actually takes at this rate.
 *
 * Worth stating on screen next to the two boxes that decide it. "Re-check every 30 days" with a
 * batch that can only reach a fifth of the catalogue in 30 days is not a 30-day re-check — it is a
 * 150-day one, and the setting reads as a promise the numbers cannot keep. Better to show the
 * arithmetic than to let someone discover it from a stale answer months later.
 */
export function coverage(totalPairs: number, settings: SweepSettings): {
  pairsPerDay: number;
  fullPassDays: number;
  /** True when a full pass cannot finish inside the re-check window. */
  behind: boolean;
} {
  const runsPerDay = settings.intervalMinutes > 0 ? (24 * 60) / settings.intervalMinutes : 0;
  const pairsPerDay = Math.round(runsPerDay * settings.batchSize);
  const fullPassDays = pairsPerDay > 0 ? Math.ceil(totalPairs / pairsPerDay) : Infinity;
  return { pairsPerDay, fullPassDays, behind: fullPassDays > settings.recheckDays };
}

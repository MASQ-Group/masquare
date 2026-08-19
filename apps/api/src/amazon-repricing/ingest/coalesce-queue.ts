// §5.1 step 0 — debounce/coalesce. Every price change on a listing fires ANY_OFFER_CHANGED for
// EVERY seller on it (including us), so a single move can produce a burst of events. Rather than
// evaluate each, we open a fixed window (default 30 s) per ASIN × marketplace on the first event,
// keep only the LATEST event in that window (by TimeOfOfferChange), and evaluate once when it
// closes. This caps evaluations at one per window per listing and always acts on the freshest data.
//
// Pure and deterministic: the timer primitives are injected, so tests drive time by hand and the
// coalescing/keep-latest logic is verified without real clocks. The NestJS wrapper supplies
// setTimeout/clearTimeout and the flush callback that runs the evaluation.

export interface CoalesceQueueDeps {
  /** Window length in ms (REPRICING_DEFAULTS-style default 30_000). */
  windowMs: number;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/** What happened to a submitted event. */
export type SubmitResult =
  | 'scheduled'  // opened a new window for this key
  | 'coalesced'  // folded into the open window as the new latest
  | 'superseded' // open window kept; this event is newer so it replaced the pending one
  | 'dropped';   // older than the pending event in the open window → ignored

export class CoalesceQueue<T> {
  private readonly pending = new Map<string, { item: T; orderMs: number; handle: unknown }>();

  constructor(
    private readonly deps: CoalesceQueueDeps,
    /** Runs once per window with the latest item for the key. */
    private readonly flush: (key: string, item: T) => void,
  ) {}

  /**
   * Offer an event for `key`. `orderMs` is its TimeOfOfferChange (higher = newer). The window is
   * NOT extended by later events (fixed from the first), so a steady stream evaluates at most once
   * per window rather than being starved by a moving deadline.
   */
  submit(key: string, item: T, orderMs: number): SubmitResult {
    const cur = this.pending.get(key);
    if (!cur) {
      const handle = this.deps.setTimer(() => this.fire(key), this.deps.windowMs);
      this.pending.set(key, { item, orderMs, handle });
      return 'scheduled';
    }
    if (orderMs < cur.orderMs) return 'dropped';
    const superseded = orderMs > cur.orderMs;
    cur.item = item;
    cur.orderMs = orderMs;
    return superseded ? 'superseded' : 'coalesced';
  }

  private fire(key: string): void {
    const cur = this.pending.get(key);
    if (!cur) return;
    this.pending.delete(key);
    this.flush(key, cur.item);
  }

  /** Open windows awaiting flush. */
  get size(): number {
    return this.pending.size;
  }

  /** Cancel all open windows without flushing (shutdown). */
  clear(): void {
    for (const { handle } of this.pending.values()) this.deps.clearTimer(handle);
    this.pending.clear();
  }
}

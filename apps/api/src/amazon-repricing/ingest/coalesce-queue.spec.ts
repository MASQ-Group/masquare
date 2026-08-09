import { describe, expect, it } from 'vitest';
import { CoalesceQueue, CoalesceQueueDeps } from './coalesce-queue';

/** A hand-driven timer harness: timers fire only when we call runDue(nowMs). */
function harness(windowMs = 30_000) {
  let seq = 0;
  const timers = new Map<number, { at: number; cb: () => void }>();
  let clock = 0;
  const deps: CoalesceQueueDeps = {
    windowMs,
    setTimer: (cb, ms) => { const id = ++seq; timers.set(id, { at: clock + ms, cb }); return id; },
    clearTimer: (h) => { timers.delete(h as number); },
  };
  const flushes: { key: string; item: unknown }[] = [];
  const queue = new CoalesceQueue<string>(deps, (key, item) => flushes.push({ key, item }));
  const advance = (ms: number) => {
    clock += ms;
    for (const [id, t] of [...timers.entries()]) {
      if (t.at <= clock) { timers.delete(id); t.cb(); }
    }
  };
  return { queue, flushes, advance };
}

describe('CoalesceQueue', () => {
  it('opens a window on the first event and flushes it after windowMs', () => {
    const { queue, flushes, advance } = harness();
    expect(queue.submit('B0X:DE', 'e1', 100)).toBe('scheduled');
    expect(queue.size).toBe(1);
    expect(flushes).toEqual([]);
    advance(29_999);
    expect(flushes).toEqual([]);
    advance(1);
    expect(flushes).toEqual([{ key: 'B0X:DE', item: 'e1' }]);
    expect(queue.size).toBe(0);
  });

  it('coalesces a burst into a single flush with the latest event', () => {
    const { queue, flushes, advance } = harness();
    queue.submit('B0X:DE', 'e1', 100);
    expect(queue.submit('B0X:DE', 'e2', 200)).toBe('superseded');
    expect(queue.submit('B0X:DE', 'e3', 300)).toBe('superseded');
    advance(30_000);
    expect(flushes).toEqual([{ key: 'B0X:DE', item: 'e3' }]);
  });

  it('does NOT extend the window on later events (fixed from the first)', () => {
    const { queue, flushes, advance } = harness();
    queue.submit('B0X:DE', 'e1', 100);
    advance(20_000);
    queue.submit('B0X:DE', 'e2', 200); // arrives mid-window
    advance(10_000);                    // 30s after the FIRST event → fires now
    expect(flushes).toEqual([{ key: 'B0X:DE', item: 'e2' }]);
  });

  it('drops an out-of-order (older) event, keeping the newer pending one', () => {
    const { queue, flushes, advance } = harness();
    queue.submit('B0X:DE', 'e2', 200);
    expect(queue.submit('B0X:DE', 'e1', 100)).toBe('dropped');
    advance(30_000);
    expect(flushes).toEqual([{ key: 'B0X:DE', item: 'e2' }]);
  });

  it('keeps separate windows per key', () => {
    const { queue, flushes, advance } = harness();
    queue.submit('A:DE', 'a1', 100);
    queue.submit('B:DE', 'b1', 100);
    expect(queue.size).toBe(2);
    advance(30_000);
    expect(flushes).toEqual([
      { key: 'A:DE', item: 'a1' },
      { key: 'B:DE', item: 'b1' },
    ]);
  });

  it('re-opens a fresh window for events arriving after a flush', () => {
    const { queue, flushes, advance } = harness();
    queue.submit('B0X:DE', 'e1', 100);
    advance(30_000);
    expect(queue.submit('B0X:DE', 'e2', 400)).toBe('scheduled');
    advance(30_000);
    expect(flushes).toEqual([
      { key: 'B0X:DE', item: 'e1' },
      { key: 'B0X:DE', item: 'e2' },
    ]);
  });

  it('clear() cancels open windows without flushing', () => {
    const { queue, flushes, advance } = harness();
    queue.submit('B0X:DE', 'e1', 100);
    queue.clear();
    expect(queue.size).toBe(0);
    advance(60_000);
    expect(flushes).toEqual([]);
  });
});

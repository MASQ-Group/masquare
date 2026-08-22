import { describe, expect, it } from 'vitest';
import { JobsService, type JobContext } from './jobs.service';

/** Let the background task run; start() deliberately does not await it. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('JobsService', () => {
  it('returns an id before the work has finished', async () => {
    const jobs = new JobsService();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const view = jobs.start('test', 'Working', async () => { await gate; return { ok: 1 }; });
    expect(view.state).toBe('running');
    expect(jobs.get(view.id)?.state).toBe('running');

    release();
    await settle();
    expect(jobs.get(view.id)?.state).toBe('done');
    expect(jobs.get(view.id)?.result).toEqual({ ok: 1 });
  });

  it('counts successes and failures separately', async () => {
    const jobs = new JobsService();
    const view = jobs.start('test', 'Working', async (ctx: JobContext) => {
      ctx.setTotal(3);
      ctx.tick(true);
      ctx.tick(false);
      ctx.tick(true);
      return null;
    });
    await settle();
    const done = jobs.get(view.id)!;
    expect(done.done).toBe(3);
    expect(done.ok).toBe(2);
    expect(done.failed).toBe(1);
  });

  it('captures a thrown error instead of rejecting', async () => {
    const jobs = new JobsService();
    const view = jobs.start('test', 'Working', async () => { throw new Error('SP-API said no'); });
    await settle();
    const done = jobs.get(view.id)!;
    expect(done.state).toBe('error');
    expect(done.error).toBe('SP-API said no');
  });

  it('closes the gap when a run stops short, so no bar is left parked mid-way', async () => {
    const jobs = new JobsService();
    const view = jobs.start('test', 'Working', async (ctx: JobContext) => {
      ctx.setTotal(100);
      ctx.tick(true);
      throw new Error('stopped');
    });
    await settle();
    const done = jobs.get(view.id)!;
    expect(done.done).toBe(1);
    expect(done.total).toBe(1);
  });

  it('cancels between items, and the work decides when to notice', async () => {
    const jobs = new JobsService();
    let processed = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const view = jobs.start('test', 'Working', async (ctx: JobContext) => {
      ctx.setTotal(5);
      await gate;
      for (let i = 0; i < 5; i++) {
        if (ctx.cancelled) break;
        processed += 1;
        ctx.tick(true);
      }
      return { processed };
    });

    expect(jobs.cancel(view.id)).toBe(true);
    release();
    await settle();
    expect(processed).toBe(0);
    expect(jobs.get(view.id)?.state).toBe('done');
  });

  it('will not cancel a job that has already finished', async () => {
    const jobs = new JobsService();
    const view = jobs.start('test', 'Working', async () => null);
    await settle();
    expect(jobs.cancel(view.id)).toBe(false);
  });

  it('reports an unknown id as absent rather than inventing a job', () => {
    expect(new JobsService().get('nope')).toBeNull();
  });
});

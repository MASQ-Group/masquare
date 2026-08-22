import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

// Progress for actions that take minutes.
//
// Onboarding and floor recomputation each make one live SP-API call per SKU, so a run over the
// whole estate is thousands of sequential calls. Held open as a single request they look identical
// to a hung page: the only signal was a disabled button, which is why runs were abandoned halfway
// and started again. A job is registered, the work continues server-side, and the caller polls.
//
// In memory on purpose: a job is only interesting while it runs, and the alternative — a table
// and a migration — buys durability nobody reads. The cost is that a deploy or restart loses
// running jobs, so the poller reports a vanished job as interrupted rather than as complete.

export type JobState = 'running' | 'done' | 'error';

export interface JobView {
  id: string;
  kind: string;
  label: string;
  state: JobState;
  /** null until the work knows how many items there are. */
  total: number | null;
  done: number;
  ok: number;
  failed: number;
  startedAt: string;
  finishedAt: string | null;
  /** What it is doing right now, when that is more use than a count. */
  message: string | null;
  /** Seconds left at the current rate; null before there is a rate to extrapolate from. */
  etaSeconds: number | null;
  /** The value the underlying action returned, once it is finished. */
  result: unknown | null;
  error: string | null;
}

/** What a running job can report back. */
export interface JobContext {
  setTotal(n: number): void;
  /** One item finished. */
  tick(ok?: boolean): void;
  note(message: string): void;
  /** True once the caller has asked to stop; long loops should check it between items. */
  readonly cancelled: boolean;
}

/**
 * The half of JobContext a worker needs.
 *
 * Services take this rather than JobContext so they stay independent of how progress is surfaced:
 * a caller that does not care passes nothing, and the work behaves exactly as it did before.
 */
export type ProgressSink = Pick<JobContext, 'setTotal' | 'tick' | 'note'>;

interface Job {
  view: JobView;
  cancelled: boolean;
}

/** Finished jobs are kept only long enough for a poller to collect the result. */
const RETAIN_FINISHED_MS = 15 * 60_000;
/** A backstop so a leaked job can never grow the map without bound. */
const MAX_JOBS = 200;
/** Below this many completed items an ETA is noise, so none is offered. */
const MIN_DONE_FOR_ETA = 3;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly jobs = new Map<string, Job>();

  /**
   * Register a job and run it in the background.
   *
   * Returns as soon as the job exists, NOT when the work finishes — the caller answers the HTTP
   * request with the id and the browser polls. Errors are captured onto the job rather than
   * thrown: nothing is awaiting this promise, so a rejection here would be an unhandled one.
   */
  start<T>(kind: string, label: string, fn: (ctx: JobContext) => Promise<T>): JobView {
    this.sweep();
    const id = randomUUID();
    const job: Job = {
      cancelled: false,
      view: {
        id, kind, label,
        state: 'running',
        total: null, done: 0, ok: 0, failed: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        message: null,
        etaSeconds: null,
        result: null,
        error: null,
      },
    };
    this.jobs.set(id, job);

    const startedMs = Date.now();
    const ctx: JobContext = {
      setTotal: (n) => { job.view.total = Math.max(0, Math.floor(n)); },
      tick: (ok = true) => {
        job.view.done += 1;
        if (ok) job.view.ok += 1;
        else job.view.failed += 1;
        job.view.etaSeconds = estimateEta(job.view, startedMs);
      },
      note: (message) => { job.view.message = message; },
      get cancelled() { return job.cancelled; },
    };

    void (async () => {
      try {
        const result = await fn(ctx);
        job.view.result = result ?? null;
        job.view.state = 'done';
      } catch (e) {
        job.view.error = (e as Error)?.message ?? 'Failed';
        job.view.state = 'error';
        this.logger.error(`Job ${kind} failed: ${job.view.error}`);
      } finally {
        job.view.finishedAt = new Date().toISOString();
        job.view.etaSeconds = null;
        // A cancelled or failed run stops short of its total. Leaving the total above `done` would
        // render as a bar frozen at 60% next to the word "done", so close the gap explicitly.
        if (job.view.state !== 'running' && job.view.total != null && job.view.done < job.view.total) {
          job.view.total = job.view.done;
        }
      }
    })();

    return { ...job.view };
  }

  get(id: string): JobView | null {
    const job = this.jobs.get(id);
    return job ? { ...job.view } : null;
  }

  /** Ask a job to stop. It stops between items, so a call already in flight still completes. */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.view.state !== 'running') return false;
    job.cancelled = true;
    job.view.message = 'Stopping after the current SKU…';
    return true;
  }

  /** Drop finished jobs once nobody could still be polling them. */
  private sweep(): void {
    const cutoff = Date.now() - RETAIN_FINISHED_MS;
    for (const [id, job] of this.jobs) {
      const finished = job.view.finishedAt ? Date.parse(job.view.finishedAt) : null;
      if (finished != null && finished < cutoff) this.jobs.delete(id);
    }
    if (this.jobs.size <= MAX_JOBS) return;
    // Oldest first; Map preserves insertion order, and running jobs are never evicted.
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= MAX_JOBS) break;
      if (job.view.state !== 'running') this.jobs.delete(id);
    }
  }
}

function estimateEta(view: JobView, startedMs: number): number | null {
  if (view.total == null || view.done < MIN_DONE_FOR_ETA || view.done >= view.total) return null;
  const perItemMs = (Date.now() - startedMs) / view.done;
  return Math.round(((view.total - view.done) * perItemMs) / 1000);
}

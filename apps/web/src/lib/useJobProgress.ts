import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jobsApi, type JobView } from './api';

/** How often to ask. Fast enough that the bar moves, slow enough to be free next to per-SKU work. */
const POLL_MS = 900;

export interface JobProgress {
  job: JobView | null;
  running: boolean;
  /** 0–1 while a total is known; null while it is not, which renders as a sweep. */
  value: number | null;
  /** The run in words, for the button's title and for screen readers. */
  detail: string;
  /** Set when the run finished badly, including when the server restarted underneath it. */
  error: string | null;
  /** The action's own return value, once it is finished. */
  result: unknown | null;
  start: (begin: () => Promise<JobView>) => Promise<void>;
  cancel: () => void;
  dismiss: () => void;
}

/**
 * Follow a server-side job to completion.
 *
 * The id is kept in sessionStorage under `storageKey`, so reloading the page during a twenty-minute
 * recompute re-attaches to the run instead of appearing to have lost it — the work never depended
 * on the tab staying open, only the display of it did.
 */
export function useJobProgress(storageKey: string, onSettled?: (job: JobView) => void): JobProgress {
  const [jobId, setJobId] = useState<string | null>(() => sessionStorage.getItem(storageKey));
  const [startError, setStartError] = useState<string | null>(null);
  const settledFor = useRef<string | null>(null);
  // Whether this session ever saw the job alive. A remembered id that has since been swept is
  // just a stale note to self, not an interrupted run, and must not open with an alarm.
  const sawRunning = useRef(false);

  const q = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => jobsApi.get(jobId as string),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data && query.state.data.state !== 'running' ? false : POLL_MS),
    // A job id is either being tracked or it is gone; retrying a 404 just delays saying so.
    retry: false,
    gcTime: 0,
  });

  const job = q.data ?? null;
  if (job?.state === 'running') sawRunning.current = true;

  useEffect(() => {
    if (!job || job.state === 'running') return;
    // Fire the settled callback once per job, not once per poll after it finishes.
    if (settledFor.current === job.id) return;
    settledFor.current = job.id;
    sessionStorage.removeItem(storageKey);
    onSettled?.(job);
  }, [job, onSettled, storageKey]);

  const start = useCallback(async (begin: () => Promise<JobView>) => {
    setStartError(null);
    try {
      const started = await begin();
      settledFor.current = null;
      sessionStorage.setItem(storageKey, started.id);
      setJobId(started.id);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setStartError(err.response?.data?.message ?? err.message ?? 'Could not start the run.');
    }
  }, [storageKey]);

  const cancel = useCallback(() => { if (jobId) void jobsApi.cancel(jobId); }, [jobId]);

  const dismiss = useCallback(() => {
    sessionStorage.removeItem(storageKey);
    setJobId(null);
    setStartError(null);
  }, [storageKey]);

  const running = !!job && job.state === 'running';
  const value = job && job.total ? Math.min(1, job.done / job.total) : null;

  // A job that 404s while we were watching it run means the server restarted mid-run — the work
  // stopped, so say so rather than leave a bar parked at whatever percentage it last reached.
  // A 404 we never saw running is a remembered id that has aged out; forget it quietly.
  const gone = q.isError && (q.error as { response?: { status?: number } })?.response?.status === 404;
  useEffect(() => {
    if (gone && !sawRunning.current) sessionStorage.removeItem(storageKey);
  }, [gone, storageKey]);
  const lookupError = !q.isError
    ? null
    : gone
      ? sawRunning.current ? 'That run stopped when the server restarted. Run it again.' : null
      : 'Lost contact with the run.';

  return {
    job,
    running,
    value,
    detail: describe(job),
    error: startError ?? lookupError ?? job?.error ?? null,
    result: job?.state === 'done' ? job.result : null,
    start,
    cancel,
    dismiss,
  };
}

function describe(job: JobView | null): string {
  if (!job) return '';
  if (job.state === 'error') return job.error ?? 'Failed';
  if (job.total == null) return job.message ?? 'Starting…';
  const counted = `${job.done.toLocaleString()} of ${job.total.toLocaleString()}`;
  if (job.state === 'done') return `${counted} · ${job.failed} failed`;
  const parts = [counted];
  if (job.failed > 0) parts.push(`${job.failed} failed`);
  if (job.etaSeconds != null) parts.push(`about ${humanEta(job.etaSeconds)} left`);
  if (job.message) parts.push(job.message);
  return parts.join(' · ');
}

function humanEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

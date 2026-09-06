import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Play, Radar } from 'lucide-react';
import { toast } from 'sonner';
import { availabilitySweepApi, type AvailabilitySweepStatus } from '../../lib/api';
import { SectionHeader } from './shared';

/**
 * The background check that keeps "where could we list this" answered.
 *
 * The two boxes here decide how hard the platform leans on a shared SP-API quota, so the panel
 * spends most of its space saying what the numbers actually mean in days rather than presenting
 * them as preferences. Someone can otherwise set a 30-day re-check that the rate cannot deliver in
 * under five months and never find out.
 */
export function AvailabilityScheduleSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['availability-sweep'], queryFn: () => availabilitySweepApi.status() });

  const [batchSize, setBatchSize] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState('');
  const [recheckDays, setRecheckDays] = useState('');

  // Seeded from the server once, then left alone — re-seeding on every refetch would fight anyone
  // mid-edit and silently discard what they typed.
  useEffect(() => {
    if (!data) return;
    setBatchSize((b) => (b === '' ? String(data.batchSize) : b));
    setIntervalMinutes((v) => (v === '' ? String(data.intervalMinutes) : v));
    setRecheckDays((v) => (v === '' ? String(data.recheckDays) : v));
  }, [data]);

  const save = useMutation({
    mutationFn: (dto: Parameters<typeof availabilitySweepApi.update>[0]) => availabilitySweepApi.update(dto),
    onSuccess: (s) => { qc.setQueryData(['availability-sweep'], s); toast.success('Schedule saved'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the schedule'),
  });

  const runNow = useMutation({
    mutationFn: () => availabilitySweepApi.run(),
    onSuccess: (r) => {
      if (!r.ran) { toast.info(r.reason ?? 'Nothing to do'); return; }
      toast.success(`Checked ${r.checked ?? 0}${r.failed ? `, ${r.failed} failed` : ''}`);
      qc.invalidateQueries({ queryKey: ['availability-sweep'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not run a batch'),
  });

  if (isLoading || !data) return <div className="py-6 text-[13px] text-n-500">Loading…</div>;

  return (
    <div>
      <SectionHeader
        title="Amazon availability check"
        description="Keeps track of which marketplaces each product could be listed on, in the background."
      />

      <div className="flex flex-col gap-4">
        <label className="flex items-start gap-2.5 rounded-lg border border-n-200 bg-n-0 p-3">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => save.mutate({ enabled: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-teal-600"
          />
          <span className="flex-1">
            <span className="block text-[13.5px] font-semibold text-n-800">Run the check in the background</span>
            <span className="mt-0.5 block text-[12.5px] text-n-600">
              A small batch on an interval rather than one nightly pass. Whether a product can be listed changes over
              months, so this is a slow refresh — not a live lookup.
            </span>
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Products per run"
            hint="About two Amazon calls each"
            value={batchSize}
            onChange={setBatchSize}
          />
          <Field
            label="Minutes between runs"
            hint="5 is the shortest possible"
            value={intervalMinutes}
            onChange={setIntervalMinutes}
          />
          <Field
            label="Re-check after (days)"
            hint="How old an answer may get"
            value={recheckDays}
            onChange={setRecheckDays}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({
              batchSize: Number(batchSize),
              intervalMinutes: Number(intervalMinutes),
              recheckDays: Number(recheckDays),
            })}
            className="inline-flex h-9 items-center rounded-md bg-teal-600 px-3.5 text-[13px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save schedule'}
          </button>
          <button
            type="button"
            disabled={runNow.isPending}
            onClick={() => runNow.mutate()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
          >
            <Play size={14} /> {runNow.isPending ? 'Running…' : 'Run one batch now'}
          </button>
          {/* Deliberately runs even when the schedule is off: the reason to press it is to find out
              whether it works before leaving it switched on. */}
          <span className="text-[11.5px] text-n-400">Runs immediately, whether or not the schedule is on.</span>
        </div>

        <Projection data={data} />
        <Coverage data={data} />
      </div>
    </div>
  );
}

function Field({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-n-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="mono h-9 rounded-md border border-n-200 px-2.5 text-[13px] outline-none focus:border-teal-400"
      />
      <span className="text-[11.5px] text-n-400">{hint}</span>
    </label>
  );
}

/**
 * What the saved numbers actually deliver.
 *
 * The arithmetic is the point. "Re-check every 30 days" against a rate that needs 150 is not a
 * 30-day re-check, and the only place anyone would ever notice is here.
 */
function Projection({ data }: { data: AvailabilitySweepStatus }) {
  const never = data.fullPassDays == null;
  return (
    <div className={`rounded-lg border p-3 text-[12.5px] ${data.behind ? 'border-amber-200 bg-amber-50' : 'border-n-200 bg-n-25'}`}>
      <div className="flex items-start gap-2">
        {data.behind ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" /> : <Clock size={14} className="mt-0.5 shrink-0 text-n-400" />}
        <div className="flex-1">
          {never ? (
            <p className="text-n-700">At this rate nothing is ever checked — the batch size or the interval leaves no time to work.</p>
          ) : (
            <p className={data.behind ? 'text-amber-900' : 'text-n-700'}>
              <b>{data.pairsPerDay.toLocaleString()}</b> product-marketplace pairs a day, so one pass over all{' '}
              <b>{data.totalPairs.toLocaleString()}</b> takes about <b>{data.fullPassDays} days</b>.
              {data.behind
                ? ` That is longer than the ${data.recheckDays}-day re-check, so answers will be older than that setting promises. Raise the batch size or shorten the interval.`
                : ` Comfortably inside the ${data.recheckDays}-day re-check.`}
            </p>
          )}
          {/* Stated because it is the largest saving and the least obvious: a third of all pairs
              never enter the queue at all. */}
          <p className="mt-1 text-[11.5px] text-n-500">
            Marketplaces a product is already listed on are not counted or checked — the listings themselves answer for those.
            Products without an EAN or UPC are skipped, because Amazon cannot be searched without one.
          </p>
        </div>
      </div>
    </div>
  );
}

/** How far it has actually got. The projection is a promise; this is the record. */
function Coverage({ data }: { data: AvailabilitySweepStatus }) {
  const pct = data.totalPairs > 0 ? Math.round((data.checkedPairs / data.totalPairs) * 100) : 0;
  return (
    <div className="rounded-lg border border-n-200 bg-n-0 p-3">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-n-800">
        <Radar size={14} className="text-teal-600" /> Coverage so far
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-n-100">
        <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-n-600">
        <span><b className="text-n-800">{data.checkedPairs.toLocaleString()}</b> of {data.totalPairs.toLocaleString()} checked ({pct}%)</span>
        <span><b className="text-n-800">{data.neverChecked.toLocaleString()}</b> never checked</span>
        {data.oldestCheckedAt && <span>Oldest answer {new Date(data.oldestCheckedAt).toLocaleDateString()}</span>}
        {data.lastRunAt && <span>Last run {new Date(data.lastRunAt).toLocaleString()}</span>}
        {data.enabled && data.nextDueAt && <span>Next due {new Date(data.nextDueAt).toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}

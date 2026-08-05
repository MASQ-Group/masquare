import { useMemo, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { integrationsApi, type ChannelIntegration } from '../../lib/api';

interface Props {
  /** Human label for the scope, e.g. "all connections" or "Amazon". */
  scopeLabel: string;
  integrations: ChannelIntegration[];
  onClose: () => void;
  onDone: () => void;
}

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
const MONTHS = [
  { value: 'all', label: 'All months' },
  ...['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((label, i) => ({ value: String(i + 1), label })),
];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');

const canSync = (i: ChannelIntegration) => !!i.mappingVerifiedAt && !!i.targetSalesChannelId && !!i.targetCompanyId && i.status === 'active';

/** Backdated pull of older orders across a group of connections (sequential — never hits a
 *  channel's API in parallel). Same range logic as the per-channel BackfillModal. */
export function GroupBackfillModal({ scopeLabel, integrations, onClose, onDone }: Props) {
  const [mode, setMode] = useState<'year' | 'custom'>('year');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState('all');
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(iso(new Date()));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<{ name: string; ok: boolean; created: number; updated: number; error?: string }[] | null>(null);

  const ready = useMemo(() => integrations.filter(canSync), [integrations]);
  const range = useMemo(() => {
    if (mode === 'custom') return { from, to };
    if (month === 'all') return { from: `${year}-01-01`, to: `${year}-12-31` };
    const m = Number(month);
    const lastDay = new Date(year, m, 0).getDate();
    return { from: `${year}-${pad(m)}-01`, to: `${year}-${pad(m)}-${pad(lastDay)}` };
  }, [mode, year, month, from, to]);

  const run = async () => {
    if (!range.from) { toast.error('Pick a start date'); return; }
    if (ready.length === 0) { toast.info('No connections in this group are ready (verify mapping + target first).'); return; }
    setResults(null);
    setProgress({ done: 0, total: ready.length });
    const out: { name: string; ok: boolean; created: number; updated: number; error?: string }[] = [];
    for (const t of ready) {
      try {
        const res = await integrationsApi.sync(t.id, range);
        out.push({ name: t.name, ok: res.ok, created: res.created, updated: res.updated, error: res.ok ? undefined : res.message });
      } catch (e: any) {
        out.push({ name: t.name, ok: false, created: 0, updated: 0, error: e?.response?.data?.message ?? 'Failed' });
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setResults(out);
    setProgress(null);
    const ok = out.filter((r) => r.ok);
    const created = ok.reduce((s, r) => s + r.created, 0);
    if (out.every((r) => r.ok)) toast.success(`Pulled older orders for ${ok.length} connection(s) — ${created} created`);
    else toast.warning(`${ok.length}/${out.length} succeeded — ${created} created`);
    onDone();
  };

  return (
    <ModalShell
      open
      title={`Pull older orders — ${scopeLabel}`}
      subtitle={`${ready.length} ready connection${ready.length === 1 ? '' : 's'} in scope`}
      onClose={onClose}
      primaryLabel={progress ? `Pulling ${progress.done}/${progress.total}…` : 'Pull older orders'}
      onPrimary={run}
      primaryDisabled={!!progress || ready.length === 0}
      busy={!!progress}
      initialSize={{ w: 560, h: 520 }}
    >
      <div className="flex flex-col gap-4 p-1 text-[13px]">
        <p className="text-n-500">
          Imports orders in the chosen range across <strong>{ready.length}</strong> ready connection{ready.length === 1 ? '' : 's'}
          {integrations.length !== ready.length && <span className="text-n-400"> ({integrations.length - ready.length} not ready — skipped)</span>}. Runs one connection at a time.
        </p>

        <div className="flex rounded-lg border border-n-200 p-[3px] text-[12.5px] font-semibold">
          <button onClick={() => setMode('year')} className={`flex-1 rounded-md px-3 py-1.5 ${mode === 'year' ? 'bg-teal-500 text-white' : 'text-n-600'}`}>By year / month</button>
          <button onClick={() => setMode('custom')} className={`flex-1 rounded-md px-3 py-1.5 ${mode === 'custom' ? 'bg-teal-500 text-white' : 'text-n-600'}`}>Custom range</button>
        </div>

        {mode === 'year' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className="text-[12px] text-n-500">Year</span>
              <Select value={String(year)} onChange={(v) => setYear(Number(v))} options={YEARS.map((y) => ({ value: String(y), label: String(y) }))} />
            </label>
            <label className="flex flex-col gap-1"><span className="text-[12px] text-n-500">Month</span>
              <Select value={month} onChange={setMonth} options={MONTHS} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className="text-[12px] text-n-500">From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-n-200 px-2.5 text-[13px]" />
            </label>
            <label className="flex flex-col gap-1"><span className="text-[12px] text-n-500">To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border border-n-200 px-2.5 text-[13px]" />
            </label>
          </div>
        )}

        <div className="rounded-md bg-n-25 px-3 py-2 font-mono text-[12px] text-n-600">{range.from} → {range.to}</div>

        {results && (
          <div className="max-h-40 overflow-y-auto rounded-md border border-n-100">
            {results.map((r) => (
              <div key={r.name} className="flex items-center gap-2 border-b border-n-50 px-3 py-1.5 text-[12px] last:border-0">
                {r.ok ? <CheckCircle2 size={14} className="text-teal-600" /> : <XCircle size={14} className="text-danger" />}
                <span className="flex-1 truncate text-n-700">{r.name}</span>
                <span className="font-mono text-n-500">{r.ok ? `+${r.created} / ~${r.updated}` : r.error}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

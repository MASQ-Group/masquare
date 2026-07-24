import { useMemo, useState } from 'react';
import { CalendarRange, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { DateRangePicker, ModalShell, Select } from '@masquare/ui';
import { integrationsApi, type ChannelIntegration, type IntegrationSyncResult } from '../../lib/api';

interface Props {
  integration: ChannelIntegration;
  onClose: () => void;
  onDone: () => void;
}

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
const MONTHS = [
  { value: 'all', label: 'All Months' },
  ...['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    .map((label, i) => ({ value: String(i + 1), label })),
];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');

/** Backdated pull: import all orders in a chosen date range (e.g. all of 2026). */
export function BackfillModal({ integration, onClose, onDone }: Props) {
  const [mode, setMode] = useState<'year' | 'custom'>('year');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState('all');
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(iso(new Date()));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IntegrationSyncResult | null>(null);

  const range = useMemo(() => {
    if (mode === 'custom') return { from, to };
    if (month === 'all') return { from: `${year}-01-01`, to: `${year}-12-31` };
    const m = Number(month);
    const lastDay = new Date(year, m, 0).getDate(); // day 0 of next month = last day of this month
    return { from: `${year}-${pad(m)}-01`, to: `${year}-${pad(m)}-${pad(lastDay)}` };
  }, [mode, year, month, from, to]);

  const run = async () => {
    if (!range.from) { toast.error('Pick a start date'); return; }
    setBusy(true);
    setResult(null);
    try {
      const res = await integrationsApi.sync(integration.id, range);
      setResult(res);
      if (res.ok) toast.success(`Backfill complete — ${res.created} created, ${res.updated} updated`);
      else toast.error(res.message ?? 'Backfill failed');
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Backfill failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title="Pull Backdated Orders"
      subtitle={[integration.connectorLabel, integration.marketplaceLabel].filter(Boolean).join(' · ')}
      initialSize={{ w: 560, h: 460 }}
      primaryLabel={busy ? 'Pulling…' : 'Pull orders'}
      onPrimary={run}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <p className="flex items-start gap-2 rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
          <CalendarRange size={15} className="mt-0.5 shrink-0" />
          Imports every order placed in the selected range as draft transactions, deduped by order ID. Safe to run repeatedly — it won't create duplicates and won't disturb the incremental sync.
        </p>

        <div className="flex gap-2">
          {(['year', 'custom'] as const).map((m) => (
            <button key={m} className={`rounded-md border px-3 py-1.5 text-[13px] font-medium ${mode === m ? 'border-teal-300 bg-teal-50 text-teal-700' : 'border-n-200 text-n-600'}`} onClick={() => setMode(m)}>
              {m === 'year' ? 'Specific year' : 'Custom range'}
            </button>
          ))}
        </div>

        {mode === 'year' ? (
          <div className="flex gap-3">
            <div className="w-[140px]">
              <label className="label">Year</label>
              <Select value={String(year)} onChange={(v) => setYear(Number(v))} options={YEARS.map((y) => ({ value: String(y), label: String(y) }))} />
            </div>
            <div className="w-[180px]">
              <label className="label">Month</label>
              <Select value={month} onChange={setMonth} options={MONTHS} />
            </div>
          </div>
        ) : (
          <div className="max-w-[320px]">
            <label className="label">Date range</label>
            <DateRangePicker value={{ from, to }} onChange={(r) => { setFrom(r.from); setTo(r.to); }} />
          </div>
        )}

        <p className="text-[12px] text-n-400">Will pull orders from <strong className="mono">{range.from}</strong> to <strong className="mono">{range.to ?? 'today'}</strong>.</p>

        {result && (
          <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-[13px] ${result.ok ? 'border-success-bd bg-success-bg text-n-700' : 'border-danger-bd bg-danger-bg text-danger'}`}>
            {result.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
            <span>{result.message}{result.ok ? ` — scanned ${result.scanned} orders.` : ''}</span>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

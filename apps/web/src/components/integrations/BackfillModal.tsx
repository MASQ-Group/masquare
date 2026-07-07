import { useMemo, useState } from 'react';
import { CalendarRange, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { DateRangePicker, ModalShell } from '@masquare/ui';
import { integrationsApi, type ChannelIntegration, type IntegrationSyncResult } from '../../lib/api';

interface Props {
  integration: ChannelIntegration;
  onClose: () => void;
  onDone: () => void;
}

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Backdated pull: import all orders in a chosen date range (e.g. all of 2026). */
export function BackfillModal({ integration, onClose, onDone }: Props) {
  const [mode, setMode] = useState<'year' | 'custom'>('year');
  const [year, setYear] = useState(new Date().getFullYear());
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(iso(new Date()));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IntegrationSyncResult | null>(null);

  const range = useMemo(() => (mode === 'year' ? { from: `${year}-01-01`, to: `${year}-12-31` } : { from, to }), [mode, year, from, to]);

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
      title="Pull backdated orders"
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
          <div className="max-w-[200px]">
            <label className="label">Year</label>
            <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
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

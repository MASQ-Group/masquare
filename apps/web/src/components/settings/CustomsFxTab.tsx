import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { customsFxApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function CustomsFxTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [year, setYear] = useState<number | undefined>(undefined);
  const [filter, setFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customs-fx', year],
    queryFn: () => customsFxApi.get(year),
  });

  const sync = useMutation({
    mutationFn: () => customsFxApi.sync(),
    onSuccess: (res) => {
      if (res.status === 'success') toast.success(`Synced ${res.ratesImported} rates across ${res.monthsImported} months`);
      else toast.error(res.message ?? 'Sync failed');
      qc.invalidateQueries({ queryKey: ['customs-fx'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Sync failed'),
  });

  const currencies = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = data?.currencies ?? [];
    if (!q) return all;
    return all.filter((c) => c.code.toLowerCase().includes(q) || (c.name ?? '').toLowerCase().includes(q));
  }, [data?.currencies, filter]);

  const lastSync = data?.lastSync;

  return (
    <div>
      <div className="mb-4 flex items-start gap-4 max-[720px]:flex-col">
        <div className="flex-1">
          <h2 className="text-[17px] font-semibold text-n-900">Cyprus Customs exchange rates</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-[1.55] text-n-500">
            Official monthly foreign-currency rates against the Euro, published by the Cyprus Customs &amp; Excise Department
            for customs and tax purposes. Rates are units of the foreign currency per <strong>1&nbsp;EUR</strong>, pulled
            automatically each month from the{' '}
            <a href={data?.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-teal-700 hover:underline">
              Cyprus open-data portal <ExternalLink size={12} />
            </a>.
          </p>
        </div>
        {isAdmin && (
          <button
            className="btn btn-ghost whitespace-nowrap"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCw size={15} className={sync.isPending ? 'animate-spin' : ''} /> {sync.isPending ? 'Syncing…' : 'Sync now'}
          </button>
        )}
      </div>

      {/* Sync status */}
      {lastSync && (
        <div className={`mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border px-3.5 py-2.5 text-[12.5px] ${lastSync.status === 'success' ? 'border-success-bd bg-success-bg text-n-700' : 'border-danger-bd bg-danger-bg text-n-700'}`}>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {lastSync.status === 'success'
              ? <><CheckCircle2 size={14} className="text-success" /> Last synced</>
              : <><AlertTriangle size={14} className="text-danger" /> Last sync failed</>}
          </span>
          <span>{fmtDateTime(lastSync.createdAt)}</span>
          <span className="text-n-500">Source updated: {lastSync.sourceModified ? fmtDateTime(lastSync.sourceModified) : '—'}</span>
          {lastSync.status === 'success'
            ? <span className="text-n-500">{lastSync.ratesImported} rates · {lastSync.monthsImported} months</span>
            : lastSync.message && <span className="text-danger">{lastSync.message}</span>}
        </div>
      )}

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <select
          className="h-[38px] rounded-md border border-n-200 bg-n-0 px-2 text-[13px] text-n-700"
          value={data?.year ?? ''}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {(data?.availableYears ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="flex h-[38px] min-w-[200px] items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3">
          <Search size={15} className="text-n-400" />
          <input
            className="h-full flex-1 text-[13px] outline-none"
            placeholder="Filter currencies…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <span className="text-[12.5px] text-n-400">{currencies.length} currencies</span>
      </div>

      {/* Rate table: months down, currencies across */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-r border-n-200 bg-n-25 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">
                  Month
                </th>
                {currencies.map((c) => (
                  <th key={c.code} className="border-b border-n-200 bg-n-25 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-n-600 whitespace-nowrap" title={c.name ?? undefined}>
                    {c.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={currencies.length + 1} className="px-4 py-10 text-center text-n-500">Loading…</td></tr>}
              {!isLoading && (data?.months.length ?? 0) === 0 && (
                <tr><td colSpan={currencies.length + 1} className="px-4 py-12 text-center text-n-500">
                  No rates stored yet.{isAdmin ? ' Click “Sync now” to pull them from the Cyprus open-data portal.' : ''}
                </td></tr>
              )}
              {data?.months.map((m) => (
                <tr key={m.month} className="hover:bg-teal-50/40">
                  <td className="sticky left-0 z-10 border-b border-r border-n-100 bg-n-0 px-3 py-2 font-medium text-n-800">
                    {MONTH_NAMES[m.month - 1]} {data.year}
                  </td>
                  {currencies.map((c) => (
                    <td key={c.code} className="mono border-b border-n-100 px-3 py-2 text-right text-n-700 whitespace-nowrap">
                      {m.rates[c.code] != null ? m.rates[c.code] : <span className="text-n-300">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-[11.5px] text-n-400">
        Automatic refresh runs on the 2nd of each month. Values shown exactly as published (foreign currency per 1&nbsp;EUR); “—” means the currency was not quoted that month.
      </p>
    </div>
  );
}

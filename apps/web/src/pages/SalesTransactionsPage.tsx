import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Columns3, Lock, Pencil, Plus, RotateCcw, Save, Search, Trash2, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { profitTiersApi, salesChannelsApi, salesTransactionsApi, settingsApi, type ProfitTier, type SalesTransaction } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney } from '../lib/format';
import { SalesTransactionModal } from '../components/sales/SalesTransactionModal';
import { SalesTransactionSummaryModal } from '../components/sales/SalesTransactionSummaryModal';
import { ResolveTransactionModal } from '../components/sales/ResolveTransactionModal';

type ColKey =
  | 'date' | 'ref' | 'status' | 'shipped' | 'channel' | 'destination' | 'skus' | 'qty'
  | 'netSales' | 'salesFee' | 'feePct' | 'estShip' | 'profit' | 'profitPct'
  | 'vatPct' | 'weight' | 'fx';

type SortKey = 'date' | 'profit' | 'profitPct';

const ALL_COLUMNS: { key: ColKey; label: string; standard: boolean; right?: boolean; sort?: SortKey }[] = [
  { key: 'date', label: 'Date', standard: true, sort: 'date' },
  { key: 'ref', label: 'Transaction ID', standard: true },
  { key: 'status', label: 'Status', standard: true },
  { key: 'shipped', label: 'Shipment', standard: true },
  { key: 'channel', label: 'Sales channel', standard: true },
  { key: 'destination', label: 'Destination', standard: true },
  { key: 'skus', label: 'SKUs', standard: true },
  { key: 'qty', label: 'Qty', standard: true, right: true },
  { key: 'netSales', label: 'Net sales', standard: true, right: true },
  { key: 'salesFee', label: 'Sales fee', standard: true, right: true },
  { key: 'feePct', label: 'Fee %', standard: true, right: true },
  { key: 'estShip', label: 'Est. ship', standard: true, right: true },
  { key: 'profit', label: 'Profit (€)', standard: true, right: true, sort: 'profit' },
  { key: 'profitPct', label: 'Profit (%)', standard: true, right: true, sort: 'profitPct' },
  { key: 'vatPct', label: 'Dest. VAT %', standard: false, right: true },
  { key: 'weight', label: 'Weight (kg)', standard: false, right: true },
  { key: 'fx', label: 'FX rate', standard: false, right: true },
];
const ALL_KEYS = ALL_COLUMNS.map((c) => c.key);
const DEFAULT_STANDARD = ALL_COLUMNS.filter((c) => c.standard).map((c) => c.key);
const orderedFrom = (set: Set<ColKey>) => ALL_COLUMNS.filter((c) => set.has(c.key)).map((c) => c.key);

const money = (amount: number | null | undefined, currency: string) => formatMoney({ amount: amount ?? null, currency });

export function SalesTransactionsPage() {
  const qc = useQueryClient();
  const { activeCompanyId, user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [searchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const [qInput, setQInput] = useState(urlQ);
  const [q, setQ] = useState(urlQ);
  const [page, setPage] = useState(1);
  // Deep link from the global search: /sales-transactions?q=… applies (and re-applies) the search.
  useEffect(() => { if (urlQ) { setQInput(urlQ); setQ(urlQ); setPage(1); } }, [urlQ]);
  const [editing, setEditing] = useState<SalesTransaction | null | undefined>(undefined);
  const [viewing, setViewing] = useState<SalesTransaction | undefined>(undefined);
  const [resolving, setResolving] = useState<SalesTransaction | undefined>(undefined);
  const [reqOpen, setReqOpen] = useState(false);

  // view controls
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterChannel, setFilterChannel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTier, setFilterTier] = useState('');
  const [eurOnly, setEurOnly] = useState(false);
  const [cols, setCols] = useState<Set<ColKey>>(new Set(DEFAULT_STANDARD));
  const [colsCustomized, setColsCustomized] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => settingsApi.get() });
  // Admin-defined standard column set (falls back to the built-in default).
  const standardCols = useMemo<ColKey[]>(() => {
    const raw = settings?.salesTxStandardColumns;
    const valid = raw?.filter((k): k is ColKey => (ALL_KEYS as string[]).includes(k)) ?? [];
    return valid.length ? valid : DEFAULT_STANDARD;
  }, [settings]);
  // Apply the standard set as the default until the user customises columns this session.
  useEffect(() => { if (!colsCustomized) setCols(new Set(standardCols)); }, [standardCols, colsCustomized]);

  const toggleCol = (key: ColKey) => { setCols((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; }); setColsCustomized(true); };
  const resetCols = () => { setCols(new Set(standardCols)); setColsCustomized(false); };
  const saveStandard = useMutation({
    mutationFn: () => settingsApi.update({ salesTxStandardColumns: orderedFrom(cols) }),
    onSuccess: () => { toast.success('Standard view saved for everyone'); setColsCustomized(false); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save standard view'),
  });

  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const { data: profitTiers = [] } = useQuery({ queryKey: ['profit-tiers'], queryFn: () => profitTiersApi.list() });
  const { data: unlockReqs = [] } = useQuery({
    queryKey: ['unlock-requests'], queryFn: () => salesTransactionsApi.listUnlockRequests(),
    enabled: isAdmin, refetchInterval: isAdmin ? 15000 : false,
  });
  const decide = useMutation({
    mutationFn: ({ id, grant }: { id: string; grant: boolean }) => salesTransactionsApi.decideUnlock(id, grant),
    onSuccess: (_r, v) => { toast.success(v.grant ? 'Unlock granted' : 'Request denied'); qc.invalidateQueries({ queryKey: ['unlock-requests'] }); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); },
  });

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const params = { q: q || undefined, companyId: activeCompanyId || undefined, salesChannelId: filterChannel || undefined, status: filterStatus || undefined, profitTierId: filterTier || undefined, sortBy, sortDir, page, pageSize: 50 };
  const { data, isLoading } = useQuery({ queryKey: ['sales-transactions', params], queryFn: () => salesTransactionsApi.list(params) });
  const del = useMutation({
    mutationFn: (id: string) => salesTransactionsApi.remove(id),
    onSuccess: () => { toast.success('Transaction removed'); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 50));
  const visible = useMemo(() => ALL_COLUMNS.filter((c) => cols.has(c.key)), [cols]);
  // Use text chips for Status/Shipment while the column set is compact enough to stay on
  // one line; switch to space-saving circles once more columns are shown.
  const chipMode: 'text' | 'circle' = visible.length <= 9 ? 'text' : 'circle';

  const netCell = (t: SalesTransaction) => {
    if (eurOnly) return t.exchangeRate != null ? money(t.totals.netSales * t.exchangeRate, 'EUR') : '—';
    return money(t.totals.netSales, t.currency ?? 'EUR');
  };
  const feeCell = (t: SalesTransaction) => {
    if (eurOnly) { const r = t.feeExchangeRate ?? t.exchangeRate; return r != null ? money(t.totals.fee * r, 'EUR') : '—'; }
    return money(t.totals.fee, t.feeCurrency ?? t.currency ?? 'EUR');
  };

  // Profit (%) chip, coloured by the matching profit tier from Global Settings.
  const profitPctChip = (t: SalesTransaction) => {
    if (t.profitPct == null) return '—';
    const tier = profitTiers.find((x: ProfitTier) => t.profitPct! >= x.fromPct && t.profitPct! <= x.toPct);
    const style = tier ? { background: tier.bgColor, color: tier.fontColor } : undefined;
    return (
      <span className={`tag mono ${tier ? '' : 'border border-n-200 bg-n-100 text-n-600'}`} style={style} title={tier?.name ?? undefined}>
        {t.profitPct.toFixed(2)}%
      </span>
    );
  };

  const renderCell = (key: ColKey, t: SalesTransaction) => {
    switch (key) {
      case 'date': return formatDate(t.date);
      case 'ref': return <span className="font-medium text-n-800">{t.transactionRef}</span>;
      case 'status': return (
        <span className="inline-flex items-center gap-1.5">
          {chipMode === 'text'
            ? (t.status === 'submitted'
                ? <span className="tag inline-flex items-center gap-1 whitespace-nowrap border border-teal-100 bg-teal-50 text-teal-700"><Lock size={11} /> Submitted</span>
                : <span className="tag whitespace-nowrap border border-orange-100 bg-orange-50 text-orange-700">Draft</span>)
            : <span className={`inline-block h-2.5 w-2.5 rounded-full ${t.status === 'submitted' ? 'bg-teal-500' : 'bg-orange-400'}`} title={t.status === 'submitted' ? 'Submitted' : 'Draft'} />}
          {t.unlockedForEdit && <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" title="Unlocked for edit" />}
          {t.hasPendingUnlock && <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-500" title="Unlock request pending" />}
        </span>
      );
      case 'shipped': return chipMode === 'text'
        ? (t.shipped
            ? <span className="tag whitespace-nowrap border border-teal-100 bg-teal-50 text-teal-700">Shipped</span>
            : <span className="tag whitespace-nowrap border border-n-200 bg-n-100 text-n-500">Not shipped</span>)
        : <span className={`inline-block h-2.5 w-2.5 rounded-full ${t.shipped ? 'bg-teal-500' : 'bg-n-300'}`} title={t.shipped ? 'Shipped' : 'Not shipped'} />;
      case 'channel': return t.salesChannel?.name ?? '—';
      case 'destination': return t.destinationCountry?.name ?? '—';
      case 'skus': return (
        <div className="flex flex-wrap gap-1">
          {t.items.slice(0, 3).map((it, idx) => <span key={idx} className="mono rounded bg-n-100 px-1.5 py-0.5 text-[11px] text-n-600">{it.sku}</span>)}
          {t.itemCount > 3 && <span className="text-[11px] text-n-400">+{t.itemCount - 3}</span>}
        </div>
      );
      case 'qty': return t.totals.quantity;
      case 'netSales': return netCell(t);
      case 'salesFee': return feeCell(t);
      case 'feePct': return t.salesFeePct != null ? `${t.salesFeePct}%` : '—';
      case 'estShip': return t.estimatedShippingCost != null ? money(t.estimatedShippingCost, 'EUR') : '—';
      case 'profit': return t.profit != null ? <span className="font-medium" style={{ color: t.profit >= 0 ? '#14A79D' : 'var(--danger)' }}>{money(t.profit, 'EUR')}</span> : '—';
      case 'profitPct': return profitPctChip(t);
      case 'vatPct': return t.destinationCountryVatPct != null ? `${t.destinationCountryVatPct}%` : '—';
      case 'weight': return t.overallPackageWeight != null ? t.overallPackageWeight : '—';
      case 'fx': return t.exchangeRate != null ? t.exchangeRate : '—';
    }
  };

  const cellClass = (key: ColKey, right?: boolean) => {
    const mono = ['date', 'ref', 'qty', 'netSales', 'salesFee', 'feePct', 'estShip', 'profit', 'profitPct', 'vatPct', 'weight', 'fx'].includes(key);
    return `border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700 ${mono ? 'mono' : ''} ${right ? 'text-right' : ''}`;
  };

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex-1">
          <div className="eyebrow mb-1.5">Sales Transactions</div>
          <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Sales transactions</h1>
          <p className="mt-1 text-[13.5px] text-n-500">Register and review sales across all channels. Revenue/profit analytics build on this data.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(null)}><Plus size={17} /> Register transaction</button>
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="flex h-[38px] min-w-[220px] flex-1 items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3">
          <Search size={16} className="text-n-400" />
          <input className="h-full flex-1 text-[13px] outline-none" placeholder="Search transaction ID or SKU…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <select className="h-[38px] rounded-md border border-n-200 bg-n-0 px-2 text-[13px] text-n-700" value={filterChannel} onChange={(e) => { setFilterChannel(e.target.value); setPage(1); }}>
          <option value="">All channels</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="h-[38px] rounded-md border border-n-200 bg-n-0 px-2 text-[13px] text-n-700" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
        </select>
        {profitTiers.length > 0 && (
          <select className="h-[38px] rounded-md border border-n-200 bg-n-0 px-2 text-[13px] text-n-700" value={filterTier} onChange={(e) => { setFilterTier(e.target.value); setPage(1); }}>
            <option value="">All profit tiers</option>
            {profitTiers.map((t) => (
              <option key={t.id} value={t.id}>{t.name || `Tier ${t.sortOrder + 1}`} ({t.fromPct}% – {t.toPct}%)</option>
            ))}
          </select>
        )}
        <label className="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-medium text-n-700">
          <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={eurOnly} onChange={(e) => setEurOnly(e.target.checked)} />
          Show in EUR
        </label>
        <div className="relative">
          <button className="inline-flex h-[38px] items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-medium text-n-700 hover:border-n-300" onClick={() => setColsOpen((v) => !v)}>
            <Columns3 size={15} className="opacity-60" /> Columns
          </button>
          {colsOpen && (
            <div className="absolute right-0 top-11 z-40 max-h-[26rem] w-60 overflow-auto rounded-lg border border-n-200 bg-n-0 p-2 shadow-lg" onMouseLeave={() => setColsOpen(false)}>
              {ALL_COLUMNS.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-n-50">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={cols.has(c.key)} onChange={() => toggleCol(c.key)} />
                  <span className="text-[13px] text-n-700">{c.label}</span>
                </label>
              ))}
              <button className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-teal-700 hover:bg-teal-50" onClick={resetCols}>Reset to standard view</button>
              {isAdmin && (
                <button
                  className="mt-0.5 flex w-full items-center gap-1.5 rounded-md border-t border-n-100 px-2 py-1.5 text-left text-[12px] font-semibold text-n-700 hover:bg-n-50 disabled:opacity-50"
                  disabled={saveStandard.isPending}
                  onClick={() => saveStandard.mutate()}
                >
                  <Save size={13} className="opacity-70" /> {saveStandard.isPending ? 'Saving…' : 'Save current as standard view'}
                </button>
              )}
            </div>
          )}
        </div>
        {isAdmin && (
          <button className="inline-flex h-[38px] items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-medium text-n-700 hover:border-n-300" onClick={() => setReqOpen(true)}>
            <Unlock size={15} className="opacity-70" /> Unlock requests
            {unlockReqs.length > 0 && <span className="mono rounded-pill bg-orange-100 px-1.5 text-[11px] font-semibold text-orange-700">{unlockReqs.length}</span>}
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                {visible.map((c) => (
                  <th key={c.key} className={`border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${c.right ? 'text-right' : 'text-left'}`}>
                    {c.sort ? (
                      <button
                        className={`inline-flex items-center gap-1 uppercase hover:text-n-800 ${sortBy === c.sort ? 'text-n-800' : 'text-n-500'}`}
                        onClick={() => {
                          if (sortBy === c.sort) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
                          else { setSortBy(c.sort!); setSortDir('desc'); }
                          setPage(1);
                        }}
                      >
                        {c.label} {sortBy === c.sort && (sortDir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                      </button>
                    ) : c.label}
                  </th>
                ))}
                <th className="border-b border-n-200 bg-n-25" />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={visible.length + 1} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td colSpan={visible.length + 1} className="px-4 py-12 text-center text-[13px] text-n-500">No transactions match. Register your first sale.</td></tr>}
              {items.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-teal-50" onClick={() => setViewing(t)}>
                  {visible.map((c) => <td key={c.key} className={cellClass(c.key, c.right)}>{renderCell(c.key, t)}</td>)}
                  <td className="border-b border-n-100 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" title="Edit transaction" onClick={() => setEditing(t)}><Pencil size={15} /></button>
                      <button
                        className={`relative grid h-8 w-8 place-items-center rounded-md hover:bg-n-100 hover:text-n-800 ${t.resolution !== 'none' ? 'text-orange-600' : 'text-n-500'}`}
                        title={t.resolution === 'none' ? 'Resolve / return' : 'Edit resolution'}
                        onClick={() => setResolving(t)}
                      >
                        <RotateCcw size={15} />
                        {t.resolution !== 'none' && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-orange-500" />}
                      </button>
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" title="Remove" onClick={() => confirm(`Remove transaction ${t.transactionRef}?`) && del.mutate(t.id)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[13px] text-n-500">Showing <span className="mono">{items.length}</span> of <span className="mono">{total}</span> transactions</span>
        <div className="flex gap-1">
          <button disabled={page <= 1} className="mono grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-[13px] text-n-600 disabled:opacity-40" onClick={() => setPage((p) => p - 1)}>‹</button>
          <span className="mono grid h-8 min-w-8 place-items-center px-2 text-[13px] text-n-600">{page} / {pageCount}</span>
          <button disabled={page >= pageCount} className="mono grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-[13px] text-n-600 disabled:opacity-40" onClick={() => setPage((p) => p + 1)}>›</button>
        </div>
      </div>

      {viewing !== undefined && editing === undefined && resolving === undefined && (
        <SalesTransactionSummaryModal
          transaction={viewing}
          onClose={() => setViewing(undefined)}
          onEdit={() => { setEditing(viewing); setViewing(undefined); }}
          onResolve={() => { setResolving(viewing); setViewing(undefined); }}
        />
      )}
      {resolving !== undefined && (
        <ResolveTransactionModal
          transaction={resolving}
          onClose={() => setResolving(undefined)}
          onSaved={() => { setResolving(undefined); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); }}
        />
      )}
      {editing !== undefined && (
        <SalesTransactionModal transaction={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); }} />
      )}
      {reqOpen && (
        <ModalShell open title="Unlock requests" primaryLabel="Close" onPrimary={() => setReqOpen(false)} onClose={() => setReqOpen(false)}>
          {unlockReqs.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-n-500">No pending unlock requests.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {unlockReqs.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg border border-n-200 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="mono text-[13px] font-medium text-n-800">{r.transactionRef}</div>
                    <div className="text-[12px] text-n-500">Requested by {r.requestedBy}</div>
                  </div>
                  <button className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12.5px] font-semibold text-white hover:bg-primary-hover" onClick={() => decide.mutate({ id: r.id, grant: true })}>Grant</button>
                  <button className="inline-flex h-8 items-center rounded-md border border-n-200 px-3 text-[12.5px] font-semibold text-n-700 hover:bg-n-50" onClick={() => decide.mutate({ id: r.id, grant: false })}>Deny</button>
                </div>
              ))}
            </div>
          )}
        </ModalShell>
      )}
    </div>
  );
}

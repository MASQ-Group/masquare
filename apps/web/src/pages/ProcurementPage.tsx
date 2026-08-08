import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardList, Package, Search, ShoppingCart } from 'lucide-react';
import { DateRangePicker, DEFAULT_PAGE_SIZES, Pagination, Select, type DateRangeValue } from '@masquare/ui';
import { procurementApi, salesChannelsApi, type DemandRow, type StockStatus } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { usePersistentState } from '../lib/usePersistentState';
import { formatDate } from '../lib/format';
import { GenerateOrdersModal } from '../components/procurement/GenerateOrdersModal';

const STATUS_FILTER = [
  { value: 'all', label: 'All demand' },
  { value: 'needs_ordering', label: 'Needs ordering' },
  { value: 'partial', label: 'Partially available' },
  { value: 'in_stock', label: 'In stock' },
];

/** Matches the platform's status-chip pattern (§5 UI consistency). */
const STOCK_CHIP: Record<StockStatus, { label: string; cls: string }> = {
  in_stock: { label: 'In stock', cls: 'border-teal-300 bg-teal-50 text-teal-700' },
  partial: { label: 'Partially available', cls: 'border-warning-bd bg-warning-bg text-warning' },
  needs_ordering: { label: 'Needs ordering', cls: 'border-danger-bd bg-danger-bg text-danger' },
};

export function ProcurementPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [stockStatus, setStockStatus] = usePersistentState('procurement.status', 'needs_ordering');
  const [channelId, setChannelId] = usePersistentState('procurement.channel', '');
  const [range, setRange] = usePersistentState<DateRangeValue>('procurement.range', { from: '', to: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const params = {
    q: q || undefined, salesChannelId: channelId || undefined, stockStatus,
    from: range.from || undefined, to: range.to || undefined, page, pageSize,
  };
  const { data, isLoading } = useQuery({ queryKey: ['procurement-demand', params], queryFn: () => procurementApi.demand(params) });
  const rows = data?.rows ?? [];
  const summary = data?.summary;

  const selectedRows = useMemo(() => rows.filter((r) => selected[r.productId]), [rows, selected]);
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected[r.productId]);
  const toggleAll = (on: boolean) =>
    setSelected((s) => { const n = { ...s }; rows.forEach((r) => { n[r.productId] = on; }); return n; });

  return (
    <div className="w-full">
      <PageHeader
        module="Purchasing"
        title="Procurement"
        info="What your open orders need versus what's on hand. Select what's short and raise purchase orders in one go."
      />

      {/* Demand summary — click to filter */}
      {summary && (
        <div className="mb-4 grid grid-cols-3 gap-3.5 max-[760px]:grid-cols-1">
          <SummaryCard label="Needs ordering" value={summary.needsOrdering} sub="nothing on hand" icon={<AlertTriangle size={17} />} tone="danger"
            active={stockStatus === 'needs_ordering'} onClick={() => { setStockStatus('needs_ordering'); setPage(1); }} />
          <SummaryCard label="Partially available" value={summary.partial} sub="some stock, not enough" icon={<Package size={17} />} tone="warning"
            active={stockStatus === 'partial'} onClick={() => { setStockStatus('partial'); setPage(1); }} />
          <SummaryCard label="In stock" value={summary.inStock} sub="covered by availability" icon={<CheckCircle2 size={17} />} tone="teal"
            active={stockStatus === 'in_stock'} onClick={() => { setStockStatus('in_stock'); setPage(1); }} />
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
            <input className="input pl-8" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search SKU, product or vendor" />
          </div>
          <div className="w-[190px]">
            <Select value={stockStatus} onChange={(v) => { setStockStatus(v); setPage(1); }} options={STATUS_FILTER} />
          </div>
          <div className="w-[190px]">
            <Select value={channelId} onChange={(v) => { setChannelId(v); setPage(1); }} placeholder="All channels"
              options={[{ value: '', label: 'All channels' }, ...channels.map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
          <DateRangePicker value={range} onChange={(v) => { setRange(v); setPage(1); }} />
        </div>

        {selectedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-teal-200 bg-teal-50 px-4 py-2.5">
            <span className="text-[13.5px] font-semibold text-n-900">{selectedRows.length} product{selectedRows.length === 1 ? '' : 's'} selected</span>
            <div className="h-4 w-px bg-teal-200" />
            <button onClick={() => setGenerating(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-600">
              <ShoppingCart size={14} /> Generate purchase orders
            </button>
            <div className="flex-1" />
            <button className="inline-flex h-8 items-center px-2 text-[12.5px] font-semibold text-n-600 hover:text-n-900" onClick={() => setSelected({})}>Clear</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${TH} w-9`}>
                  <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={allOnPageSelected} onChange={(e) => toggleAll(e.target.checked)} title="Select all on this page" />
                </th>
                <th className={`${TH} text-left`}>Product</th>
                <th className={`${TH} text-left`}>Vendor</th>
                <th className={`${TH} text-left`}>Channels</th>
                <th className={`${TH} text-right`}>Required</th>
                <th className={`${TH} text-right`}>Available</th>
                <th className={`${TH} text-right`}>Short</th>
                <th className={`${TH} text-left`}>Stock</th>
                <th className={`${TH} text-right`}>Last cost</th>
                <th className={`${TH} text-left`}>Demand since</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={TD} colSpan={10}>Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr><td className={`${TD} py-10 text-center text-n-400`} colSpan={10}>
                  {stockStatus === 'needs_ordering'
                    ? 'Nothing needs ordering — every open order is covered by stock.'
                    : 'No demand matches these filters.'}
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.productId} className={`hover:bg-n-25 ${selected[r.productId] ? 'bg-teal-50/50' : ''}`}>
                  <td className={TD}>
                    <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={!!selected[r.productId]}
                      onChange={() => setSelected((s) => ({ ...s, [r.productId]: !s[r.productId] }))} />
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-2.5">
                      {r.imageUrl
                        ? <img src={r.imageUrl} alt="" className="h-8 w-8 shrink-0 rounded border border-n-200 object-cover" />
                        : <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-n-200 bg-n-50 text-n-300"><Package size={14} /></span>}
                      <div className="min-w-0">
                        <div className="code text-[12.5px] font-semibold text-n-800">{r.sku}</div>
                        <div className="max-w-[260px] truncate text-[11.5px] text-n-400" title={r.productName}>{r.productName}</div>
                      </div>
                    </div>
                  </td>
                  <td className={TD}>
                    {r.vendor
                      ? <span className="block max-w-[160px] truncate" title={r.vendor.name}>{r.vendor.name}</span>
                      : <span className="text-[11.5px] font-semibold text-warning">no vendor</span>}
                  </td>
                  <td className={TD}>
                    <span className="block max-w-[150px] truncate text-[12px] text-n-500" title={r.channels.map((c) => c.name).join(', ')}>
                      {r.channels.map((c) => c.name).join(', ') || '—'}
                    </span>
                  </td>
                  <td className={`${TD} mono text-right font-semibold text-n-800`} title={`${r.orderCount} open order line(s)`}>{r.requiredQuantity}</td>
                  <td className={`${TD} mono text-right`}>{r.availableQuantity}</td>
                  <td className={`${TD} mono text-right font-semibold ${r.shortfall > 0 ? 'text-danger' : 'text-n-300'}`}>{r.shortfall || '—'}</td>
                  <td className={TD}>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${STOCK_CHIP[r.stockStatus].cls}`}>
                      {STOCK_CHIP[r.stockStatus].label}
                    </span>
                  </td>
                  <td className={`${TD} mono text-right`}>{r.lastPurchaseCost != null ? `€${r.lastPurchaseCost.toFixed(2)}` : <span className="text-n-300">—</span>}</td>
                  <td className={`${TD} whitespace-nowrap text-n-500`}>{formatDate(r.firstSaleDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={data?.page ?? 1}
        pageCount={data?.pageCount ?? 1}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        pageSizeOptions={DEFAULT_PAGE_SIZES}
      />

      {generating && (
        <GenerateOrdersModal
          rows={selectedRows}
          onClose={() => setGenerating(false)}
          onGenerated={(created) => {
            setGenerating(false);
            setSelected({});
            qc.invalidateQueries({ queryKey: ['procurement-demand'] });
            qc.invalidateQueries({ queryKey: ['purchase-orders'] });
            if (created.length === 1) navigate(`/purchase-orders/${created[0].id}`);
            else navigate('/purchase-orders');
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, icon, tone, active, onClick }: {
  label: string; value: number; sub: string; icon: React.ReactNode;
  tone: 'teal' | 'warning' | 'danger'; active: boolean; onClick: () => void;
}) {
  const tint = tone === 'teal' ? 'bg-teal-50 text-teal-700' : tone === 'warning' ? 'bg-warning-bg text-warning' : 'bg-danger-bg text-danger';
  const num = tone === 'teal' ? 'text-n-900' : tone === 'warning' ? 'text-warning' : 'text-danger';
  return (
    <button onClick={onClick}
      className={`rounded-xl border bg-n-0 p-4 text-left transition-shadow ${active ? 'border-teal-400 ring-1 ring-teal-400' : 'border-n-200 hover:border-n-300'}`}>
      <div className="flex items-center gap-2.5">
        <span className={`grid h-[30px] w-[30px] place-items-center rounded-lg ${tint}`}>{icon}</span>
        <span className="text-[12px] font-semibold text-n-600">{label}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className={`text-[27px] font-bold tabular-nums tracking-tight ${num}`}>{value}</span>
        <span className="text-[12.5px] text-n-400">{sub}</span>
      </div>
    </button>
  );
}

const TH = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
const TD = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700 whitespace-nowrap';

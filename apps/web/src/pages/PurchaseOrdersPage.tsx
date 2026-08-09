import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockOpen, Plus, Search, Send } from 'lucide-react';
import { DateRangePicker, DEFAULT_PAGE_SIZES, ModalShell, Pagination, Select, type DateRangeValue } from '@masquare/ui';
import { purchaseOrdersApi, vendorsApi, type PurchaseOrderStatus } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { usePersistentState } from '../lib/usePersistentState';
import { formatDate } from '../lib/format';
import { toast } from 'sonner';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../components/ConfirmProvider';

const money = (v: number, ccy = 'EUR') => `${ccy === 'EUR' ? '€' : ccy + ' '}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'partially_received', label: 'Partially received' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];
const STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  draft: 'border-n-200 bg-n-50 text-n-600',
  submitted: 'border-info-bd bg-info-bg text-info',
  partially_received: 'border-warning-bd bg-warning-bg text-warning',
  received: 'border-teal-300 bg-teal-50 text-teal-700',
  cancelled: 'border-danger-bd bg-danger-bg text-danger',
};
const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', partially_received: 'Partially received', received: 'Received', cancelled: 'Cancelled',
};

export function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = usePersistentState('po.status', '');
  const [vendorId, setVendorId] = usePersistentState('po.vendor', '');
  const [range, setRange] = usePersistentState<DateRangeValue>('po.range', { from: '', to: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [reqOpen, setReqOpen] = useState(false);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isAdmin = !!useAuth().user?.isAdmin;

  // Admins poll for pending unlock requests — the platform has no push channel yet.
  const { data: unlockReqs = [] } = useQuery({
    queryKey: ['po-unlock-requests'],
    queryFn: () => purchaseOrdersApi.listUnlockRequests(),
    enabled: isAdmin,
    refetchInterval: isAdmin ? 15000 : false,
  });
  const decide = useMutation({
    mutationFn: ({ id, grant }: { id: string; grant: boolean }) => purchaseOrdersApi.decideUnlock(id, grant),
    onSuccess: (_r, v) => {
      toast.success(v.grant ? 'Unlocked — the order is a draft again' : 'Request denied');
      qc.invalidateQueries({ queryKey: ['po-unlock-requests'] });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['goods-receipts'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not apply the decision'),
  });

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });

  const params = {
    q: q || undefined,
    status: status || undefined,
    vendorId: vendorId || undefined,
    from: range.from || undefined,
    to: range.to || undefined,
    page,
    pageSize,
  };
  const { data, isLoading } = useQuery({ queryKey: ['purchase-orders', params], queryFn: () => purchaseOrdersApi.list(params) });
  const rows = data?.rows ?? [];

  // --- Multi-select + bulk submit -------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Drop the selection whenever the filter changes (but not on mere paging).
  const filterKey = `${q}|${status}|${vendorId}|${range.from}|${range.to}`;
  useEffect(() => { setSelected(new Set()); }, [filterKey]);

  const pageIds = rows.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleOne = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allOnPageSelected) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });

  const selectAllMatching = useMutation({
    mutationFn: () => purchaseOrdersApi.allIds({ q: q || undefined, status: status || undefined, vendorId: vendorId || undefined, from: range.from || undefined, to: range.to || undefined }),
    onSuccess: ({ ids }) => setSelected(new Set(ids)),
  });

  const bulkSubmit = useMutation({
    mutationFn: () => purchaseOrdersApi.bulkSubmit([...selected]),
    onSuccess: (res) => {
      const skipped = res.skipped.length;
      toast.success(
        skipped === 0
          ? `${res.submitted} purchase order${res.submitted === 1 ? '' : 's'} submitted`
          : `${res.submitted} submitted · ${skipped} skipped (only drafts can be submitted)`,
      );
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['goods-receipts'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not submit the selected orders'),
  });

  return (
    <div className="w-full">
      <PageHeader
        module="Purchasing"
        title="Purchase orders"
        info="Orders raised to your vendors. Draft, submit, then receive against them."
        actions={isAdmin ? (
          <button onClick={() => setReqOpen(true)} className="hbtn">
            <LockOpen size={15} className="opacity-70" /> Unlock requests
            {unlockReqs.length > 0 && (
              <span className="mono rounded-pill bg-orange-100 px-1.5 text-[11px] font-semibold text-orange-700">{unlockReqs.length}</span>
            )}
          </button>
        ) : undefined}
        primary={
          <button onClick={() => navigate('/purchase-orders/new')} className="hbtn-primary">
            <Plus size={15} /> New purchase order
          </button>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
            <input className="input pl-8" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search PO number or vendor" />
          </div>
          <div className="w-[190px]">
            <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS} />
          </div>
          <div className="w-[210px]">
            <Select
              value={vendorId}
              onChange={(v) => { setVendorId(v); setPage(1); }}
              placeholder="All vendors"
              options={[{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}
            />
          </div>
          <DateRangePicker value={range} onChange={(v) => { setRange(v); setPage(1); }} />
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-teal-200 bg-teal-50 px-4 py-2.5 text-[13px]">
            <span className="font-semibold text-teal-800">{selected.size} selected</span>
            {data && data.total > pageIds.length && (
              <button
                className="font-medium text-teal-700 underline-offset-2 hover:underline disabled:opacity-50"
                disabled={selectAllMatching.isPending}
                onClick={() => selectAllMatching.mutate()}
              >
                Select all {data.total} matching
              </button>
            )}
            <button className="font-medium text-n-500 hover:text-n-700" onClick={() => setSelected(new Set())}>Clear</button>
            <div className="ml-auto flex items-center gap-2">
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
                disabled={bulkSubmit.isPending}
                onClick={async () => { if (await confirm({ title: `Submit ${selected.size} purchase order${selected.size === 1 ? '' : 's'}?`, message: 'Each draft is locked and gets a goods receipt. Non-drafts are skipped.', confirmLabel: 'Submit' })) bulkSubmit.mutate(); }}
              >
                <Send size={14} /> {bulkSubmit.isPending ? 'Submitting…' : 'Submit selected'}
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto max-[767px]:hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${TH} w-[36px] text-center`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--teal-500)] align-middle"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    aria-label="Select all on this page"
                  />
                </th>
                <th className={`${TH} text-left`}>PO number</th>
                <th className={`${TH} text-left`}>Status</th>
                <th className={`${TH} text-left`}>Vendor</th>
                <th className={`${TH} text-left`}>Expected</th>
                <th className={`${TH} text-right`}>Lines</th>
                <th className={`${TH} text-right`}>Qty</th>
                <th className={`${TH} text-right`}>Total</th>
                <th className={`${TH} text-left`}>Created</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={TD} colSpan={9}>Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr><td className={`${TD} py-10 text-center text-n-400`} colSpan={9}>No purchase orders yet. Create one to get started.</td></tr>
              )}
              {rows.map((po) => (
                <tr key={po.id} className={`cursor-pointer hover:bg-n-25 ${selected.has(po.id) ? 'bg-teal-50/60' : ''}`} onClick={() => navigate(`/purchase-orders/${po.id}`)}>
                  <td className={`${TD} text-center`} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--teal-500)] align-middle"
                      checked={selected.has(po.id)}
                      onChange={() => toggleOne(po.id)}
                      aria-label={`Select ${po.poNumber}`}
                    />
                  </td>
                  <td className={`${TD} code font-semibold text-n-800`}>{po.poNumber}</td>
                  <td className={TD}>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${STATUS_STYLE[po.status]}`}>
                      {STATUS_LABEL[po.status]}
                    </span>
                  </td>
                  <td className={TD}>{po.vendor.name}</td>
                  <td className={`${TD} whitespace-nowrap`}>{po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : <span className="text-n-300">—</span>}</td>
                  <td className={`${TD} mono text-right`}>{po.lineCount}</td>
                  <td className={`${TD} mono text-right`}>{po.totalQuantity}</td>
                  <td className={`${TD} mono text-right font-semibold text-n-800`}>{money(po.total, po.currency)}</td>
                  <td className={`${TD} whitespace-nowrap text-n-500`}>{formatDate(po.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: card list (guide Principle 3 — no horizontal scroll). */}
        <div className="hidden flex-col gap-2 p-3 max-[767px]:flex">
          {isLoading && <div className="py-8 text-center text-[13px] text-n-500">Loading…</div>}
          {!isLoading && rows.length === 0 && <div className="py-10 text-center text-[13px] text-n-500">No purchase orders yet.</div>}
          {rows.map((po) => (
            <div key={po.id} onClick={() => navigate(`/purchase-orders/${po.id}`)} className={`flex cursor-pointer flex-col gap-1.5 rounded-[10px] border border-n-200 p-3 ${selected.has(po.id) ? 'bg-teal-50/60' : ''}`}>
              <div className="flex items-center gap-2">
                <input type="checkbox" onClick={(e) => e.stopPropagation()} className="h-4 w-4 shrink-0 accent-[var(--teal-500)]" checked={selected.has(po.id)} onChange={() => toggleOne(po.id)} aria-label={`Select ${po.poNumber}`} />
                <span className="code min-w-0 flex-1 truncate text-[12.5px] font-semibold text-n-800">{po.poNumber}</span>
                <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[po.status]}`}>{STATUS_LABEL[po.status]}</span>
              </div>
              <div className="truncate text-[13px] text-n-700">{po.vendor.name}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-n-500">
                <span>{po.lineCount} lines · {po.totalQuantity} u</span>
                <span className="mono font-semibold text-n-800">{money(po.total, po.currency)}</span>
                {po.expectedDeliveryDate && <span>Exp {formatDate(po.expectedDeliveryDate)}</span>}
              </div>
            </div>
          ))}
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

      {reqOpen && (
        <ModalShell open title="Unlock Requests" primaryLabel="Close" onPrimary={() => setReqOpen(false)} onClose={() => setReqOpen(false)}>
          {unlockReqs.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-n-500">No pending unlock requests.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {unlockReqs.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg border border-n-200 p-3">
                  <div className="min-w-0 flex-1">
                    <button className="code text-[13px] font-medium text-n-800 hover:text-teal-700" onClick={() => navigate(`/purchase-orders/${r.purchaseOrderId}`)}>
                      {r.poNumber}
                    </button>
                    <div className="text-[12px] text-n-500">
                      Requested by {r.requestedBy} · {formatDate(r.createdAt)}
                    </div>
                    {r.reason && <div className="mt-0.5 text-[12px] text-n-600">“{r.reason}”</div>}
                  </div>
                  <button
                    className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: r.id, grant: true })}
                  >
                    Grant
                  </button>
                  <button
                    className="inline-flex h-8 items-center rounded-md border border-n-200 px-3 text-[12.5px] font-semibold text-n-700 hover:bg-n-50 disabled:opacity-50"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: r.id, grant: false })}
                  >
                    Deny
                  </button>
                </div>
              ))}
            </div>
          )}
        </ModalShell>
      )}
    </div>
  );
}

const TH = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
const TD = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

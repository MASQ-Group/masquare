import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Coins, Package, Pencil, Search, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { fbaShipmentsApi, salesChannelsApi, shipmentsApi, type FbaShipment, type PendingShipment, type Shipment } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import { ShipmentModal } from '../components/shipments/ShipmentModal';
import { FbaActualCostModal } from '../components/fba-shipments/FbaActualCostModal';

type Tab = 'pending' | 'all' | 'fba';

const eur = (v: number | null | undefined) => (v != null ? `€${v.toFixed(2)}` : '—');

interface ModalCtx {
  transactionId: string;
  transactionRef: string;
  contextLine?: string;
  defaultServiceId?: string | null;
  shipment?: Shipment;
}

export function ShipmentsPage() {
  const qc = useQueryClient();
  const { activeCompanyId } = useAuth();
  const [tab, setTab] = useState<Tab>('pending');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [filterChannel, setFilterChannel] = useState('');
  const [filterType, setFilterType] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<ModalCtx | null>(null);
  const [fbaActualFor, setFbaActualFor] = useState<FbaShipment | null>(null);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);
  useEffect(() => { setPage(1); }, [tab]);

  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });

  const commonParams = { q: q || undefined, companyId: activeCompanyId || undefined, salesChannelId: filterChannel || undefined, page, pageSize: 50 };
  const pendingQ = useQuery({
    queryKey: ['shipments-pending', commonParams], queryFn: () => shipmentsApi.pending(commonParams), enabled: tab === 'pending',
  });
  const allQ = useQuery({
    queryKey: ['shipments-all', { ...commonParams, type: filterType }], queryFn: () => shipmentsApi.list({ ...commonParams, type: filterType || undefined }), enabled: tab === 'all',
  });
  const fbaParams = { q: q || undefined, salesChannelId: filterChannel || undefined, page, pageSize: 50 };
  const fbaQ = useQuery({
    queryKey: ['fba-shipments', fbaParams], queryFn: () => fbaShipmentsApi.list(fbaParams), enabled: tab === 'fba',
  });

  const del = useMutation({
    mutationFn: (id: string) => shipmentsApi.remove(id),
    onSuccess: () => { toast.success('Shipment removed'); invalidate(); },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['shipments-pending'] });
    qc.invalidateQueries({ queryKey: ['shipments-all'] });
    qc.invalidateQueries({ queryKey: ['sales-transactions'] });
    qc.invalidateQueries({ queryKey: ['fba-shipments'] });
  };

  const data = tab === 'pending' ? pendingQ.data : tab === 'all' ? allQ.data : fbaQ.data;
  const isLoading = tab === 'pending' ? pendingQ.isLoading : tab === 'all' ? allQ.isLoading : fbaQ.isLoading;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 50));

  const ctxLine = (row: { salesChannel?: { name: string } | null; company?: { officialName: string } | null; destinationCountry?: { name: string } | null }) =>
    [row.salesChannel?.name, row.company?.officialName, row.destinationCountry?.name].filter(Boolean).join(' · ');

  const openForPending = (row: PendingShipment) =>
    setModal({ transactionId: row.id, transactionRef: row.transactionRef, contextLine: ctxLine(row), defaultServiceId: row.defaultShippingService?.id ?? null });
  const openForEdit = (s: Shipment) =>
    setModal({ transactionId: s.transactionId, transactionRef: s.transactionRef ?? '', contextLine: ctxLine(s), shipment: s });
  const openAddFor = (s: Shipment) =>
    setModal({ transactionId: s.transactionId, transactionRef: s.transactionRef ?? '', contextLine: ctxLine(s) });

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  const pendingRows = useMemo(() => (tab === 'pending' ? (pendingQ.data?.items ?? []) : []), [tab, pendingQ.data]);
  const allRows = useMemo(() => (tab === 'all' ? (allQ.data?.items ?? []) : []), [tab, allQ.data]);
  const fbaRows = useMemo(() => (tab === 'fba' ? (fbaQ.data?.items ?? []) : []), [tab, fbaQ.data]);

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex-1">
          <div className="eyebrow mb-1.5">Operations</div>
          <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Shipments</h1>
          <p className="mt-1 text-[13.5px] text-n-500">Record actual shipping cost and duty per transaction. Actuals replace the calculated shipping estimate and update profit.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-n-200">
        {([['pending', 'Pending fulfilment'], ['all', 'All shipments'], ['fba', 'FBA shipments']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`relative whitespace-nowrap px-4 py-2.5 text-[14px] font-medium transition-colors ${
              tab === key
                ? 'text-teal-700 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-teal-500'
                : 'text-n-500 hover:text-n-800'
            }`}
          >
            {label}
            {key === 'pending' && (pendingQ.data?.total ?? 0) > 0 && (
              <span className="ml-2 rounded-pill bg-orange-100 px-1.5 text-[11px] font-semibold text-orange-700">{pendingQ.data?.total}</span>
            )}
          </button>
        ))}
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
        {tab === 'all' && (
          <select className="h-[38px] rounded-md border border-n-200 bg-n-0 px-2 text-[13px] text-n-700" value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </select>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          {tab === 'pending' ? (
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr>
                  <th className={`${th} text-left`}>Order date</th>
                  <th className={`${th} text-left`}>Transaction ID</th>
                  <th className={`${th} text-left`}>Sales channel</th>
                  <th className={`${th} text-left`}>Company</th>
                  <th className={`${th} text-left`}>Destination</th>
                  <th className={`${th} text-left`}>SKUs</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className="border-b border-n-200 bg-n-25" />
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={8} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
                {!isLoading && pendingRows.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-[13px] text-n-500">Nothing pending — every transaction has been shipped. 🎉</td></tr>}
                {pendingRows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-teal-50" onClick={() => openForPending(r)}>
                    <td className={`${td} mono`}>{formatDate(r.date)}</td>
                    <td className={td}><span className="font-medium text-n-800">{r.transactionRef}</span></td>
                    <td className={td}>{r.salesChannel?.name ?? '—'}</td>
                    <td className={td}>{r.company?.officialName ?? '—'}</td>
                    <td className={td}>{r.destinationCountry?.name ?? '—'}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {r.skus.slice(0, 3).map((s, i) => <span key={i} className="mono rounded bg-n-100 px-1.5 py-0.5 text-[11px] text-n-600">{s}</span>)}
                        {r.itemCount > 3 && <span className="text-[11px] text-n-400">+{r.itemCount - 3}</span>}
                      </div>
                    </td>
                    <td className={`${td} mono text-right`}>{r.quantity}</td>
                    <td className="border-b border-n-100 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <button className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-white hover:bg-primary-hover" onClick={() => openForPending(r)}>
                        <Truck size={14} /> Record shipment
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === 'all' ? (
            <table className="w-full min-w-[1000px] border-collapse">
              <thead>
                <tr>
                  <th className={`${th} text-left`}>Ship date</th>
                  <th className={`${th} text-left`}>Transaction ID</th>
                  <th className={`${th} text-left`}>Channel</th>
                  <th className={`${th} text-left`}>Type</th>
                  <th className={`${th} text-left`}>Service</th>
                  <th className={`${th} text-left`}>Tracking</th>
                  <th className={`${th} text-right`}>Cost (€)</th>
                  <th className={`${th} text-left`}>Borne by</th>
                  <th className={`${th} text-right`}>Duty (€)</th>
                  <th className={`${th} text-left`}>Comments</th>
                  <th className="border-b border-n-200 bg-n-25" />
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={11} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
                {!isLoading && allRows.length === 0 && <tr><td colSpan={11} className="px-4 py-12 text-center text-[13px] text-n-500">No shipments recorded yet.</td></tr>}
                {allRows.map((s) => (
                  <tr key={s.id} className="hover:bg-teal-50/50">
                    <td className={`${td} mono`}>{formatDate(s.shipmentDate)}</td>
                    <td className={td}><span className="font-medium text-n-800">{s.transactionRef}</span></td>
                    <td className={td}>{s.salesChannel?.name ?? '—'}</td>
                    <td className={td}>
                      {s.type === 'outbound'
                        ? <span className="tag border border-teal-100 bg-teal-50 text-teal-700">Outbound</span>
                        : <span className="tag border border-orange-100 bg-orange-50 text-orange-700">Inbound</span>}
                    </td>
                    <td className={td}>{s.shippingService?.name ?? '—'}</td>
                    <td className={`${td} mono`}>{s.trackingNumber ?? '—'}</td>
                    <td className={`${td} mono text-right`}>{eur(s.shippingCostEur)}</td>
                    <td className={td}>{s.costBorneBy === 'company' ? 'Company' : 'Customer'}</td>
                    <td className={`${td} mono text-right`}>{s.dutyImportEur != null && s.dutyImportEur !== 0 ? eur(s.dutyImportEur) : '—'}</td>
                    <td className={`${td} max-w-[220px] truncate`} title={s.comments ?? undefined}>{s.comments ?? '—'}</td>
                    <td className="border-b border-n-100 px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" title="Add another shipment for this transaction" onClick={() => openAddFor(s)}><Package size={15} /></button>
                        <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" title="Edit" onClick={() => openForEdit(s)}><Pencil size={15} /></button>
                        <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" title="Remove" onClick={() => confirm(`Remove this shipment for ${s.transactionRef}?`) && del.mutate(s.id)}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[1000px] border-collapse">
              <thead>
                <tr>
                  <th className={`${th} text-left`}>Date</th>
                  <th className={`${th} text-left`}>FBA ID</th>
                  <th className={`${th} text-left`}>Channel</th>
                  <th className={`${th} text-left`}>Destination</th>
                  <th className={`${th} text-left`}>Service</th>
                  <th className={`${th} text-right`}>Est. cost</th>
                  <th className={`${th} text-right`}>Actual cost</th>
                  <th className={`${th} text-left`}>Status</th>
                  <th className="border-b border-n-200 bg-n-25" />
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={9} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
                {!isLoading && fbaRows.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-[13px] text-n-500">No FBA shipments. Create them in the FBA Shipments module.</td></tr>}
                {fbaRows.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-teal-50" onClick={() => setFbaActualFor(s)}>
                    <td className={`${td} mono`}>{formatDate(s.date)}</td>
                    <td className={td}><span className="mono font-medium text-n-800">{s.fbaShipmentRef ?? '—'}</span></td>
                    <td className={td}>{s.salesChannel?.name ?? '—'}</td>
                    <td className={td}>{s.destinationCountry?.name ?? '—'}</td>
                    <td className={td}>{s.shippingService?.name ?? '—'}{s.shippingZone ? <span className="text-n-400"> · {s.shippingZone.name}</span> : ''}</td>
                    <td className={`${td} mono text-right`}>{eur(s.estimatedCostEur)}</td>
                    <td className={`${td} mono text-right ${s.actualCostEur != null ? 'font-semibold text-n-900' : 'text-n-400'}`}>{eur(s.actualCostEur)}</td>
                    <td className={td}>
                      {s.status === 'confirmed'
                        ? <span className="tag border border-teal-100 bg-teal-50 text-teal-700">Confirmed</span>
                        : <span className="tag border border-n-200 bg-n-100 text-n-600">Draft</span>}
                    </td>
                    <td className="border-b border-n-100 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <button className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-white hover:bg-primary-hover" onClick={() => setFbaActualFor(s)}>
                        <Coins size={14} /> {s.actualCostEur != null ? 'Edit actual cost' : 'Enter actual cost'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[13px] text-n-500">
          {tab === 'pending' ? 'Awaiting shipment' : tab === 'all' ? 'Recorded shipments' : 'FBA shipments'}: <span className="mono">{total}</span>
        </span>
        <div className="flex gap-1">
          <button disabled={page <= 1} className="mono grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-[13px] text-n-600 disabled:opacity-40" onClick={() => setPage((p) => p - 1)}>‹</button>
          <span className="mono grid h-8 min-w-8 place-items-center px-2 text-[13px] text-n-600">{page} / {pageCount}</span>
          <button disabled={page >= pageCount} className="mono grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-[13px] text-n-600 disabled:opacity-40" onClick={() => setPage((p) => p + 1)}>›</button>
        </div>
      </div>

      {tab === 'pending' && pendingRows.length > 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-n-400">
          <ArrowRight size={13} /> Click a row to record its shipment. Uncheck “fully shipped” if an order ships in parts.
        </p>
      )}
      {tab === 'fba' && fbaRows.length > 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-n-400">
          <ArrowRight size={13} /> Enter the actual FBA shipping cost here — it updates the shipment's Actual Cost in the FBA Shipments module and re-allocates the per-SKU cost.
        </p>
      )}

      {modal && (
        <ShipmentModal
          transactionId={modal.transactionId}
          transactionRef={modal.transactionRef}
          contextLine={modal.contextLine}
          defaultServiceId={modal.defaultServiceId}
          shipment={modal.shipment}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); invalidate(); }}
        />
      )}
      {fbaActualFor && (
        <FbaActualCostModal
          shipment={fbaActualFor}
          contextLine="via Shipments module"
          onClose={() => setFbaActualFor(null)}
          onSaved={() => { setFbaActualFor(null); invalidate(); }}
        />
      )}
    </div>
  );
}

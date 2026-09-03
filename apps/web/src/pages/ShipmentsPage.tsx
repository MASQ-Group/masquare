import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUp, Coins, Download, ExternalLink, Package, PackageCheck, PackagePlus, Pencil, Search, Trash2, Truck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { downloadSheet, Pagination, Select } from '@masquare/ui';
import { countriesApi, fbaShipmentsApi, salesChannelsApi, shipmentsApi, type FbaShipment, type PendingShipment, type Shipment } from '../lib/api';
import { CountryTag } from '../components/common/Flag';
import { ChannelChip, useChannelChips } from '../components/common/ChannelChip';
import { useAuth } from '../lib/auth';
import { usePersistentState } from '../lib/usePersistentState';
import { formatDate } from '../lib/format';
import { ShipmentModal } from '../components/shipments/ShipmentModal';
import { CombineShipmentModal } from '../components/shipments/CombineShipmentModal';
import { ShipmentImportModal } from '../components/shipments/ShipmentImportModal';
import { SHIPMENT_HEADER, shipmentRowToCells } from '../components/shipments/shipmentColumns';
import { FbaActualCostModal } from '../components/fba-shipments/FbaActualCostModal';
import { PageHeader } from '../components/common/PageHeader';

type Tab = 'pending' | 'dispatched' | 'all' | 'fba';

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
  const [storedTab, setTab] = usePersistentState<Tab>('shipments.tab', 'pending');
  // 'despatched' was persisted by an earlier build under the old spelling. Restoring a key no
  // branch matches renders an empty page with no tab selected, so an unknown value falls back
  // rather than being trusted.
  const tab: Tab = (['pending', 'dispatched', 'all', 'fba'] as const).includes(storedTab as any) ? storedTab : 'pending';
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [filterChannel, setFilterChannel] = usePersistentState('shipments.filterChannel', '');
  const [filterType, setFilterType] = usePersistentState('shipments.filterType', '');
  // Pending tab: All / Local (our own delivery/pickup) / Channel (marketplace).
  const [pendingKind, setPendingKind] = usePersistentState<'' | 'local' | 'channel'>('shipments.pendingKind', '');
  // Date sort per tab. Pending defaults to oldest first (longest outstanding at the top);
  // the logs default to newest first.
  const [pendingSort, setPendingSort] = usePersistentState<'asc' | 'desc'>('shipments.pendingSort', 'asc');
  const [allSort, setAllSort] = usePersistentState<'asc' | 'desc'>('shipments.allSort', 'desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalCtx | null>(null);
  const [combineOpen, setCombineOpen] = useState(false);
  const [fbaActualFor, setFbaActualFor] = useState<FbaShipment | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Export the current tab's shipments: recorded shipments (All), or a fill-in template
  // of transactions awaiting an outbound shipment (Pending).
  const onExport = async () => {
    const scope = tab === 'pending' ? 'pending' : 'recorded';
    setExporting(true);
    try {
      const rows = await shipmentsApi.export({
        scope,
        q: q || undefined,
        companyId: activeCompanyId || undefined,
        salesChannelId: filterChannel || undefined,
        type: tab === 'all' && filterType ? filterType : undefined,
        channelKind: scope === 'pending' ? (pendingKind || undefined) : undefined,
      });
      if (rows.length === 0) { toast.info(scope === 'pending' ? 'Nothing pending to export' : 'No recorded shipments to export'); return; }
      downloadSheet(`masquare-shipments-${scope}`, [SHIPMENT_HEADER, ...rows.map(shipmentRowToCells)], 'xlsx');
      toast.success(`Exported ${rows.length} ${scope === 'pending' ? 'pending transactions' : 'shipments'}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Export failed');
    } finally { setExporting(false); }
  };

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);
  useEffect(() => { setPage(1); }, [tab]);

  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const { data: allCountries = [] } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });
  // Destination objects here carry no ISO, so resolve country flags from the reference list.
  const countryIso = useMemo(() => new Map(allCountries.map((c) => [c.id, c.isoCode])), [allCountries]);
  const chipFor = useChannelChips();
  const channelCell = (ch?: { id: string; name: string } | null) => <ChannelChip name={ch?.name} {...chipFor(ch?.id)} />;
  const countryCell = (co?: { id: string; name: string } | null) => (co ? <CountryTag code={countryIso.get(co.id)} name={co.name} /> : '—');

  const commonParams = { q: q || undefined, companyId: activeCompanyId || undefined, salesChannelId: filterChannel || undefined, page, pageSize };
  const pendingParams = { ...commonParams, channelKind: pendingKind || undefined, sortDir: pendingSort };
  const pendingQ = useQuery({
    queryKey: ['shipments-pending', pendingParams], queryFn: () => shipmentsApi.pending(pendingParams), enabled: tab === 'pending',
  });
  // Same params and same row shape as pending — it is the same query with one clause flipped.
  const dispatchedQ = useQuery({
    queryKey: ['shipments-dispatched', pendingParams],
    queryFn: () => shipmentsApi.dispatchedElsewhere(pendingParams),
    enabled: tab === 'dispatched',
  });
  const allParams = { ...commonParams, type: filterType || undefined, sortDir: allSort, includeFba: true };
  const allQ = useQuery({
    queryKey: ['shipments-all', allParams], queryFn: () => shipmentsApi.list(allParams), enabled: tab === 'all',
  });
  // A worklist, not a log: once the actual cost is registered and the shipment confirmed, it is
  // settled and moves to All shipments. Draft is exactly that set, since confirming now requires
  // a cost.
  const fbaParams = { q: q || undefined, salesChannelId: filterChannel || undefined, status: 'draft', sortDir: allSort, page, pageSize };
  const fbaQ = useQuery({
    queryKey: ['fba-shipments', fbaParams], queryFn: () => fbaShipmentsApi.list(fbaParams),
  });

  const del = useMutation({
    mutationFn: ({ id }: { id: string; type: string }) => shipmentsApi.remove(id),
    // Only an OUTBOUND removal sends the order back to the worklist — say what actually happened.
    onSuccess: (_r, v) => {
      toast.success(v.type === 'outbound' ? 'Shipment cancelled — order back in Pending fulfilment' : 'Shipment removed');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not cancel shipment'),
  });

  // Local sales carry no carrier/tracking/weight — fulfilling records a marker shipment,
  // which is what marks the order shipped everywhere (an outbound shipment is the source of truth).
  const fulfilLocal = useMutation({
    mutationFn: (transactionId: string) => shipmentsApi.fulfilLocal(transactionId),
    onSuccess: () => { toast.success('Marked as fulfilled'); setSelected(new Set()); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not update'),
  });
  // A part-shipped order whose last parcel is already recorded just needs closing off — no
  // extra shipment to invent. The existing shipments (and their costs) stay untouched.
  const markComplete = useMutation({
    mutationFn: (transactionId: string) => shipmentsApi.setFulfilment(transactionId, 'shipped'),
    onSuccess: () => { toast.success('Marked fully shipped'); setSelected(new Set()); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not update'),
  });
  // Closes the books on orders the channel shipped. Deliberately does NOT create a shipment:
  // a fabricated carrier, date and cost would look authoritative while being nobody's
  // measurement, and profit already falls back to the estimate honestly.
  const acceptDispatch = useMutation({
    mutationFn: (ids: string[]) => shipmentsApi.acceptChannelDispatch(ids),
    onSuccess: (r) => {
      toast.success(`${r.closed} order${r.closed === 1 ? '' : 's'} closed at the estimated cost${r.skipped ? `, ${r.skipped} skipped` : ''}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['shipments-dispatched'] });
      qc.invalidateQueries({ queryKey: ['shipments-pending'] });
    },
    onError: () => toast.error('Could not close those orders'),
  });

  const bulkFulfil = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await shipmentsApi.fulfilLocal(id); return ids.length; },
    onSuccess: (n) => { toast.success(`Marked ${n} as fulfilled`); setSelected(new Set()); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Bulk fulfil failed'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['shipments-pending'] });
    qc.invalidateQueries({ queryKey: ['shipments-all'] });
    qc.invalidateQueries({ queryKey: ['sales-transactions'] });
    qc.invalidateQueries({ queryKey: ['fba-shipments'] });
  };

  const data = tab === 'pending' ? pendingQ.data : tab === 'dispatched' ? dispatchedQ.data : tab === 'all' ? allQ.data : fbaQ.data;
  const isLoading = tab === 'pending' ? pendingQ.isLoading : tab === 'dispatched' ? dispatchedQ.isLoading : tab === 'all' ? allQ.isLoading : fbaQ.isLoading;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const ctxLine = (row: { salesChannel?: { name: string } | null; company?: { officialName: string } | null; destinationCountry?: { name: string } | null }) =>
    [row.salesChannel?.name, row.company?.officialName, row.destinationCountry?.name].filter(Boolean).join(' · ');

  const openForPending = (row: PendingShipment) =>
    setModal({ transactionId: row.id, transactionRef: row.transactionRef, contextLine: ctxLine(row), defaultServiceId: row.defaultShippingService?.id ?? null });
  const openForEdit = (s: Shipment) =>
    setModal({ transactionId: s.transactionId, transactionRef: s.transactionRef ?? '', contextLine: ctxLine(s), shipment: s });
  const openAddFor = (s: Shipment) =>
    setModal({ transactionId: s.transactionId, transactionRef: s.transactionRef ?? '', contextLine: ctxLine(s) });

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  /** A clickable date header that toggles the sort direction. */
  const SortableDate = ({ label, dir, onToggle }: { label: string; dir: 'asc' | 'desc'; onToggle: () => void }) => (
    <th className={`${th} text-left`}>
      <button type="button" className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-n-800" onClick={onToggle} title={`Sort ${dir === 'asc' ? 'newest' : 'oldest'} first`}>
        {label}
        {dir === 'asc' ? <ArrowUp size={12} className="text-teal-600" /> : <ArrowDown size={12} className="text-teal-600" />}
      </button>
    </th>
  );
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  // Both tabs render through the same table: the rows are identical, and on the dispatched tab
  // clicking one still records a shipment — capturing the real cost is one of the two valid
  // answers there, the other being to accept the estimate in bulk.
  const pendingRows = useMemo(
    () => (tab === 'pending' ? (pendingQ.data?.items ?? []) : tab === 'dispatched' ? (dispatchedQ.data?.items ?? []) : []),
    [tab, pendingQ.data, dispatchedQ.data],
  );
  const fulfilLabel = (r: PendingShipment) => (r.deliveryMethod === 'pickup' ? 'Mark picked up' : 'Mark delivered');
  const localRows = useMemo(() => pendingRows.filter((r) => r.isLocal), [pendingRows]);
  const selectedLocalIds = useMemo(() => localRows.filter((r) => selected.has(r.id)).map((r) => r.id), [localRows, selected]);
  const selectedChannelOrders = useMemo(() => pendingRows.filter((r) => !r.isLocal && selected.has(r.id)), [pendingRows, selected]);
  const selectedChannelCount = selectedChannelOrders.length;
  // Clear stale selections when the visible rows change (page/filter switch).
  useEffect(() => { setSelected(new Set()); }, [pendingKind, page, q]);
  const allRows = useMemo(() => (tab === 'all' ? (allQ.data?.items ?? []) : []), [tab, allQ.data]);
  const fbaRows = useMemo(() => (tab === 'fba' ? (fbaQ.data?.items ?? []) : []), [tab, fbaQ.data]);

  return (
    <div className="w-full">
      <PageHeader
        module="Sales"
        title="Shipments"
        info="Record actual shipping cost and duty per transaction. Actuals replace the calculated shipping estimate and update profit."
        tabs={[
          { key: 'pending', label: 'Pending fulfilment', count: (pendingQ.data?.total ?? 0) > 0 ? pendingQ.data?.total : undefined, attention: true },
          { key: 'dispatched', label: 'Dispatched elsewhere', count: (dispatchedQ.data?.total ?? 0) > 0 ? dispatchedQ.data?.total : undefined },
          { key: 'fba', label: 'FBA shipments', count: (fbaQ.data?.total ?? 0) > 0 ? fbaQ.data?.total : undefined, attention: true },
          { key: 'all', label: 'All shipments' },
        ]}
        activeTab={tab}
        // Paging already resets via the effect on `tab`; this clears the selection, which did not.
        // The bulk actions differ per tab — accept-at-estimate on one, combine on another — so a
        // selection carried across is a way to act on rows you are no longer looking at.
        onTabChange={(k) => { setTab(k as Tab); setSelected(new Set()); }}
        // Export is hidden on the dispatched tab: its only scopes are the shipments log and the
        // pending template, and neither describes these orders. A wrong export is worse than none.
        actions={tab !== 'fba' && tab !== 'dispatched' ? (
          <>
            <button className="hbtn" disabled={exporting} onClick={onExport}><Download size={15} className="text-n-500" /> {exporting ? 'Exporting…' : 'Export'}</button>
            <button className="hbtn" onClick={() => setImportOpen(true)}><Upload size={15} className="text-n-500" /> Import</button>
          </>
        ) : undefined}
        toolbar={
          <>
            <div className="flex h-8 flex-[0_1_300px] items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-2.5 focus-within:border-teal-400">
              <Search size={15} className="text-n-400" />
              <input className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none" placeholder="Search transaction ID or SKU…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
            </div>
            <Select dense className="w-40" value={filterChannel} onChange={(v) => { setFilterChannel(v); setPage(1); }} options={[{ value: '', label: 'All channels' }, ...channels.map((c) => ({ value: c.id, label: c.name }))]} />
            {tab === 'all' && (
              <Select dense className="w-36" value={filterType} onChange={(v) => { setFilterType(v); setPage(1); }} options={[{ value: '', label: 'All types' }, { value: 'outbound', label: 'Outbound' }, { value: 'inbound', label: 'Inbound' }, { value: 'fba', label: 'FBA inbound' }]} />
            )}
            {(tab === 'pending' || tab === 'dispatched') && (
              <Select dense className="w-36" value={pendingKind} onChange={(v) => { setPendingKind(v as '' | 'local' | 'channel'); setPage(1); }} options={[{ value: '', label: 'All sources' }, { value: 'local', label: 'Local only' }, { value: 'channel', label: 'Channel only' }]} />
            )}
            {tab === 'dispatched' && selected.size > 0 && (
              <>
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                  disabled={acceptDispatch.isPending}
                  onClick={() => acceptDispatch.mutate([...selected])}
                  title="Marks them fulfilled at the estimated shipping cost. No shipment is invented — there is no carrier, date or actual cost to record."
                >
                  <Truck size={15} /> Accept {selected.size} at estimated cost
                </button>
                <button className="text-[12.5px] font-medium text-teal-700 hover:underline" onClick={() => setSelected(new Set())}>Clear</button>
              </>
            )}
            {tab === 'pending' && selected.size > 0 && (
              <>
                {selectedLocalIds.length > 0 && (
                  <button className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50" disabled={bulkFulfil.isPending} onClick={() => bulkFulfil.mutate(selectedLocalIds)}><Truck size={15} /> Mark {selectedLocalIds.length} fulfilled</button>
                )}
                {selectedChannelCount >= 2 && (
                  <button className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-white hover:bg-primary-hover" onClick={() => setCombineOpen(true)}><PackagePlus size={15} /> Combine {selectedChannelCount} into one shipment</button>
                )}
                {selectedChannelCount === 1 && (
                  <span className="text-[12.5px] text-n-500">1 channel order selected — record a shipment for it individually, or select another to combine.</span>
                )}
                <button className="text-[12.5px] font-medium text-teal-700 hover:underline" onClick={() => setSelected(new Set())}>Clear</button>
              </>
            )}
          </>
        }
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          {/* Both tabs are order worklists with identical rows, so both render this table. Gating
              it on 'pending' alone left the dispatched tab falling through to the shipments table
              below, which reads a different row set entirely — so the count came from the right
              query while the table showed none of it. */}
          {tab === 'pending' || tab === 'dispatched' ? (
            <table className="w-full min-w-[1000px] border-collapse">
              <thead>
                <tr>
                  <th className={`${th} w-8 text-center`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--teal-500)] align-middle"
                      title="Select all on this page"
                      checked={pendingRows.length > 0 && selected.size === pendingRows.length}
                      ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < pendingRows.length; }}
                      onChange={(e) => setSelected(e.target.checked ? new Set(pendingRows.map((r) => r.id)) : new Set())}
                    />
                  </th>
                  <SortableDate label="Order date" dir={pendingSort} onToggle={() => { setPendingSort(pendingSort === 'asc' ? 'desc' : 'asc'); setPage(1); }} />
                  <th className={`${th} text-left`}>Transaction ID</th>
                  <th className={`${th} text-left`}>Sales channel</th>
                  <th className={`${th} text-left`}>Delivery</th>
                  <th className={`${th} text-left`}>Company</th>
                  <th className={`${th} text-left`}>Destination</th>
                  <th className={`${th} text-left`}>SKUs</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className="border-b border-n-200 bg-n-25" />
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={10} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
                {!isLoading && pendingRows.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-[13px] text-n-500">
                    {tab === 'dispatched'
                      ? 'Nothing here — every order the channels shipped has a shipment recorded against it.'
                      : 'Nothing pending — every transaction has been shipped. 🎉'}
                  </td></tr>
                )}
                {pendingRows.map((r) => (
                  <tr key={r.id} className={`hover:bg-teal-50 ${r.isLocal ? '' : 'cursor-pointer'}`} onClick={() => { if (!r.isLocal) openForPending(r); }}>
                    <td className="border-b border-n-100 px-4 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--teal-500)] align-middle"
                        checked={selected.has(r.id)}
                        onChange={(e) => setSelected((s) => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })}
                      />
                    </td>
                    <td className={`${td} mono`}>{formatDate(r.date)}</td>
                    <td className={td}>
                      <span className="font-medium text-n-800">{r.transactionRef}</span>
                      {/* Already part-shipped: say how many are out so the operator knows
                          this is a follow-on shipment, not a first one. */}
                      {r.outboundCount > 0 && (
                        <span
                          className="ml-2 rounded-pill border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700"
                          title={`${r.outboundCount} shipment${r.outboundCount === 1 ? '' : 's'} already recorded — not yet fully shipped`}
                        >
                          {r.outboundCount} sent
                        </span>
                      )}
                    </td>
                    <td className={td}>{channelCell(r.salesChannel)}</td>
                    <td className={td}>
                      {r.isLocal
                        ? <span className="inline-flex items-center gap-1.5 rounded-pill bg-teal-50 px-2 py-0.5 text-[11.5px] font-medium text-teal-700">
                            {r.deliveryMethod === 'pickup' ? <PackageCheck size={13} /> : <Truck size={13} />}
                            {r.deliveryMethod === 'pickup' ? 'Pickup' : r.deliveryMethod === 'own_delivery' ? 'Own delivery' : 'Local'}
                          </span>
                        : <span className="text-n-400">—</span>}
                    </td>
                    <td className={td}>{r.company?.officialName ?? '—'}</td>
                    <td className={td}>{countryCell(r.destinationCountry)}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {r.skus.slice(0, 3).map((s, i) => <span key={i} className="mono rounded bg-n-100 px-1.5 py-0.5 text-[11px] text-n-600">{s}</span>)}
                        {r.itemCount > 3 && <span className="text-[11px] text-n-400">+{r.itemCount - 3}</span>}
                      </div>
                    </td>
                    <td className={`${td} mono text-right`}>{r.quantity}</td>
                    <td className="border-b border-n-100 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {r.isLocal ? (
                        <button
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                          disabled={fulfilLocal.isPending}
                          title="No carrier or tracking needed for a local sale — this just marks it fulfilled"
                          onClick={() => fulfilLocal.mutate(r.id)}
                        >
                          <PackageCheck size={14} /> {fulfilLabel(r)}
                        </button>
                      ) : (
                        <div className="flex justify-end gap-1.5">
                          <button className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-white hover:bg-primary-hover" onClick={() => openForPending(r)}>
                            <Truck size={14} /> {r.outboundCount > 0 ? 'Add shipment' : 'Record shipment'}
                          </button>
                          {r.outboundCount > 0 && (
                            <button
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-medium text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
                              title="Everything has shipped — close this order off without adding another shipment"
                              disabled={markComplete.isPending}
                              onClick={() => markComplete.mutate(r.id)}
                            >
                              <PackageCheck size={14} /> Complete
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === 'all' ? (
            <table className="w-full min-w-[1000px] border-collapse">
              <thead>
                <tr>
                  <SortableDate label="Ship date" dir={allSort} onToggle={() => { setAllSort(allSort === 'asc' ? 'desc' : 'asc'); setPage(1); }} />
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
                    <td className={td}>
                      <span className={`font-medium text-n-800${s.type === 'fba' ? ' mono' : ''}`}>{s.transactionRef ?? '—'}</span>
                      {s.groupId && (
                        <span className="ml-2 rounded-pill border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-700" title="Shipped together with other orders as one parcel — cost split across them">
                          Combined
                        </span>
                      )}
                    </td>
                    <td className={td}>{channelCell(s.salesChannel)}</td>
                    <td className={td}>
                      {s.type === 'outbound'
                        ? <span className="tag border border-teal-100 bg-teal-50 text-teal-700">Outbound</span>
                        : s.type === 'fba'
                          ? <span className="tag border border-violet-200 bg-violet-50 text-violet-700" title="Stock sent to an Amazon fulfilment centre — no customer order behind it">FBA inbound</span>
                          : <span className="tag border border-orange-100 bg-orange-50 text-orange-700">Inbound</span>}
                    </td>
                    <td className={td}>{s.shippingService?.name ?? '—'}</td>
                    <td className={`${td} code`}>{s.trackingNumber ?? '—'}</td>
                    <td className={`${td} mono text-right`}>{eur(s.shippingCostEur)}</td>
                    <td className={td}>{s.costBorneBy === 'company' ? 'Company' : 'Customer'}</td>
                    <td className={`${td} mono text-right`}>{s.dutyImportEur != null && s.dutyImportEur !== 0 ? eur(s.dutyImportEur) : '—'}</td>
                    <td className={`${td} max-w-[220px] truncate`} title={s.comments ?? undefined}>{s.comments ?? '—'}</td>
                    <td className="border-b border-n-100 px-4 py-2.5">
                      {/* An FBA shipment has no transaction to add to and is not edited from the log —
                          its lines and cost allocation belong to the FBA Shipments module. */}
                      {s.type === 'fba' ? (
                        <div className="flex justify-end">
                          <Link to="/fba-shipments" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-medium text-n-700 hover:border-teal-300 hover:text-teal-700" title="Open the FBA Shipments module">
                            <ExternalLink size={14} /> FBA module
                          </Link>
                        </div>
                      ) : (
                      <div className="flex justify-end gap-1">
                        <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" title="Add another shipment for this transaction" onClick={() => openAddFor(s)}><Package size={15} /></button>
                        <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" title="Edit" onClick={() => openForEdit(s)}><Pencil size={15} /></button>
                        <button
                          className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger"
                          title={s.type === 'outbound' ? 'Cancel this shipment — the order returns to Pending fulfilment' : 'Remove this shipment'}
                          onClick={() =>
                            confirm(
                              s.type === 'outbound'
                                ? `Cancel this shipment for ${s.transactionRef}?\n\nIts tracking number and cost are removed, and the order goes back to Pending fulfilment so it can be shipped again.`
                                : `Remove this inbound shipment for ${s.transactionRef}?`,
                            ) && del.mutate({ id: s.id, type: s.type })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[1000px] border-collapse">
              <thead>
                <tr>
                  <SortableDate label="Date" dir={allSort} onToggle={() => { setAllSort(allSort === 'asc' ? 'desc' : 'asc'); setPage(1); }} />
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
                {!isLoading && fbaRows.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-[13px] text-n-500">
                    {/* This tab is a worklist of shipments still needing a cost, so empty means settled,
                        not missing. Saying only "no FBA shipments" reads as though they have gone. */}
                    Nothing awaiting a cost. Confirmed FBA shipments live in <strong>All shipments</strong>; new ones are created in the FBA Shipments module.
                  </td></tr>
                )}
                {fbaRows.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-teal-50" onClick={() => setFbaActualFor(s)}>
                    <td className={`${td} mono`}>{formatDate(s.date)}</td>
                    <td className={td}><span className="mono font-medium text-n-800">{s.fbaShipmentRef ?? '—'}</span></td>
                    <td className={td}>{channelCell(s.salesChannel)}</td>
                    <td className={td}>{countryCell(s.destinationCountry)}</td>
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

      <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />

      {tab === 'dispatched' && pendingRows.length > 0 && (
        <p className="mt-3 inline-flex items-start gap-1.5 text-[12px] text-n-400">
          <ArrowRight size={13} className="mt-[3px] shrink-0" />
          <span>
            The marketplace shipped these; we hold no shipment for them, so profit uses the estimated
            shipping cost. Click a row to record what it actually cost, or select and accept the estimate
            to close them out.
          </span>
        </p>
      )}
      {tab === 'pending' && pendingRows.length > 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-n-400">
          <ArrowRight size={13} /> Channel orders: click a row to record a shipment — untick “fully shipped” if more will follow, and the order stays here so you can add the next one. Local sales: mark picked up / delivered in one click.
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
      {importOpen && (
        <ShipmentImportModal onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); invalidate(); }} />
      )}
      {combineOpen && selectedChannelOrders.length >= 2 && (
        <CombineShipmentModal
          orders={selectedChannelOrders}
          onClose={() => setCombineOpen(false)}
          onSaved={() => { setCombineOpen(false); setSelected(new Set()); invalidate(); }}
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Coins, Download, Lock, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { BulkImport, ModalShell, Pagination, Select, downloadTemplate, type ImportField } from '@masquare/ui';
import { fbaShipmentsApi, salesChannelsApi, shippingServicesApi, type FbaShipment } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { useAuth } from '../lib/auth';
import { usePersistentState } from '../lib/usePersistentState';
import { CountryTag } from '../components/common/Flag';
import { ChannelChip, useChannelChips } from '../components/common/ChannelChip';
import { formatDate } from '../lib/format';
import { FbaShipmentModal } from '../components/fba-shipments/FbaShipmentModal';
import { FbaShipmentSummaryModal } from '../components/fba-shipments/FbaShipmentSummaryModal';
import { FbaActualCostModal } from '../components/fba-shipments/FbaActualCostModal';

const eur = (v: number | null | undefined) => (v != null ? `€${v.toFixed(2)}` : '—');
const kg = (v: number | null | undefined) => (v != null ? `${v.toFixed(2)} kg` : '—');

// One row per SKU line. Rows sharing an FBA Shipment ID form one shipment; within it,
// rows sharing a Box form a box. Shipment/box fields are read from the first row of each group.
const FBA_IMPORT_FIELDS: ImportField[] = [
  { key: 'fbaShipmentId', label: 'FBA Shipment ID', required: true },
  { key: 'date', label: 'Date', required: true },
  { key: 'salesChannel', label: 'Sales Channel', required: true },
  { key: 'shippingService', label: 'Shipping Service' },
  { key: 'packagingPct', label: 'Packaging %' },
  { key: 'box', label: 'Box' },
  { key: 'boxEmptyWeightKg', label: 'Box Empty Weight (kg)' },
  { key: 'boxLengthCm', label: 'Box Length (cm)' },
  { key: 'boxWidthCm', label: 'Box Width (cm)' },
  { key: 'boxHeightCm', label: 'Box Height (cm)' },
  { key: 'boxTracking', label: 'Box Tracking' },
  { key: 'sku', label: 'SKU', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
];
/**
 * The import template, with the columns that must match something in the platform offered as
 * dropdowns rather than typed.
 *
 * A mistyped channel or service used to fail at import, or worse, match nothing and import as
 * blank. The permitted values are read from the platform when the button is pressed, so a template
 * downloaded today lists the channels that exist today.
 */
function buildFbaTemplate(channels: { name: string }[], services: { name: string }[]) {
  const sample = (box: string, w: string, l: string, wd: string, h: string, track: string, sku: string, qty: string) => [
    'FBA15ABC001', '2026-01-15', channels[0]?.name ?? 'Amazon SG', services[0]?.name ?? 'DHL Express',
    '10', box, w, l, wd, h, track, sku, qty,
  ];
  return downloadTemplate('masquare-fba-shipments-template', {
    sheetName: 'FBA Shipments',
    headers: FBA_IMPORT_FIELDS.map((f) => f.label),
    sampleRows: [
      sample('Box 1', '0.5', '40', '30', '30', 'TRACK123', 'RE-S8540-FBA', '6'),
      sample('Box 2', '0.4', '30', '20', '20', 'TRACK124', 'RE-AC8820-FBA', '4'),
    ],
    lists: [
      { column: FBA_IMPORT_FIELDS.findIndex((f) => f.key === 'salesChannel'), values: channels.map((c) => c.name) },
      { column: FBA_IMPORT_FIELDS.findIndex((f) => f.key === 'shippingService'), values: services.map((s) => s.name) },
    ].filter((l) => l.column >= 0),
  }).then(({ emptyLists }) => {
    // A column with nothing to offer stays free text. Saying so beats a template that looks the
    // same as one with dropdowns and quietly accepts anything — which is how this was noticed:
    // downloaded from a company that has no sales channels of its own.
    if (emptyLists.length) {
      toast.warning('No values for ' + emptyLists.join(' or ') + ' in this company - those columns accept free text.');
    }
  });
}

export function FbaShipmentsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [filterChannel, setFilterChannel] = usePersistentState('fbaShipments.filterChannel', '');
  const [filterStatus, setFilterStatus] = usePersistentState('fbaShipments.filterStatus', '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Shipment-date order; newest first by default.
  const [sortDir, setSortDir] = usePersistentState<'asc' | 'desc'>('fbaShipments.sortDir', 'desc');
  const [modal, setModal] = useState<{ shipment?: FbaShipment } | null>(null);
  const [viewing, setViewing] = useState<FbaShipment | null>(null);
  const [actualFor, setActualFor] = useState<FbaShipment | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Confirmed shipments are locked to admins (registering the actual cost stays open to all).
  const canEdit = (s: FbaShipment) => isAdmin || s.status !== 'confirmed';

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  // Only for the template's dropdowns — the list must be the one that exists when it is downloaded.
  const { data: shippingServices = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });
  const downloadFbaTemplate = () => buildFbaTemplate(channels, shippingServices);
  const chipFor = useChannelChips();
  const params = { q: q || undefined, salesChannelId: filterChannel || undefined, status: filterStatus || undefined, sortDir, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['fba-shipments', params], queryFn: () => fbaShipmentsApi.list(params) });

  const [view, setView] = useState<'shipments' | 'costs'>('shipments');
  const costParams = { q: q || undefined, salesChannelId: filterChannel || undefined };
  const { data: skuCosts = [], isLoading: costsLoading } = useQuery({
    queryKey: ['fba-sku-costs', costParams], queryFn: () => fbaShipmentsApi.skuCosts(costParams), enabled: view === 'costs',
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['fba-shipments'] });

  const del = useMutation({
    mutationFn: (id: string) => fbaShipmentsApi.remove(id),
    onSuccess: () => { toast.success('FBA shipment removed'); invalidate(); },
    onError: () => toast.error('Could not remove shipment'),
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  return (
    <div className="w-full">
      <PageHeader
        module="Sales"
        title="FBA Shipments"
        info="Ship stock to Amazon fulfilment centers. The estimated (then actual) shipping cost is allocated per SKU and feeds each product's average inbound FBA cost."
        tabs={[
          { key: 'shipments', label: 'Shipments' },
          { key: 'costs', label: 'Allocated cost per SKU' },
        ]}
        activeTab={view}
        onTabChange={(k) => setView(k as 'shipments' | 'costs')}
        actions={
          <>
            <button className="hbtn" onClick={downloadFbaTemplate}><Download size={15} /> Template</button>
            <button className="hbtn" onClick={() => setImportOpen(true)}><Upload size={15} /> Import</button>
          </>
        }
        primary={<button className="hbtn-primary" onClick={() => setModal({})}><Plus size={16} /> New FBA shipment</button>}
        toolbar={
          <>
            <div className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-3">
              <Search size={15} className="text-n-400" />
              <input className="h-full flex-1 bg-transparent text-[13px] outline-none" placeholder={view === 'costs' ? 'Search SKU…' : 'Search FBA ID or SKU…'} value={qInput} onChange={(e) => setQInput(e.target.value)} />
            </div>
            <Select
              dense className="w-40"
              value={filterChannel}
              onChange={(v) => { setFilterChannel(v); setPage(1); }}
              options={[{ value: '', label: 'All channels' }, ...channels.map((c) => ({ value: c.id, label: c.name }))]}
            />
            {view === 'shipments' && (
              <Select
                dense className="w-36"
                value={filterStatus}
                onChange={(v) => { setFilterStatus(v); setPage(1); }}
                options={[{ value: '', label: 'All statuses' }, { value: 'draft', label: 'Draft' }, { value: 'confirmed', label: 'Confirmed' }]}
              />
            )}
          </>
        }
      />

      {view === 'costs' && (
        <>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse">
                <thead>
                  <tr>
                    <th className={`${th} text-left`}>SKU</th>
                    <th className={`${th} text-left`}>Product</th>
                    <th className={`${th} text-left`}>Sales channel</th>
                    <th className={`${th} text-right`}>Total qty</th>
                    <th className={`${th} text-right`}>Total allocated (€)</th>
                    <th className={`${th} text-right`}>Avg / unit (€)</th>
                    <th className={`${th} text-right`}>Shipments</th>
                  </tr>
                </thead>
                <tbody>
                  {costsLoading && <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
                  {!costsLoading && skuCosts.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-[13px] text-n-500">No allocated costs. Add FBA shipments with SKUs to see per-SKU averages.</td></tr>}
                  {skuCosts.map((r) => (
                    <tr key={`${r.sku}:${r.salesChannelId}`} className="hover:bg-teal-50">
                      <td className={`${td} code font-medium text-n-800`}>{r.sku}</td>
                      <td className={td}>{r.title ?? <span className="text-n-400">unlinked</span>}</td>
                      <td className={td}><ChannelChip name={r.salesChannelName} {...chipFor(r.salesChannelId)} /></td>
                      <td className={`${td} mono text-right`}>{r.totalQuantity}</td>
                      <td className={`${td} mono text-right`}>{eur(r.totalAllocatedCostEur)}</td>
                      <td className={`${td} mono text-right font-semibold text-n-900`}>{eur(r.averageCostPerUnitEur)}</td>
                      <td className={`${td} mono text-right`}>{r.shipmentCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-3 text-[13px] text-n-500">SKU averages: <span className="code">{skuCosts.length}</span> — this per-unit average is what feeds each FBA order's inbound shipping cost.</div>
        </>
      )}

      {view === 'shipments' && (
      <>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-n-800"
                    title={`Sort ${sortDir === 'asc' ? 'newest' : 'oldest'} first`}
                    onClick={() => { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); }}
                  >
                    Date
                    {sortDir === 'asc' ? <ArrowUp size={12} className="text-teal-600" /> : <ArrowDown size={12} className="text-teal-600" />}
                  </button>
                </th>
                <th className={`${th} text-left`}>FBA ID</th>
                <th className={`${th} text-left`}>Channel</th>
                <th className={`${th} text-left`}>Destination</th>
                <th className={`${th} text-left`}>Service</th>
                <th className={`${th} text-right`}>SKUs / Qty</th>
                <th className={`${th} text-right`}>Weight</th>
                <th className={`${th} text-right`}>Est. cost</th>
                <th className={`${th} text-right`}>Actual cost</th>
                <th className={`${th} text-left`}>Status</th>
                <th className="border-b border-n-200 bg-n-25" />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={11} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={11} className="px-4 py-12 text-center text-[13px] text-n-500">No FBA shipments yet. Create one to ship stock to a fulfilment center.</td></tr>}
              {rows.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-teal-50" onClick={() => setViewing(s)}>
                  <td className={`${td} mono`}>{formatDate(s.date)}</td>
                  <td className={td}><span className="mono font-medium text-n-800">{s.fbaShipmentRef ?? '—'}</span></td>
                  <td className={td}><ChannelChip name={s.salesChannel?.name} {...chipFor(s.salesChannel?.id)} /></td>
                  <td className={td}>{s.destinationCountry ? <CountryTag code={s.destinationCountry.isoCode} name={s.destinationCountry.name} /> : '—'}</td>
                  <td className={td}>{s.shippingService?.name ?? '—'}{s.shippingZone ? <span className="text-n-400"> · {s.shippingZone.name}</span> : ''}</td>
                  <td className={`${td} mono text-right`}>{s.itemCount} / {s.quantity}</td>
                  <td className={`${td} mono text-right`}>{kg(s.chargeableWeightKg ?? s.productWeightKg)}</td>
                  <td className={`${td} mono text-right`}>{eur(s.estimatedCostEur)}</td>
                  <td className={`${td} mono text-right ${s.actualCostEur != null ? 'font-semibold text-n-900' : 'text-n-400'}`}>{eur(s.actualCostEur)}</td>
                  <td className={td}>
                    {s.status === 'confirmed'
                      ? <span className="tag border border-teal-100 bg-teal-50 text-teal-700">Confirmed</span>
                      : <span className="tag border border-n-200 bg-n-100 text-n-600">Draft</span>}
                  </td>
                  <td className="border-b border-n-100 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" title="Register actual cost" onClick={() => setActualFor(s)}><Coins size={15} /></button>
                      {canEdit(s)
                        ? <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" title="Edit" onClick={() => setModal({ shipment: s })}><Pencil size={15} /></button>
                        : <span className="grid h-8 w-8 place-items-center rounded-md text-n-300" title="Confirmed — only admins can edit"><Lock size={14} /></span>}
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" title="Remove" onClick={() => confirm(`Remove FBA shipment ${s.fbaShipmentRef ?? ''}?`) && del.mutate(s.id)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />
      </>
      )}

      {viewing && (
        <FbaShipmentSummaryModal
          shipment={viewing}
          canEdit={canEdit(viewing)}
          onClose={() => setViewing(null)}
          onEdit={() => { setModal({ shipment: viewing }); setViewing(null); }}
          onRegisterActual={() => { setActualFor(viewing); setViewing(null); }}
        />
      )}
      {modal && (
        <FbaShipmentModal shipment={modal.shipment} onClose={() => setModal(null)} onSaved={() => { setModal(null); invalidate(); }} />
      )}
      {actualFor && (
        <FbaActualCostModal shipment={actualFor} onClose={() => setActualFor(null)} onSaved={() => { setActualFor(null); invalidate(); }} />
      )}
      {importOpen && (
        <ModalShell open title="Import FBA Shipments" primaryLabel="Close" onPrimary={() => setImportOpen(false)} onClose={() => setImportOpen(false)}>
          <p className="mb-3 text-[12.5px] text-n-500">
            One row per SKU line. Rows sharing an <strong>FBA Shipment ID</strong> form one shipment; rows sharing a <strong>Box</strong> within it form a box.
            Sales channel and shipping service are matched by name. Imported as <strong>drafts</strong>.
            {' '}<button className="font-medium text-teal-700 hover:underline" onClick={downloadFbaTemplate}>Download the template</button>.
          </p>
          <BulkImport
            fields={FBA_IMPORT_FIELDS}
            onCommit={async (rows) => {
              const res = await fbaShipmentsApi.importShipments(rows);
              invalidate();
              qc.invalidateQueries({ queryKey: ['fba-sku-costs'] });
              toast.success(`${res.created} shipment${res.created === 1 ? '' : 's'} imported${res.errors.length ? `, ${res.errors.length} failed` : ''}`);
              res.errors.slice(0, 4).forEach((e) => toast.error(`${e.fbaRef}: ${e.message}`));
            }}
            onClose={() => setImportOpen(false)}
          />
        </ModalShell>
      )}
    </div>
  );
}

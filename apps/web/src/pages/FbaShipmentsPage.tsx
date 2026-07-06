import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { fbaShipmentsApi, salesChannelsApi, type FbaShipment } from '../lib/api';
import { formatDate } from '../lib/format';
import { FbaShipmentModal } from '../components/fba-shipments/FbaShipmentModal';

const eur = (v: number | null | undefined) => (v != null ? `€${v.toFixed(2)}` : '—');
const kg = (v: number | null | undefined) => (v != null ? `${v.toFixed(2)} kg` : '—');

export function FbaShipmentsPage() {
  const qc = useQueryClient();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [filterChannel, setFilterChannel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ shipment?: FbaShipment } | null>(null);
  const [actualFor, setActualFor] = useState<FbaShipment | null>(null);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const params = { q: q || undefined, salesChannelId: filterChannel || undefined, status: filterStatus || undefined, page, pageSize: 50 };
  const { data, isLoading } = useQuery({ queryKey: ['fba-shipments', params], queryFn: () => fbaShipmentsApi.list(params) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['fba-shipments'] });

  const del = useMutation({
    mutationFn: (id: string) => fbaShipmentsApi.remove(id),
    onSuccess: () => { toast.success('FBA shipment removed'); invalidate(); },
    onError: () => toast.error('Could not remove shipment'),
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 50));

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex-1">
          <div className="eyebrow mb-1.5">Operations</div>
          <h1 className="text-[24px] font-semibold tracking-tight text-n-900">FBA Shipments</h1>
          <p className="mt-1 text-[13.5px] text-n-500">Ship stock to Amazon fulfilment centers. The estimated (then actual) shipping cost is allocated per SKU and feeds each product's average inbound FBA cost.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({})}><Plus size={17} /> New FBA shipment</button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="flex h-[38px] min-w-[220px] flex-1 items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3">
          <Search size={16} className="text-n-400" />
          <input className="h-full flex-1 text-[13px] outline-none" placeholder="Search FBA ID or SKU…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <select className="h-[38px] rounded-md border border-n-200 bg-n-0 px-2 text-[13px] text-n-700" value={filterChannel} onChange={(e) => { setFilterChannel(e.target.value); setPage(1); }}>
          <option value="">All channels</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="h-[38px] rounded-md border border-n-200 bg-n-0 px-2 text-[13px] text-n-700" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="confirmed">Confirmed</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Date</th>
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
                <tr key={s.id} className="cursor-pointer hover:bg-teal-50" onClick={() => setModal({ shipment: s })}>
                  <td className={`${td} mono`}>{formatDate(s.date)}</td>
                  <td className={td}><span className="mono font-medium text-n-800">{s.fbaShipmentRef ?? '—'}</span></td>
                  <td className={td}>{s.salesChannel?.name ?? '—'}</td>
                  <td className={td}>{s.destinationCountry?.name ?? '—'}</td>
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
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" title="Edit" onClick={() => setModal({ shipment: s })}><Pencil size={15} /></button>
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" title="Remove" onClick={() => confirm(`Remove FBA shipment ${s.fbaShipmentRef ?? ''}?`) && del.mutate(s.id)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[13px] text-n-500">FBA shipments: <span className="mono">{total}</span></span>
        <div className="flex gap-1">
          <button disabled={page <= 1} className="mono grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-[13px] text-n-600 disabled:opacity-40" onClick={() => setPage((p) => p - 1)}>‹</button>
          <span className="mono grid h-8 min-w-8 place-items-center px-2 text-[13px] text-n-600">{page} / {pageCount}</span>
          <button disabled={page >= pageCount} className="mono grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-[13px] text-n-600 disabled:opacity-40" onClick={() => setPage((p) => p + 1)}>›</button>
        </div>
      </div>

      {modal && (
        <FbaShipmentModal shipment={modal.shipment} onClose={() => setModal(null)} onSaved={() => { setModal(null); invalidate(); }} />
      )}
      {actualFor && (
        <ActualCostModal shipment={actualFor} onClose={() => setActualFor(null)} onSaved={() => { setActualFor(null); invalidate(); }} />
      )}
    </div>
  );
}

/** Small modal to register the actual shipping cost, which re-allocates per SKU. */
function ActualCostModal({ shipment, onClose, onSaved }: { shipment: FbaShipment; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(shipment.actualCostEur != null ? String(shipment.actualCostEur) : '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) { toast.error('Enter a valid amount'); return; }
    setBusy(true);
    try {
      await fbaShipmentsApi.setActualCost(shipment.id, amount);
      toast.success('Actual cost registered — allocation updated');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not save');
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-[420px] max-w-full rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">Register actual shipping cost</h2>
          <p className="mt-0.5 text-[12.5px] text-n-500">{shipment.fbaShipmentRef ?? 'FBA shipment'} · estimate {eur(shipment.estimatedCostEur)}</p>
        </div>
        <div className="px-5 py-4">
          <label className="label">Actual cost <span className="font-normal text-n-400">(exc. VAT, €)</span></label>
          <input autoFocus className="input mono" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" onKeyDown={(e) => { if (e.key === 'Enter' && !busy) save(); }} />
          <p className="mt-2 text-[12px] text-n-500">This overrides the estimate and re-allocates the cost across the shipment's SKUs by weight.</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-n-200 px-5 py-3.5">
          <button className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50" onClick={() => !busy && onClose()}>Cancel</button>
          <button className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save cost'}</button>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DatePicker, ModalShell, Select } from '@masquare/ui';
import { shipmentsApi, shippingServicesApi, type PendingShipment } from '../../lib/api';

interface Props {
  orders: PendingShipment[];
  onClose: () => void;
  onSaved: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const round2 = (v: number) => Number(v.toFixed(2));
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const eur = (v: number) => `€${v.toFixed(2)}`;

/** Split `total` across the orders in proportion to each order's own shipping charge
 *  (equal split when none charged shipping). The last order absorbs the rounding residue
 *  so the parts always add back up to the total exactly. */
function splitByShipping(orders: PendingShipment[], total: number): Record<string, number> {
  const weights = orders.map((o) => Math.max(0, o.shippingEur || 0));
  const sum = weights.reduce((s, w) => s + w, 0);
  const out: Record<string, number> = {};
  let running = 0;
  orders.forEach((o, i) => {
    const share = i === orders.length - 1
      ? round2(total - running)
      : round2(sum > 0 ? total * (weights[i] / sum) : total / orders.length);
    running += share;
    out[o.id] = share;
  });
  return out;
}

export function CombineShipmentModal({ orders, onClose, onSaved }: Props) {
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(today());
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [tracking, setTracking] = useState('');
  const [borneBy, setBorneBy] = useState<'company' | 'customer'>('company');
  const [duty, setDuty] = useState('');
  const [comments, setComments] = useState('');
  const [markShipped, setMarkShipped] = useState(true);

  const [total, setTotal] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  const totalNum = Number(total) || 0;
  const anyShipping = orders.some((o) => (o.shippingEur || 0) > 0);

  // Re-split whenever the total changes (this is the primary path; individual cells can then
  // be nudged by hand).
  const setTotalAndSplit = (v: string) => {
    setTotal(v);
    const t = Number(v) || 0;
    const split = splitByShipping(orders, t);
    setAlloc(Object.fromEntries(orders.map((o) => [o.id, split[o.id].toFixed(2)])));
  };
  const autoSplit = () => {
    const split = splitByShipping(orders, totalNum);
    setAlloc(Object.fromEntries(orders.map((o) => [o.id, split[o.id].toFixed(2)])));
  };

  const allocSum = useMemo(() => round2(orders.reduce((s, o) => s + (Number(alloc[o.id]) || 0), 0)), [alloc, orders]);
  const mismatch = round2(Math.abs(allocSum - totalNum));
  const valid = totalNum > 0 && mismatch <= 0.01;

  const save = async () => {
    setBusy(true);
    try {
      const res = await shipmentsApi.combine({
        transactionIds: orders.map((o) => o.id),
        shipmentDate: date,
        shippingServiceId: serviceId,
        trackingNumber: tracking.trim() || null,
        totalShippingCostEur: totalNum,
        allocations: orders.map((o) => ({ transactionId: o.id, shippingCostEur: round2(Number(alloc[o.id]) || 0) })),
        costBorneBy: borneBy,
        dutyImportEur: numOrNull(duty),
        comments: comments.trim() || null,
        markShipped,
      });
      toast.success(`Combined shipment recorded — ${res.created} orders shipped together`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not combine shipments');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title="Combine into one shipment"
      subtitle={`${orders.length} orders shipping together as one parcel`}
      primaryLabel={`Combine ${orders.length} orders`}
      primaryDisabled={!valid}
      onPrimary={save}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 items-start gap-4 max-[560px]:grid-cols-1">
          <div><label className="label">Shipment date</label><DatePicker value={date} onChange={setDate} /></div>
          <div>
            <label className="label">Shipping service</label>
            <Select value={serviceId ?? ''} onChange={(v) => setServiceId(v || null)} placeholder="—"
              options={services.map((s) => ({ value: s.id, label: s.name }))} />
          </div>
          <div>
            <label className="label">Total shipping cost <span className="font-normal text-n-400">(€)</span></label>
            <input className="input mono" inputMode="decimal" value={total} onChange={(e) => setTotalAndSplit(e.target.value)} placeholder="0.00" autoFocus />
          </div>
          <div><label className="label">Tracking number</label><input className="input mono" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="e.g. 1Z…" /></div>
          <div>
            <label className="label">Cost borne by</label>
            <Select value={borneBy} onChange={(v) => setBorneBy(v as any)}
              options={[{ value: 'company', label: 'Company (our cost)' }, { value: 'customer', label: 'Customer' }]} />
          </div>
          <div>
            <label className="label">Duty / import charges <span className="font-normal text-n-400">(€)</span></label>
            <input className="input mono" inputMode="decimal" value={duty} onChange={(e) => setDuty(e.target.value)} placeholder="0.00" />
          </div>
          <div className="col-span-2 max-[560px]:col-span-1">
            <label className="label">Comments</label>
            <input className="input" value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Optional notes" />
          </div>
        </div>

        {/* Per-order split of the total shipping cost. Pre-filled by each order's own shipping
            charge; every cell is editable and must add back up to the total. */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="label mb-0">Cost split across orders</label>
            <button type="button" onClick={autoSplit} className="text-[12px] font-semibold text-teal-700 hover:underline">
              Split by order shipping
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-n-200">
            <div className="grid gap-2 border-b border-n-100 bg-n-25 px-3 py-2" style={{ gridTemplateColumns: '1.4fr 1fr 120px' }}>
              {['Order', 'Order shipping', 'Allocated (€)'].map((h) => (
                <div key={h} className="text-[11px] font-semibold uppercase tracking-wide text-n-500">{h}</div>
              ))}
            </div>
            {orders.map((o) => (
              <div key={o.id} className="grid items-center gap-2 border-b border-n-100 px-3 py-2 last:border-b-0" style={{ gridTemplateColumns: '1.4fr 1fr 120px' }}>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-n-800">{o.transactionRef}</div>
                  <div className="truncate text-[11.5px] text-n-400">{o.salesChannel?.name ?? '—'} · {o.destinationCountry?.name ?? '—'}</div>
                </div>
                <div className="mono text-[12.5px] text-n-500">{eur(o.shippingEur || 0)}</div>
                <input className="input mono" inputMode="decimal" value={alloc[o.id] ?? ''} onChange={(e) => setAlloc((a) => ({ ...a, [o.id]: e.target.value }))} placeholder="0.00" />
              </div>
            ))}
            <div className="grid gap-2 bg-n-25 px-3 py-2" style={{ gridTemplateColumns: '1.4fr 1fr 120px' }}>
              <div className="text-[12.5px] font-semibold text-n-700">Total allocated</div>
              <div />
              <div className={`mono text-[13px] font-bold ${mismatch <= 0.01 ? 'text-n-800' : 'text-danger'}`}>{eur(allocSum)}</div>
            </div>
          </div>
          {!anyShipping && (
            <p className="mt-2 text-[11.5px] text-n-400">None of these orders charged the customer for shipping, so the cost is split equally. Adjust any cell to override.</p>
          )}
          {totalNum > 0 && mismatch > 0.01 && (
            <p className="mt-2 text-[12px] text-danger">The allocated costs add up to {eur(allocSum)} but the total is {eur(totalNum)} — adjust so they match (or use “Split by order shipping”).</p>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-n-200 bg-n-25 px-3 py-2.5">
          <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={markShipped} onChange={(e) => setMarkShipped(e.target.checked)} />
          <span className="text-[13px] text-n-700">
            Mark all orders as <strong>fully shipped</strong> (removes them from the pending worklist).
          </span>
        </label>

        <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
          Each order gets its own shipment record sharing this parcel's date, service and tracking, with its allocated share of the cost — so every order's profit reflects what it actually cost to ship.
        </p>
      </div>
    </ModalShell>
  );
}

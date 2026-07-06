import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import {
  fbaShipmentsApi, salesChannelsApi, shippingServicesApi,
  type FbaEstimate, type FbaShipment, type FbaShipmentInput, type RefLite,
} from '../../lib/api';
import { RefField } from '../products/RefField';
import { ProductSkuField } from '../sales/ProductSkuField';

interface Props {
  shipment?: FbaShipment; // when editing
  onClose: () => void;
  onSaved: () => void;
}

interface LineForm { productId: string | null; sku: string; quantity: string }
const emptyLine = (): LineForm => ({ productId: null, sku: '', quantity: '1' });
const today = () => new Date().toISOString().slice(0, 10);
const eur = (v: number | null | undefined, dp = 2) => (v != null ? `€${v.toFixed(dp)}` : '—');
const kg = (v: number | null | undefined) => (v != null ? `${v.toFixed(3)} kg` : '—');

type Tab = 'details' | 'weight' | 'allocation';

export function FbaShipmentModal({ shipment, onClose, onSaved }: Props) {
  const editing = !!shipment;
  const [tab, setTab] = useState<Tab>('details');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  const [date, setDate] = useState(shipment ? shipment.date.slice(0, 10) : today());
  const [channel, setChannel] = useState<RefLite | null>(shipment?.salesChannel ?? null);
  const [fbaRef, setFbaRef] = useState(shipment?.fbaShipmentRef ?? '');
  const [serviceId, setServiceId] = useState<string | null>(shipment?.shippingServiceId ?? null);
  const [packagingPct, setPackagingPct] = useState(shipment?.packagingPct != null ? String(shipment.packagingPct) : '10');
  const [comments, setComments] = useState(shipment?.comments ?? '');
  const [lines, setLines] = useState<LineForm[]>(
    shipment && shipment.items.length
      ? shipment.items.map((it) => ({ productId: it.productId, sku: it.sku, quantity: String(it.quantity) }))
      : [emptyLine()],
  );

  const [estimate, setEstimate] = useState<FbaEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const isActualWeight = service?.calcMethod === 'actual_weight';

  const setLine = (i: number, v: Partial<LineForm>) => { setLines((r) => r.map((x, idx) => (idx === i ? { ...x, ...v } : x))); touch(); };

  // Build the estimate/save payload from the current form.
  const buildInput = (): Omit<FbaShipmentInput, 'status'> => ({
    date,
    salesChannelId: channel?.id ?? null,
    fbaShipmentRef: fbaRef.trim() || null,
    shippingServiceId: serviceId,
    packagingPct: Number(packagingPct) || 0,
    comments: comments.trim() || null,
    items: lines
      .filter((l) => l.sku.trim())
      .map((l) => ({ sku: l.sku.trim(), productId: l.productId, quantity: Math.max(1, Number(l.quantity) || 1) })),
  });

  // Live estimate: recompute whenever the inputs that affect it change (debounced).
  const estKey = JSON.stringify({
    c: channel?.id ?? null, s: serviceId, p: packagingPct,
    items: lines.filter((l) => l.sku.trim()).map((l) => ({ sku: l.sku.trim(), pid: l.productId, q: l.quantity })),
  });
  useEffect(() => {
    const input = buildInput();
    if (!input.items.length) { setEstimate(null); return; }
    let cancelled = false;
    setEstimating(true);
    const t = setTimeout(async () => {
      try {
        const res = await fbaShipmentsApi.estimate(input);
        if (!cancelled) setEstimate(res);
      } catch {
        if (!cancelled) setEstimate(null);
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estKey]);

  const titleForLine = (l: LineForm) => estimate?.items.find((it) => it.sku.toLowerCase() === l.sku.trim().toLowerCase())?.title ?? null;
  const canSave = useMemo(() => channel && serviceId && lines.some((l) => l.sku.trim()), [channel, serviceId, lines]);

  const save = async (status: 'draft' | 'confirmed') => {
    if (!canSave) { toast.error('Pick a sales channel, a shipping service and at least one SKU'); return; }
    setBusy(true);
    try {
      const body: FbaShipmentInput = { ...buildInput(), status };
      if (editing) await fbaShipmentsApi.update(shipment!.id, body);
      else await fbaShipmentsApi.create(body);
      toast.success(editing ? 'FBA shipment updated' : status === 'confirmed' ? 'FBA shipment confirmed' : 'Draft saved');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    { key: 'details', label: '1 · Shipment details' },
    { key: 'weight', label: '2 · Weight & cost' },
    { key: 'allocation', label: '3 · Cost allocation' },
  ];

  const destName = estimate?.destinationCountry?.name ?? (channel ? '—' : '');

  return (
    <ModalShell
      open
      title={editing ? 'Edit FBA shipment' : 'New FBA shipment'}
      subtitle={channel?.name ? `${channel.name}${destName && destName !== '—' ? ` · ${destName}` : ''}` : 'Ship stock to an Amazon fulfilment center'}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(k) => setTab(k as Tab)}
      dirty={dirty}
      primaryLabel="Confirm shipment"
      onPrimary={() => save('confirmed')}
      primaryDisabled={!canSave}
      secondaryLabel="Save as draft"
      onSecondary={() => save('draft')}
      secondaryDisabled={!canSave}
      busy={busy}
      initialSize={{ w: 780, h: 620 }}
      onClose={onClose}
    >
      {tab === 'details' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
            <div><label className="label">Date</label><input type="date" className="input mono" value={date} onChange={(e) => { setDate(e.target.value); touch(); }} /></div>
            <div><label className="label">Sales channel</label><RefField value={channel} placeholder="Amazon US…" list={(q) => salesChannelsApi.list(q)} onChange={(v) => { setChannel(v); touch(); }} /></div>
            <div>
              <label className="label">Destination country <span className="font-normal text-n-400">(auto)</span></label>
              <input className="input" value={destName || ''} readOnly placeholder="From the sales channel" />
            </div>
            <div><label className="label">FBA Shipment ID</label><input className="input mono" value={fbaRef} onChange={(e) => { setFbaRef(e.target.value); touch(); }} placeholder="e.g. FBA15ABCXYZ" /></div>
          </div>

          <div>
            <label className="label">SKUs in this shipment</label>
            <div className="overflow-hidden rounded-lg border border-n-200">
              <div className="grid grid-cols-[1fr_1fr_90px_36px] gap-2 border-b border-n-200 bg-n-25 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-n-500">
                <span>SKU</span><span>Product</span><span className="text-right">Qty</span><span />
              </div>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_90px_36px] items-center gap-2 border-b border-n-100 px-3 py-2 last:border-b-0">
                  <ProductSkuField value={{ productId: l.productId, sku: l.sku }} onChange={(v) => setLine(i, v)} />
                  <span className="truncate text-[13px] text-n-700" title={titleForLine(l) ?? undefined}>
                    {titleForLine(l) ?? (l.sku.trim() ? <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle size={12} /> no product</span> : <span className="text-n-300">—</span>)}
                  </span>
                  <input className="input mono text-right" inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  <button className="grid h-9 w-9 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setLines((r) => r.filter((_, idx) => idx !== i)); touch(); }}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <div className="mt-2"><button className="btn btn-ghost" onClick={() => { setLines((r) => [...r, emptyLine()]); touch(); }}><Plus size={16} /> Add SKU</button></div>
          </div>
        </div>
      )}

      {tab === 'weight' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
            <div>
              <label className="label">Shipping service</label>
              <select className="input" value={serviceId ?? ''} onChange={(e) => { setServiceId(e.target.value || null); touch(); }}>
                <option value="">— select —</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.calcMethod === 'actual_weight' ? 'actual' : 'volumetric'})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Shipping zone <span className="font-normal text-n-400">(auto)</span></label>
              <input className="input" value={estimate?.shippingZoneName ?? ''} readOnly placeholder="From destination + service" />
            </div>
            {isActualWeight && (
              <div>
                <label className="label">Packaging uplift <span className="font-normal text-n-400">(% of product weight)</span></label>
                <input className="input mono" inputMode="decimal" value={packagingPct} onChange={(e) => { setPackagingPct(e.target.value); touch(); }} placeholder="10" />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-n-200">
            <Row label={service ? (isActualWeight ? 'Summed product weight' : 'Summed volumetric weight') : 'Weight basis'} value={kg(estimate?.basisWeightKg)} />
            {isActualWeight && <Row label={`Chargeable weight (incl. ${estimate?.packagingPct ?? packagingPct}% packaging)`} value={kg(estimate?.chargeableWeightKg)} />}
            <Row label="Rate band charge" value={eur(estimate?.estimatedCostEur)} strong />
          </div>

          {estimating && <p className="text-[12px] text-n-400">Calculating…</p>}
          {estimate?.warnings?.map((w, i) => (
            <p key={i} className="inline-flex items-start gap-1.5 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}</p>
          ))}
          <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
            {isActualWeight
              ? 'Actual-weight service: product weights are summed, the packaging uplift is added, then rounded up to the next weight band to read the charge.'
              : service
                ? 'Volumetric service: each unit is charged on the greater of its volumetric (L×W×H ÷ 5000) and actual weight.'
                : 'Pick a shipping service to estimate the cost.'}
          </p>
        </div>
      )}

      {tab === 'allocation' && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-n-500">
            The estimated shipping cost is split across SKUs by each line's share of the total {isActualWeight ? 'weight' : 'volumetric weight'}. The actual cost is registered from the shipments list once known, which re-allocates these figures.
          </p>
          <div className="overflow-hidden rounded-lg border border-n-200">
            <div className="grid grid-cols-[1fr_90px_110px_110px] gap-2 border-b border-n-200 bg-n-25 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-n-500">
              <span>SKU</span><span className="text-right">Qty</span><span className="text-right">Weight</span><span className="text-right">Allocated</span>
            </div>
            {(estimate?.items ?? []).length === 0 && <div className="px-3 py-6 text-center text-[13px] text-n-500">Add SKUs and pick a service to see the allocation.</div>}
            {(estimate?.items ?? []).map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_110px_110px] gap-2 border-b border-n-100 px-3 py-2 text-[13px] last:border-b-0">
                <span className="mono truncate text-n-800" title={it.title ?? undefined}>{it.sku}</span>
                <span className="mono text-right text-n-600">{it.quantity}</span>
                <span className="mono text-right text-n-600">{kg(it.lineWeightKg)}</span>
                <span className="mono text-right font-medium text-n-800">{eur(it.allocatedCostEur)}</span>
              </div>
            ))}
            {estimate && estimate.items.length > 0 && (
              <div className="grid grid-cols-[1fr_90px_110px_110px] gap-2 bg-n-25 px-3 py-2 text-[13px] font-semibold">
                <span className="text-n-700">Total</span><span /><span className="mono text-right text-n-600">{kg(estimate.basisWeightKg)}</span>
                <span className="mono text-right text-n-900">{eur(estimate.estimatedCostEur)}</span>
              </div>
            )}
          </div>
          <div><label className="label">Comments</label><input className="input" value={comments} onChange={(e) => { setComments(e.target.value); touch(); }} placeholder="Optional notes" /></div>
        </div>
      )}
    </ModalShell>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-n-100 px-3 py-2.5 last:border-b-0">
      <span className="text-[13px] text-n-600">{label}</span>
      <span className={`mono text-[13px] ${strong ? 'font-semibold text-n-900' : 'text-n-800'}`}>{value}</span>
    </div>
  );
}

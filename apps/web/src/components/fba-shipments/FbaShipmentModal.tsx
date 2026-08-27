import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DatePicker, ModalShell, Select } from '@masquare/ui';
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
interface BoxForm { emptyWeightKg: string; lengthCm: string; widthCm: string; heightCm: string; trackingNumber: string; items: LineForm[] }
const emptyLine = (): LineForm => ({ productId: null, sku: '', quantity: '1' });
const emptyBox = (): BoxForm => ({ emptyWeightKg: '', lengthCm: '', widthCm: '', heightCm: '', trackingNumber: '', items: [emptyLine()] });
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

  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  const [date, setDate] = useState(shipment ? shipment.date.slice(0, 10) : today());
  const [channel, setChannel] = useState<RefLite | null>(shipment?.salesChannel ?? null);
  const [fbaRef, setFbaRef] = useState(shipment?.fbaShipmentRef ?? '');
  const [serviceId, setServiceId] = useState<string | null>(shipment?.shippingServiceId ?? null);
  const [packagingPct, setPackagingPct] = useState(shipment?.packagingPct != null ? String(shipment.packagingPct) : '10');
  const [comments, setComments] = useState(shipment?.comments ?? '');
  const [boxes, setBoxes] = useState<BoxForm[]>(() => {
    if (shipment && shipment.boxes.length) {
      return shipment.boxes.map((b) => ({
        emptyWeightKg: b.emptyWeightKg != null ? String(b.emptyWeightKg) : '',
        lengthCm: b.lengthCm != null ? String(b.lengthCm) : '',
        widthCm: b.widthCm != null ? String(b.widthCm) : '',
        heightCm: b.heightCm != null ? String(b.heightCm) : '',
        trackingNumber: b.trackingNumber ?? '',
        items: b.items.length ? b.items.map((it) => ({ productId: it.productId, sku: it.sku, quantity: String(it.quantity) })) : [emptyLine()],
      }));
    }
    // Legacy shipment (items but no boxes yet) → seed a single box with its SKUs.
    if (shipment && shipment.allocation?.length) {
      return [{ ...emptyBox(), items: shipment.allocation.map((it) => ({ productId: it.productId, sku: it.sku, quantity: String(it.quantity) })) }];
    }
    return [emptyBox()];
  });

  const [estimate, setEstimate] = useState<FbaEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const isActualWeight = service?.calcMethod === 'actual_weight';
  const isVolumetric = service?.calcMethod === 'volumetric_weight';

  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const setBox = (bi: number, v: Partial<BoxForm>) => { setBoxes((r) => r.map((x, i) => (i === bi ? { ...x, ...v } : x))); touch(); };
  const setItem = (bi: number, li: number, v: Partial<LineForm>) => {
    setBoxes((r) => r.map((b, i) => (i === bi ? { ...b, items: b.items.map((x, j) => (j === li ? { ...x, ...v } : x)) } : b)));
    touch();
  };

  const buildInput = (): Omit<FbaShipmentInput, 'status'> => ({
    date,
    salesChannelId: channel?.id ?? null,
    fbaShipmentRef: fbaRef.trim() || null,
    shippingServiceId: serviceId,
    packagingPct: Number(packagingPct) || 0,
    comments: comments.trim() || null,
    boxes: boxes.map((b, i) => ({
      label: `Box ${i + 1}`,
      emptyWeightKg: num(b.emptyWeightKg),
      lengthCm: num(b.lengthCm),
      widthCm: num(b.widthCm),
      heightCm: num(b.heightCm),
      trackingNumber: b.trackingNumber.trim() || null,
      items: b.items.filter((l) => l.sku.trim()).map((l) => ({ sku: l.sku.trim(), productId: l.productId, quantity: Math.max(1, Number(l.quantity) || 1) })),
    })),
  });

  const estKey = JSON.stringify({
    c: channel?.id ?? null, s: serviceId, p: packagingPct,
    boxes: boxes.map((b) => ({ w: b.emptyWeightKg, l: b.lengthCm, wd: b.widthCm, h: b.heightCm, items: b.items.filter((l) => l.sku.trim()).map((l) => ({ sku: l.sku.trim(), pid: l.productId, q: l.quantity })) })),
  });
  useEffect(() => {
    const input = buildInput();
    if (!input.boxes.some((b) => b.items.length)) { setEstimate(null); return; }
    let cancelled = false;
    setEstimating(true);
    const t = setTimeout(async () => {
      try {
        const res = await fbaShipmentsApi.estimate(input);
        if (!cancelled) setEstimate(res);
      } catch { if (!cancelled) setEstimate(null); }
      finally { if (!cancelled) setEstimating(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estKey]);

  // sku -> title lookup from the latest estimate.
  const titleMap = useMemo(() => {
    const m = new Map<string, string>();
    estimate?.boxes.forEach((b) => b.items.forEach((it) => { if (it.title) m.set(it.sku.toLowerCase(), it.title); }));
    return m;
  }, [estimate]);
  const titleFor = (sku: string) => titleMap.get(sku.trim().toLowerCase()) ?? null;

  const hasItems = boxes.some((b) => b.items.some((l) => l.sku.trim()));
  const canSave = useMemo(() => !!channel && !!serviceId && hasItems, [channel, serviceId, hasItems]);

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
    } finally { setBusy(false); }
  };

  const tabs = [
    { key: 'details', label: '1 · Boxes & SKUs' },
    { key: 'weight', label: '2 · Weight & cost' },
    { key: 'allocation', label: '3 · Cost allocation' },
  ];
  const destName = estimate?.destinationCountry?.name ?? (channel ? '—' : '');

  // When editing a shipment whose actual cost is registered, show the allocation against
  // that actual cost (the estimate preview is proportional by weight, so we scale it).
  const actualCost = editing && shipment?.actualCostEur != null ? shipment.actualCostEur : null;
  // Confirming settles the cost used for every order fulfilled from this shipment, so it needs a
  // real one. A shipment being created never has that yet — it arrives with the carrier's invoice —
  // so the only thing on offer here is a draft, and the cost is registered from the Shipments
  // worklist afterwards.
  const canConfirm = actualCost != null;
  const effectiveTotal = actualCost ?? estimate?.estimatedCostEur ?? null;
  const usingActual = actualCost != null;
  const allocScale = estimate?.estimatedCostEur && effectiveTotal != null ? effectiveTotal / estimate.estimatedCostEur : 1;
  const scaled = (v: number | null | undefined) => (v != null ? Math.round(v * allocScale * 10000) / 10000 : null);

  return (
    <ModalShell
      open
      title={editing ? 'Edit FBA shipment' : 'New FBA shipment'}
      subtitle={channel?.name ? `${channel.name}${destName && destName !== '—' ? ` · ${destName}` : ''}` : 'Ship stock to an Amazon fulfilment center'}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(k) => setTab(k as Tab)}
      dirty={dirty}
      primaryLabel={canConfirm ? 'Confirm shipment' : 'Save as draft'}
      onPrimary={() => save(canConfirm ? 'confirmed' : 'draft')}
      primaryDisabled={!canSave}
      secondaryLabel={canConfirm ? 'Save as draft' : undefined}
      onSecondary={canConfirm ? () => save('draft') : undefined}
      secondaryDisabled={!canSave}
      busy={busy}
      initialSize={{ w: 860, h: 660 }}
      onClose={onClose}
    >
      {tab === 'details' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
            <div><label className="label">Date</label><DatePicker value={date} onChange={(v) => { setDate(v); touch(); }} /></div>
            <div><label className="label">Sales channel</label><RefField value={channel} placeholder="Amazon US…" list={(q) => salesChannelsApi.list(q)} onChange={(v) => { setChannel(v); touch(); }} /></div>
            <div>
              <label className="label">Destination country <span className="font-normal text-n-400">(auto)</span></label>
              <input className="input" value={destName || ''} readOnly placeholder="From the sales channel" />
            </div>
            <div><label className="label">FBA Shipment ID</label><input className="input mono" value={fbaRef} onChange={(e) => { setFbaRef(e.target.value); touch(); }} placeholder="e.g. FBA15ABCXYZ" /></div>
          </div>

          <div className="flex flex-col gap-3">
            <label className="label mb-0">Boxes</label>
            {boxes.map((box, bi) => (
              <div key={bi} className="rounded-lg border border-n-200 bg-n-25/40 p-3">
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-n-800"><Boxes size={15} className="text-teal-600" /> Box {bi + 1}</span>
                  <div className="flex-1" />
                  {boxes.length > 1 && (
                    <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" title="Remove box" onClick={() => { setBoxes((r) => r.filter((_, i) => i !== bi)); touch(); }}><Trash2 size={15} /></button>
                  )}
                </div>
                <div className="mb-3 grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_1.4fr] gap-2 max-[680px]:grid-cols-2">
                  <Field label="Empty weight (kg)"><input className="input mono" inputMode="decimal" value={box.emptyWeightKg} onChange={(e) => setBox(bi, { emptyWeightKg: e.target.value })} placeholder="0.00" /></Field>
                  <Field label="L (cm)"><input className="input mono" inputMode="decimal" value={box.lengthCm} onChange={(e) => setBox(bi, { lengthCm: e.target.value })} placeholder="0" /></Field>
                  <Field label="W (cm)"><input className="input mono" inputMode="decimal" value={box.widthCm} onChange={(e) => setBox(bi, { widthCm: e.target.value })} placeholder="0" /></Field>
                  <Field label="H (cm)"><input className="input mono" inputMode="decimal" value={box.heightCm} onChange={(e) => setBox(bi, { heightCm: e.target.value })} placeholder="0" /></Field>
                  <Field label="Tracking number"><input className="input code" value={box.trackingNumber} onChange={(e) => setBox(bi, { trackingNumber: e.target.value })} placeholder="add later" /></Field>
                </div>

                <div className="rounded-md border border-n-200 bg-n-0">
                  <div className="grid grid-cols-[1fr_1fr_80px_32px] gap-2 rounded-t-md border-b border-n-200 bg-n-25 px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-n-500">
                    <span>SKU</span><span>Product</span><span className="text-right">Qty</span><span />
                  </div>
                  {box.items.map((l, li) => (
                    <div key={li} className="grid grid-cols-[1fr_1fr_80px_32px] items-center gap-2 border-b border-n-100 px-2.5 py-1.5 last:border-b-0">
                      <ProductSkuField value={{ productId: l.productId, sku: l.sku }} onChange={(v) => setItem(bi, li, v)} />
                      <span className="truncate text-[12.5px] text-n-700" title={titleFor(l.sku) ?? undefined}>
                        {titleFor(l.sku) ?? (l.sku.trim() ? <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle size={12} /> no product</span> : <span className="text-n-300">—</span>)}
                      </span>
                      <input className="input mono text-right" inputMode="numeric" value={l.quantity} onChange={(e) => setItem(bi, li, { quantity: e.target.value })} />
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setBoxes((r) => r.map((b, i) => (i === bi ? { ...b, items: b.items.filter((_, j) => j !== li) } : b))); touch(); }}><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <div className="px-2.5 py-1.5"><button className="text-[12.5px] font-medium text-teal-700 hover:underline" onClick={() => { setBoxes((r) => r.map((b, i) => (i === bi ? { ...b, items: [...b.items, emptyLine()] } : b))); touch(); }}>+ Add SKU to this box</button></div>
                </div>
              </div>
            ))}
            <div><button className="btn btn-ghost" onClick={() => { setBoxes((r) => [...r, emptyBox()]); touch(); }}><Plus size={16} /> Add box</button></div>
          </div>
        </div>
      )}

      {tab === 'weight' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
            <div>
              <label className="label">Shipping service</label>
              <Select
                value={serviceId ?? ''}
                onChange={(v) => { setServiceId(v || null); touch(); }}
                placeholder="— select —"
                options={services.map((s) => ({ value: s.id, label: `${s.name} (${s.calcMethod === 'actual_weight' ? 'actual' : 'volumetric'})` }))}
              />
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
            <Row label="Summed product weight" value={kg(estimate?.productWeightKg)} />
            <Row label="Empty boxes weight" value={kg(estimate?.emptyBoxesWeightKg)} />
            {isVolumetric && <Row label="Boxes volumetric weight (L×W×H ÷ 5000)" value={kg(estimate?.boxesVolumetricWeightKg)} />}
            <Row
              label={isActualWeight
                ? `Chargeable weight (products +${estimate?.packagingPct ?? packagingPct}% packaging + boxes)`
                : 'Chargeable weight (greater of volumetric / actual)'}
              value={kg(estimate?.chargeableWeightKg)}
            />
            <Row label="Rate band charge" value={eur(estimate?.estimatedCostEur)} strong />
          </div>

          {estimating && <p className="text-[12px] text-n-400">Calculating…</p>}
          {estimate?.warnings?.map((w, i) => (
            <p key={i} className="inline-flex items-start gap-1.5 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}</p>
          ))}
          <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
            {isActualWeight
              ? 'Actual-weight service: product weights are summed with the packaging uplift, the empty boxes weight is added, then rounded up to the next weight band to read the charge.'
              : service
                ? 'Volumetric service: charged on the greater of the boxes’ volumetric weight and the actual weight (products + boxes).'
                : 'Pick a shipping service to estimate the cost.'}
          </p>
        </div>
      )}

      {tab === 'allocation' && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-n-500">
            The {usingActual ? <><strong className="text-n-800">actual</strong> shipping cost ({eur(actualCost)})</> : 'estimated shipping cost'} is split across SKUs by weight share, then divided by quantity to give the cost per individual product.
            {!usingActual && ' Registering the actual cost later re-allocates these figures.'}
          </p>
          <div className="rounded-lg border border-n-200">
            <div className="grid grid-cols-[1fr_70px_100px_110px_120px] gap-2 rounded-t-lg border-b border-n-200 bg-n-25 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-n-500">
              <span>SKU</span><span className="text-right">Qty</span><span className="text-right">Weight</span><span className="text-right">{usingActual ? 'Allocated (actual)' : 'Allocated'}</span><span className="text-right">Per unit</span>
            </div>
            {(estimate?.allocation ?? []).length === 0 && <div className="px-3 py-6 text-center text-[13px] text-n-500">Add SKUs and pick a service to see the allocation.</div>}
            {(estimate?.allocation ?? []).map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_100px_110px_120px] gap-2 border-b border-n-100 px-3 py-2 text-[13px] last:border-b-0">
                <span className="code truncate text-n-800" title={it.title ?? undefined}>{it.sku}</span>
                <span className="mono text-right text-n-600">{it.quantity}</span>
                <span className="mono text-right text-n-600">{kg(it.lineWeightKg)}</span>
                <span className="mono text-right text-n-700">{eur(scaled(it.allocatedCostEur))}</span>
                <span className="mono text-right font-semibold text-n-900">{eur(scaled(it.allocatedCostPerUnitEur))}</span>
              </div>
            ))}
            {estimate && estimate.allocation.length > 0 && (
              <div className="grid grid-cols-[1fr_70px_100px_110px_120px] gap-2 bg-n-25 px-3 py-2 text-[13px] font-semibold">
                <span className="text-n-700">Total</span>
                <span className="mono text-right text-n-600">{estimate.allocation.reduce((s, it) => s + it.quantity, 0)}</span>
                <span />
                <span className="mono text-right text-n-900">{eur(effectiveTotal)}</span>
                <span />
              </div>
            )}
          </div>
          {usingActual && <p className="text-[12px] text-n-400">Estimated shipping cost was {eur(estimate?.estimatedCostEur)}; the registered actual is {eur(actualCost)}.</p>}
          <div><label className="label">Comments</label><input className="input" value={comments} onChange={(e) => { setComments(e.target.value); touch(); }} placeholder="Optional notes" /></div>
        </div>
      )}
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-n-500">{label}</div>
      {children}
    </div>
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

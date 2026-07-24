import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { salesTransactionsApi, shipmentsApi, shippingServicesApi, warehousesApi, type SalesTransaction } from '../../lib/api';

interface Props {
  transaction: SalesTransaction;
  onClose: () => void;
  onSaved: () => void;
}

type Resolution = 'none' | 'cancelled' | 'returned' | 'replaced';

const OPTIONS: { value: Resolution; label: string; hint: string }[] = [
  { value: 'none', label: 'No resolution (normal order)', hint: 'A standard completed sale.' },
  { value: 'cancelled', label: 'Cancelled', hint: 'Cancelled before shipment — financially neutral. Any reserved stock is released.' },
  { value: 'returned', label: 'Returned / refunded', hint: 'Refunded on a shipped order. The refund reverses revenue; product cost, fees and outbound shipping stay unless the goods come back.' },
  { value: 'replaced', label: 'Replaced', hint: 'A replacement was sent. The original may come back to stock.' },
];

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const todayIso = () => new Date().toISOString();

/**
 * Resolve a defective order. For a refund/return this is the operator's "return decision":
 * did the goods come back, into which warehouse (a not-sellable one keeps the cost as a loss),
 * and who paid return shipping. For FBA there is no warehouse — the goods go back to Amazon, so
 * we only capture whether Amazon re-listed the unit as sellable.
 */
export function ResolveTransactionModal({ transaction: t, onClose, onSaved }: Props) {
  const ccy = t.currency ?? 'EUR';
  const isFba = t.fulfilmentType === 'FBA';
  const [resolution, setResolution] = useState<Resolution>(t.resolution ?? 'none');
  const [refund, setRefund] = useState(t.refundAmount?.toString() ?? '');
  const [feeRefunded, setFeeRefunded] = useState(t.feeRefunded);
  const [notes, setNotes] = useState(t.resolutionNotes ?? '');
  // Return decision
  const [returned, setReturned] = useState(!!t.returnWarehouseId || (isFba && t.restockItems));
  const [returnWarehouseId, setReturnWarehouseId] = useState(t.returnWarehouseId ?? '');
  // Return shipping (FBM, company-borne) → recorded as an inbound shipment
  const [weBearReturn, setWeBearReturn] = useState(false);
  const [returnService, setReturnService] = useState('');
  const [returnTracking, setReturnTracking] = useState('');
  const [returnCost, setReturnCost] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() });
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  const orderValueNative = t.totals.netSales + t.totals.shipping;
  const showReturnDecision = resolution === 'returned' || resolution === 'replaced';
  const chosenWarehouse = warehouses.find((w) => w.id === returnWarehouseId);
  const resellable = isFba ? returned : returned && !!chosenWarehouse?.includeInInventory;

  const save = async () => {
    if (showReturnDecision && returned && !isFba && !returnWarehouseId) {
      toast.error('Choose the warehouse the returned goods go into');
      return;
    }
    setBusy(true);
    try {
      await salesTransactionsApi.resolve(t.id, {
        resolution,
        refundAmount: resolution === 'none' ? null : numOrNull(refund),
        feeRefunded,
        resolutionNotes: notes.trim() || null,
        returnedToStock: showReturnDecision ? returned : false,
        returnWarehouseId: showReturnDecision && returned && !isFba ? returnWarehouseId : null,
      });
      // Company-borne return shipping is a real cost — book it as an inbound shipment (FBM only).
      if (showReturnDecision && returned && !isFba && weBearReturn && (numOrNull(returnCost) != null || returnService || returnTracking)) {
        await shipmentsApi.create({
          transactionId: t.id,
          type: 'inbound',
          shipmentDate: todayIso(),
          costBorneBy: 'company',
          shippingServiceId: returnService || null,
          trackingNumber: returnTracking.trim() || null,
          shippingCostEur: numOrNull(returnCost),
        });
      }
      toast.success(resolution === 'none' ? 'Resolution cleared' : 'Resolution applied');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const active = OPTIONS.find((o) => o.value === resolution)!;

  return (
    <ModalShell
      open
      title="Resolve / Return"
      subtitle={t.transactionRef}
      dirty={dirty}
      primaryLabel="Apply"
      onPrimary={save}
      busy={busy}
      onClose={onClose}
      initialSize={{ w: 620, h: 640 }}
    >
      <div className="flex flex-col gap-5">
        {t.resolutionSource === 'amazon' && !t.returnHandled && (
          <p className="rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
            Pulled from Amazon — needs your return decision below.
          </p>
        )}

        <div>
          <label className="label">Resolution</label>
          <div className="flex flex-col gap-2">
            {OPTIONS.map((o) => (
              <label key={o.value} className={`flex cursor-pointer gap-2.5 rounded-md border p-2.5 ${resolution === o.value ? 'border-teal-300 bg-teal-50/50' : 'border-n-200'}`}>
                <input type="radio" name="resolution" className="mt-0.5 accent-[var(--teal-500)]" checked={resolution === o.value} onChange={() => { setResolution(o.value); touch(); }} />
                <span>
                  <span className="block text-[13.5px] font-medium text-n-800">{o.label}</span>
                  <span className="block text-[11.5px] text-n-500">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {resolution !== 'none' && resolution !== 'cancelled' && (
          <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
            <div>
              <label className="label">Refund amount <span className="font-normal text-n-400">(exc. VAT, {ccy})</span></label>
              <input className="input mono" inputMode="decimal" value={refund} onChange={(e) => { setRefund(e.target.value); touch(); }} placeholder={orderValueNative ? orderValueNative.toFixed(2) : '0.00'} />
              <p className="mt-1 text-[11px] text-n-400">Revenue given back (net + shipping). Full order ≈ {ccy} {orderValueNative.toFixed(2)}.</p>
            </div>
            <label className="flex items-center gap-2.5 self-end pb-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={feeRefunded} onChange={(e) => { setFeeRefunded(e.target.checked); touch(); }} />
              <span className="text-[13px] text-n-700">Channel refunded its selling fee</span>
            </label>
          </div>
        )}

        {showReturnDecision && (
          <div className="rounded-lg border border-n-200 bg-n-25 p-3.5">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]" checked={returned} onChange={(e) => { setReturned(e.target.checked); touch(); }} />
              <span>
                <span className="block text-[13.5px] font-semibold text-n-800">The product was returned{isFba ? ' to Amazon' : ' to us'}</span>
                <span className="block text-[11.5px] text-n-500">
                  {isFba
                    ? 'FBA goods go back to Amazon. Tick only if Amazon graded it sellable and re-listed it.'
                    : 'Choose which warehouse it goes into — a not-sellable location keeps the cost as a loss.'}
                </span>
              </span>
            </label>

            {returned && !isFba && (
              <div className="mt-3 pl-7">
                <label className="label">Return into warehouse</label>
                <Select
                  value={returnWarehouseId}
                  onChange={(v) => { setReturnWarehouseId(v); touch(); }}
                  placeholder="— choose a warehouse"
                  options={warehouses.map((w) => ({ value: w.id, label: `${w.name}${w.includeInInventory ? '' : ' (not sellable)'}` }))}
                />
                {chosenWarehouse && (
                  <p className={`mt-1 text-[11.5px] ${resellable ? 'text-teal-700' : 'text-warning'}`}>
                    {resellable ? 'Resellable — product cost is reversed and the unit returns to available stock.' : 'Not sellable — the unit is tracked here but the product cost stays as a loss.'}
                  </p>
                )}
              </div>
            )}

            {returned && isFba && (
              <p className="mt-2 pl-7 text-[11.5px] text-teal-700">Amazon re-listed it — product cost is reversed. No stock moves in your warehouses.</p>
            )}

            {returned && !isFba && (
              <div className="mt-3 border-t border-n-200 pt-3 pl-7">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={weBearReturn} onChange={(e) => { setWeBearReturn(e.target.checked); touch(); }} />
                  <span className="text-[13px] font-medium text-n-700">We pay the return shipping</span>
                </label>
                {weBearReturn && (
                  <div className="mt-2 grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
                    <div>
                      <label className="label">Shipping service</label>
                      <Select value={returnService} onChange={(v) => { setReturnService(v); touch(); }} placeholder="— service" options={services.map((s) => ({ value: s.id, label: s.name }))} />
                    </div>
                    <div>
                      <label className="label">Cost (EUR)</label>
                      <input className="input mono" inputMode="decimal" value={returnCost} onChange={(e) => { setReturnCost(e.target.value); touch(); }} placeholder="0.00" />
                    </div>
                    <div className="col-span-2 max-[560px]:col-span-1">
                      <label className="label">Tracking number</label>
                      <input className="input" value={returnTracking} onChange={(e) => { setReturnTracking(e.target.value); touch(); }} placeholder="Optional" />
                    </div>
                    <p className="col-span-2 text-[11px] text-n-400 max-[560px]:col-span-1">Recorded as an inbound shipment and added to this order's costs.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="label">Notes</label>
          <input className="input" value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} placeholder="Optional context" />
        </div>

        <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">{active.hint}</p>
      </div>
    </ModalShell>
  );
}

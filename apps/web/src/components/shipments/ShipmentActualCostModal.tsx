import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { shipmentsApi, type Shipment } from '../../lib/api';

interface Props {
  shipment: Shipment;
  onClose: () => void;
  onSaved: () => void;
}

/** Empty means "not recorded" and is stored as null; a typed 0 is a real figure and is stored as 0. */
function parseAmount(raw: string): { ok: true; value: number | null } | { ok: false } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

const money = (v: number | null | undefined) => (v != null ? String(v) : '');

/**
 * Register what the carrier actually charged for a shipment.
 *
 * Where several orders travelled in one parcel group the carrier billed per tracking number, so
 * this asks per tracking number rather than for one total. An even split would be a guess dressed
 * as a fact — and with two parcels to different countries, a badly wrong one.
 */
export function ShipmentActualCostModal({ shipment, onClose, onSaved }: Props) {
  const group = useQuery({
    queryKey: ['shipment-cost-group', shipment.id],
    queryFn: () => shipmentsApi.costGroup(shipment.id),
  });

  /** Per parcel: { shipping, duty } as typed. Keyed by shipment id. */
  const [values, setValues] = useState<Record<string, { shipping: string; duty: string }>>({});
  useEffect(() => {
    if (!group.data) return;
    setValues(
      Object.fromEntries(
        group.data.parcels.map((p) => [p.shipmentId, { shipping: money(p.shippingCostEur), duty: money(p.dutyImportEur) }]),
      ),
    );
  }, [group.data]);

  const save = useMutation({
    mutationFn: (entries: Array<{ shipmentId: string; shippingCostEur: number | null; dutyImportEur: number | null }>) =>
      shipmentsApi.setActualCosts(entries),
    onSuccess: (r) => {
      toast.success(r.updated === 1 ? 'Actual cost registered' : `Actual cost registered for ${r.updated} parcels`);
      onSaved();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const parcels = group.data?.parcels ?? [];
  const multi = parcels.length > 1;
  const busy = save.isPending;
  /** Any parcel already signed off — saying so up front beats a tick silently disappearing. */
  const reviewedCount = parcels.filter((p) => p.reviewed).length;

  const submit = () => {
    const entries: Array<{ shipmentId: string; shippingCostEur: number | null; dutyImportEur: number | null }> = [];
    for (const p of parcels) {
      const v = values[p.shipmentId] ?? { shipping: '', duty: '' };
      const shipping = parseAmount(v.shipping);
      const duty = parseAmount(v.duty);
      if (!shipping.ok || !duty.ok) {
        toast.error(`Enter a valid amount for ${p.trackingNumber ?? 'this parcel'}`);
        return;
      }
      entries.push({ shipmentId: p.shipmentId, shippingCostEur: shipping.value, dutyImportEur: duty.value });
    }
    if (entries.length === 0) return;
    save.mutate(entries);
  };

  const set = (id: string, field: 'shipping' | 'duty', v: string) =>
    setValues((s) => ({ ...s, [id]: { ...(s[id] ?? { shipping: '', duty: '' }), [field]: v } }));

  const total = parcels.reduce((t, p) => {
    const n = Number((values[p.shipmentId]?.shipping ?? '').trim());
    return t + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-[520px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">Register Actual Shipping Cost</h2>
          <p className="mt-0.5 text-[12.5px] text-n-500">
            {shipment.transactionRef ?? 'Shipment'}
            {shipment.salesChannel?.name ? ` · ${shipment.salesChannel.name}` : ''}
            {multi ? ` · ${parcels.length} tracking numbers` : ''}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {group.isLoading && (
            <div className="flex items-center gap-2 py-6 text-[13px] text-n-500">
              <Loader2 size={15} className="animate-spin" /> Loading the parcels this cost covers…
            </div>
          )}
          {group.isError && <p className="py-6 text-[13px] text-danger">Could not load this shipment's parcels.</p>}

          {multi && (
            <p className="mb-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-violet-800">
              These orders shipped together as one parcel group. Enter what the carrier charged against
              each tracking number — the figures stay separate rather than one total being divided, so
              each order carries its own real cost.
            </p>
          )}

          {parcels.map((p, i) => (
            <div key={p.shipmentId} className={i > 0 ? 'mt-4 border-t border-n-100 pt-4' : ''}>
              {multi && (
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="code text-[12.5px] font-semibold text-n-800">{p.trackingNumber ?? 'No tracking number'}</span>
                  <span className="text-[12px] text-n-500">{p.transactionRef ?? '—'}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Shipping cost <span className="font-normal text-n-400">(exc. VAT, €)</span></label>
                  <input
                    autoFocus={i === 0}
                    className="input mono"
                    inputMode="decimal"
                    value={values[p.shipmentId]?.shipping ?? ''}
                    onChange={(e) => set(p.shipmentId, 'shipping', e.target.value)}
                    placeholder="0.00"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
                  />
                </div>
                <div>
                  <label className="label">Duty / import <span className="font-normal text-n-400">(exc. VAT, €)</span></label>
                  <input
                    className="input mono"
                    inputMode="decimal"
                    value={values[p.shipmentId]?.duty ?? ''}
                    onChange={(e) => set(p.shipmentId, 'duty', e.target.value)}
                    placeholder="0.00"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
                  />
                </div>
              </div>
            </div>
          ))}

          {multi && total > 0 && (
            <p className="mt-3 text-right text-[12.5px] text-n-500">
              Shipping across the group: <span className="mono font-semibold text-n-800">€{total.toFixed(2)}</span>
            </p>
          )}

          {parcels.length > 0 && (
            <p className="mt-3 text-[12px] text-n-500">
              These replace the shipping estimate used in profit. Leave duty blank if the customs bill
              has not arrived — it can be added later without re-entering the shipping cost.
            </p>
          )}

          {reviewedCount > 0 && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              {reviewedCount === 1 ? 'This cost has been' : `${reviewedCount} of these have been`} reviewed by
              accounting. Saving withdraws that review — the sign-off was given for the figure recorded
              at the time, so it has to be given again for a new one.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-n-200 px-5 py-3.5">
          <button className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50" onClick={() => !busy && onClose()}>Cancel</button>
          <button
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            disabled={busy || parcels.length === 0}
            onClick={submit}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Saving…' : multi ? `Save ${parcels.length} costs` : 'Save cost'}
          </button>
        </div>
      </div>
    </div>
  );
}

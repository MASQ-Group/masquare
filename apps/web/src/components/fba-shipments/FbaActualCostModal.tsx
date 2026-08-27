import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fbaShipmentsApi, type FbaShipment } from '../../lib/api';

const eur = (v: number | null | undefined) => (v != null ? `€${v.toFixed(2)}` : '—');

interface Props {
  shipment: FbaShipment;
  /** Extra context line under the title (e.g. where it was opened from). */
  contextLine?: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Register the actual FBA shipping cost. Writes the shipment's actualCostEur (the same
 *  field shown in the FBA module) and re-allocates the per-SKU cost. Shared by the FBA
 *  Shipments page and the Shipments module. */
export function FbaActualCostModal({ shipment, contextLine, onClose, onSaved }: Props) {
  const [value, setValue] = useState(shipment.actualCostEur != null ? String(shipment.actualCostEur) : '');
  // Registering the cost is what permits confirming, so the operator does both in one action.
  const [confirmToo, setConfirmToo] = useState(shipment.status !== 'confirmed');
  const save = useMutation({
    mutationFn: (amount: number) => fbaShipmentsApi.setActualCost(shipment.id, amount, confirmToo),
    onSuccess: () => {
      toast.success(confirmToo ? 'Cost registered and shipment confirmed' : 'Actual cost registered — allocation updated');
      onSaved();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });
  const busy = save.isPending;
  const submit = () => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) { toast.error('Enter a valid amount'); return; }
    save.mutate(amount);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-[440px] max-w-full rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">Register Actual Shipping Cost</h2>
          <p className="mt-0.5 text-[12.5px] text-n-500">{shipment.fbaShipmentRef ?? 'FBA shipment'}{contextLine ? ` · ${contextLine}` : ''} · estimate {eur(shipment.estimatedCostEur)}</p>
        </div>
        <div className="px-5 py-4">
          <label className="label">Actual cost <span className="font-normal text-n-400">(exc. VAT, €)</span></label>
          <input autoFocus className="input mono" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }} />
          <p className="mt-2 text-[12px] text-n-500">This is the shipment's actual shipping cost. It overrides the estimate in the FBA module and re-allocates the cost across the shipment's SKUs by weight.</p>
          {shipment.status !== 'confirmed' && (
            <label className="mt-3 flex items-start gap-2 rounded-md border border-n-200 bg-n-25 p-2.5 text-[12.5px] text-n-700">
              <input type="checkbox" className="mt-0.5" checked={confirmToo} onChange={(e) => setConfirmToo(e.target.checked)} />
              <span>
                Confirm the shipment as well
                <span className="mt-0.5 block text-[11.5px] text-n-500">
                  It leaves the FBA worklist and joins All shipments. A shipment cannot be confirmed
                  without an actual cost, since confirming sets the cost used for every order fulfilled
                  from it.
                </span>
              </span>
            </label>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-n-200 px-5 py-3.5">
          <button className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50" onClick={() => !busy && onClose()}>Cancel</button>
          <button className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save cost'}</button>
        </div>
      </div>
    </div>
  );
}

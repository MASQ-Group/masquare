import { useState } from 'react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { salesTransactionsApi, type SalesTransaction } from '../../lib/api';

interface Props {
  transaction: SalesTransaction;
  onClose: () => void;
  onSaved: () => void;
}

type Resolution = 'none' | 'cancelled' | 'returned' | 'replaced';

const OPTIONS: { value: Resolution; label: string; hint: string }[] = [
  { value: 'none', label: 'No resolution (normal order)', hint: 'Standard completed sale.' },
  { value: 'cancelled', label: 'Cancelled', hint: 'Order cancelled + refunded. If it never shipped, product cost and shipping are excluded; if it shipped, outbound shipping stays and stock returns.' },
  { value: 'returned', label: 'Returned / refunded', hint: 'Customer returned the item or was refunded. Refund reverses revenue; outbound shipping already spent stays.' },
  { value: 'replaced', label: 'Replaced', hint: 'Replacement sent (record the replacement as a second outbound shipment). Original may return to stock.' },
];

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

export function ResolveTransactionModal({ transaction: t, onClose, onSaved }: Props) {
  const ccy = t.currency ?? 'EUR';
  const [resolution, setResolution] = useState<Resolution>(t.resolution ?? 'none');
  const [refund, setRefund] = useState(t.refundAmount?.toString() ?? '');
  const [restock, setRestock] = useState(t.restockItems);
  const [feeRefunded, setFeeRefunded] = useState(t.feeRefunded);
  const [notes, setNotes] = useState(t.resolutionNotes ?? '');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  const orderValueNative = t.totals.netSales + t.totals.shipping;

  const save = async () => {
    setBusy(true);
    try {
      await salesTransactionsApi.resolve(t.id, {
        resolution,
        refundAmount: resolution === 'none' ? null : numOrNull(refund),
        restockItems: restock,
        feeRefunded,
        resolutionNotes: notes.trim() || null,
      });
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
      title="Resolve transaction"
      subtitle={t.transactionRef}
      dirty={dirty}
      primaryLabel="Apply resolution"
      onPrimary={save}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
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

        {resolution !== 'none' && (
          <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
            <div>
              <label className="label">Refund amount <span className="font-normal text-n-400">(exc. VAT, {ccy})</span></label>
              <input className="input mono" inputMode="decimal" value={refund} onChange={(e) => { setRefund(e.target.value); touch(); }} placeholder={orderValueNative ? orderValueNative.toFixed(2) : '0.00'} />
              <p className="mt-1 text-[11px] text-n-400">Our revenue given back (net + shipping). Full order value ≈ {ccy} {orderValueNative.toFixed(2)}.</p>
            </div>
            <div className="flex flex-col justify-center gap-2.5">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={restock} onChange={(e) => { setRestock(e.target.checked); touch(); }} />
                <span className="text-[13px] text-n-700">Item(s) returned resellable <span className="text-n-400">— reverses product cost</span></span>
              </label>
              <label className="flex cursor-pointer items-center gap-2.5">
                <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={feeRefunded} onChange={(e) => { setFeeRefunded(e.target.checked); touch(); }} />
                <span className="text-[13px] text-n-700">Channel refunded its selling fee</span>
              </label>
            </div>
            <div className="col-span-2 max-[560px]:col-span-1">
              <label className="label">Notes</label>
              <input className="input" value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} placeholder="Optional context" />
            </div>
          </div>
        )}

        <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">{active.hint} Record any return/replacement shipping in the Shipments section (inbound, cost borne by company or customer).</p>
      </div>
    </ModalShell>
  );
}

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { vendorReturnsApi, warehousesApi, type ReturnableLine } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';

const eur = (v: number | null | undefined) => (v == null ? '—' : `€${v.toFixed(2)}`);

interface Props {
  purchaseOrderId: string;
  poNumber: string;
  vendorId: string;
  onClose: () => void;
  onPosted: () => void;
}

/**
 * Send received goods back to the vendor.
 *
 * Quantities are capped at what each line actually received less anything already sent
 * back, so the form cannot express a return that the server would reject.
 */
export function ReturnToVendorModal({ purchaseOrderId, poNumber, vendorId, onClose, onPosted }: Props) {
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ['returnable', purchaseOrderId],
    queryFn: () => vendorReturnsApi.returnable(purchaseOrderId),
  });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() });

  const [qty, setQty] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('');
  const [creditNoteRef, setCreditNoteRef] = useState('');
  const [notes, setNotes] = useState('');

  const lines = (data?.lines ?? []).filter((l) => l.returnable > 0);
  const effectiveWarehouse = warehouseId || data?.warehouseId || '';

  const totals = useMemo(() => {
    let units = 0;
    let value = 0;
    for (const l of lines) {
      const n = Number(qty[l.purchaseOrderLineId] || 0);
      if (n > 0) {
        units += n;
        value += n * (l.averageCostEur ?? 0);
      }
    }
    return { units, value: Number(value.toFixed(2)) };
  }, [qty, lines]);

  const post = useMutation({
    mutationFn: () =>
      vendorReturnsApi.create({
        vendorId,
        purchaseOrderId,
        warehouseId: effectiveWarehouse,
        reason: reason.trim(),
        creditNoteRef: creditNoteRef.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines
          .filter((l) => Number(qty[l.purchaseOrderLineId] || 0) > 0)
          .map((l) => ({
            productId: l.productId,
            purchaseOrderLineId: l.purchaseOrderLineId,
            quantity: Number(qty[l.purchaseOrderLineId]),
          })),
      }),
    onSuccess: (r) => {
      toast.success(`${r.returnNumber} posted — ${r.totalQuantity} unit${r.totalQuantity === 1 ? '' : 's'} returned`);
      onPosted();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not post the return'),
  });

  const canPost = totals.units > 0 && !!effectiveWarehouse && reason.trim().length > 0;

  return (
    <ModalShell
      open
      title="Return to Vendor"
      subtitle={poNumber}
      dirty={totals.units > 0}
      primaryLabel={post.isPending ? 'Submitting…' : `Submit${totals.units ? ` (${totals.units})` : ''}`}
      onPrimary={async () => { if (canPost && await confirm({ title: 'Submit this return to vendor?', message: 'It removes the stock and reopens the purchase order.', confirmLabel: 'Submit' })) post.mutate(); }}
      primaryDisabled={!canPost}
      busy={post.isPending}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-n-600">
          Stock leaves at its current average cost, so the cost of the units you keep is unchanged. The order reopens if
          this takes it below what was ordered.
        </p>

        {isLoading ? (
          <div className="py-6 text-center text-[13px] text-n-400">Loading…</div>
        ) : !lines.length ? (
          <div className="rounded-md border border-n-200 bg-n-25 px-4 py-6 text-center text-[13px] text-n-500">
            Nothing on this order is available to return.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-n-200">
            <div className="flex items-center gap-3 border-b border-n-200 bg-n-25 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-n-500">
              <span className="flex-1">Product</span>
              <span className="w-20 text-right">Received</span>
              <span className="w-24 text-right">Avg cost</span>
              <span className="w-24 text-right">Return</span>
            </div>
            {lines.map((l: ReturnableLine) => (
              <div key={l.purchaseOrderLineId} className="flex items-center gap-3 border-b border-n-100 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="code text-[12px] text-teal-700">{l.sku}</div>
                  <div className="truncate text-[13px] text-n-800">{l.productName}</div>
                </div>
                <div className="mono w-20 text-right text-[13px] text-n-600">
                  {l.returnable}
                  {l.quantityReturned > 0 && <span className="block text-[11px] text-n-400">{l.quantityReturned} sent back</span>}
                </div>
                <div className="mono w-24 text-right text-[13px] text-n-600">{eur(l.averageCostEur)}</div>
                <div className="w-24">
                  <input
                    className="input mono text-right"
                    inputMode="numeric"
                    placeholder="0"
                    value={qty[l.purchaseOrderLineId] ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      // Cap at what is actually returnable so the form can't build an invalid return.
                      const capped = raw === '' ? '' : String(Math.min(Number(raw), l.returnable));
                      setQty((s) => ({ ...s, [l.purchaseOrderLineId]: capped }));
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3 bg-n-25 px-4 py-2.5">
              <span className="flex-1 text-[12.5px] font-semibold text-n-600">Returning</span>
              <span className="mono w-20 text-right text-[13px] font-semibold text-n-800">{totals.units}</span>
              <span className="mono w-24 text-right text-[13px] font-semibold text-n-800">{eur(totals.value)}</span>
              <span className="w-24" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <div>
            <label className="label">From warehouse *</label>
            <Select
              value={effectiveWarehouse}
              onChange={setWarehouseId}
              placeholder="— select"
              options={warehouses.filter((w) => w.includeInInventory).map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
          <div>
            <label className="label">Credit note <span className="font-normal text-n-400">(optional)</span></label>
            <input className="input code" value={creditNoteRef} onChange={(e) => setCreditNoteRef(e.target.value)} placeholder="e.g. CN-1042" />
          </div>
          <div className="col-span-2 max-[560px]:col-span-1">
            <label className="label">Reason *</label>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged on arrival, wrong item shipped" />
          </div>
          <div className="col-span-2 max-[560px]:col-span-1">
            <label className="label">Notes <span className="font-normal text-n-400">(optional)</span></label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

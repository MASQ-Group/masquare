import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { purchaseOrdersApi, type Product, type PurchaseOrder } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';
import { ProductSkuField } from '../sales/ProductSkuField';

interface Row {
  purchaseOrderLineId?: string;
  productId: string | null;
  sku: string;
  quantityOrdered: string;
  quantityReceived: number;
  unitCost: string;
}

/**
 * Admin amendment of an order that has already been received.
 *
 * Received quantities are shown and enforced as the floor: the form will not let an
 * ordered quantity go below what physically arrived, because those goods leave through a
 * return, not by rewriting the order.
 */
export function AmendOrderModal({ po, onClose, onDone }: { po: PurchaseOrder; onClose: () => void; onDone: () => void }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>(
    po.lines.map((l) => ({
      purchaseOrderLineId: l.id,
      productId: l.productId,
      sku: l.sku ?? '',
      quantityOrdered: String(l.quantityOrdered),
      quantityReceived: l.quantityReceived ?? 0,
      unitCost: String(l.unitCost),
    })),
  );
  const [note, setNote] = useState('');

  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const amend = useMutation({
    mutationFn: () =>
      purchaseOrdersApi.amend(po.id, {
        lines: rows
          .filter((r) => r.productId && Number(r.quantityOrdered) > 0)
          .map((r) => ({
            purchaseOrderLineId: r.purchaseOrderLineId,
            productId: r.productId!,
            quantityOrdered: Number(r.quantityOrdered),
            unitCost: Number(r.unitCost || 0),
          })),
        note: note.trim() || undefined,
      }),
    onSuccess: (r) => {
      toast.success(`${r.poNumber} amended — now ${r.status.replace('_', ' ')}`);
      onDone();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not amend the order'),
  });

  // Mirrors the server rule, so the problem is visible before the request is sent.
  const belowReceived = rows.filter((r) => r.purchaseOrderLineId && Number(r.quantityOrdered) < r.quantityReceived);
  const canSave = rows.some((r) => r.productId && Number(r.quantityOrdered) > 0) && !belowReceived.length;

  return (
    <ModalShell
      open
      title="Amend Purchase Order"
      subtitle={po.poNumber}
      dirty
      primaryLabel={amend.isPending ? 'Submitting…' : 'Submit'}
      onPrimary={async () => { if (canSave && await confirm({ title: 'Submit this amendment?', message: 'It restates the received order with the new quantities and costs.', confirmLabel: 'Submit' })) amend.mutate(); }}
      primaryDisabled={!canSave}
      busy={amend.isPending}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-n-600">
          Quantities can go up, or down as far as what has already arrived. Anything already received stays received —
          posted goods receipts are never rewritten. Newly outstanding units get a fresh goods receipt.
        </p>

        <div className="overflow-hidden rounded-lg border border-n-200">
          <div className="flex items-center gap-3 border-b border-n-200 bg-n-25 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-n-500">
            <span className="flex-1">Product</span>
            <span className="w-20 text-right">Received</span>
            <span className="w-24 text-right">Ordered</span>
            <span className="w-28 text-right">Unit cost</span>
            <span className="w-8" />
          </div>
          {rows.map((r, i) => {
            const bad = r.purchaseOrderLineId && Number(r.quantityOrdered) < r.quantityReceived;
            return (
              <div key={r.purchaseOrderLineId ?? `new-${i}`} className="flex items-center gap-3 border-b border-n-100 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  {r.purchaseOrderLineId ? (
                    <>
                      <div className="code text-[12px] text-teal-700">{r.sku}</div>
                      {r.quantityReceived > 0 && <div className="text-[11px] text-n-400">received — cannot be removed</div>}
                    </>
                  ) : (
                    <ProductSkuField
                      value={{ productId: r.productId, sku: r.sku }}
                      onChange={(v) => setRow(i, v)}
                      onPick={(p: Product) => setRow(i, { unitCost: p.purchaseCost.amount != null ? String(p.purchaseCost.amount) : '' })}
                      autoSelectExact
                    />
                  )}
                </div>
                <div className="mono w-20 text-right text-[13px] text-n-500">{r.quantityReceived}</div>
                <div className="w-24">
                  <input
                    className={`input mono text-right ${bad ? 'border-danger' : ''}`}
                    inputMode="numeric"
                    value={r.quantityOrdered}
                    onChange={(e) => setRow(i, { quantityOrdered: e.target.value.replace(/[^0-9]/g, '') })}
                  />
                </div>
                <div className="w-28">
                  <input
                    className="input mono text-right"
                    inputMode="decimal"
                    value={r.unitCost}
                    onChange={(e) => setRow(i, { unitCost: e.target.value })}
                  />
                </div>
                <div className="w-8 text-right">
                  {r.quantityReceived === 0 && (
                    <button
                      className="text-n-400 hover:text-danger"
                      title="Remove line"
                      onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button
          className="inline-flex h-9 w-fit items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-semibold text-n-700 hover:bg-n-25"
          onClick={() => setRows((r) => [...r, { productId: null, sku: '', quantityOrdered: '1', quantityReceived: 0, unitCost: '' }])}
        >
          <Plus size={15} /> Add item
        </button>

        {!!belowReceived.length && (
          <div className="rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
            {belowReceived.map((r) => `${r.sku}: ${r.quantityReceived} already received`).join(' · ')} — raise a return to
            the vendor for the surplus instead of ordering fewer.
          </div>
        )}

        <div>
          <label className="label">Note <span className="font-normal text-n-400">(recorded in the order history)</span></label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. vendor confirmed 4 more units" />
        </div>
      </div>
    </ModalShell>
  );
}

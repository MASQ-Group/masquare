import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { goodsReceiptsApi, productsApi, warehousesApi, type GoodsReceipt } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';

/** Serials are typed one per line, but commas are a natural paste format too. */
const splitSerials = (raw: string | undefined) =>
  (raw ?? '')
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

interface Props {
  receiptId: string;
  onClose: () => void;
  onPosted: () => void;
}

/**
 * Receiving desk for one goods receipt: enter what actually arrived per line, pick the
 * warehouse it lands in, and post. A short delivery raises a backorder automatically
 * unless the user closes the order short.
 */
export function ReceiveModal({ receiptId, onClose, onPosted }: Props) {
  const confirm = useConfirm();
  const { data: receipt, isLoading } = useQuery({ queryKey: ['goods-receipt', receiptId], queryFn: () => goodsReceiptsApi.get(receiptId) });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() });

  const [qty, setQty] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState('');
  const [closeShort, setCloseShort] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** Serial codes per receipt line, for serial-tracked products only. */
  const [serials, setSerials] = useState<Record<string, string>>({});

  // Which lines need serials — the products API knows, so ask once per receipt.
  const { data: trackedIds = new Set<string>() } = useQuery({
    queryKey: ['serial-tracked', receipt?.id],
    enabled: !!receipt,
    queryFn: async () => {
      const ids = [...new Set((receipt?.lines ?? []).map((l: any) => l.productId).filter(Boolean))] as string[];
      const full = await Promise.all(ids.map((id) => productsApi.get(id)));
      return new Set(full.filter((p) => p.serialTracked).map((p) => p.id));
    },
  });

  // Default to the full expected quantity — the common case is a complete delivery.
  useEffect(() => {
    if (!receipt) return;
    setQty(Object.fromEntries(receipt.lines.map((l) => [l.id, String(l.quantityExpected)])));
    setWarehouseId(receipt.destinationWarehouse?.id ?? receipt.purchaseOrder?.destinationWarehouseId ?? '');
  }, [receipt]);

  const lines = receipt?.lines ?? [];
  const totals = useMemo(() => {
    let received = 0, expected = 0, over = 0;
    for (const l of lines) {
      const v = Number(qty[l.id]) || 0;
      received += v;
      expected += l.quantityExpected;
      const outstanding = l.quantityOrdered - l.quantityAlreadyReceived;
      if (v > outstanding) over += v - outstanding;
    }
    return { received, expected, over, short: Math.max(0, expected - received) };
  }, [lines, qty]);

  const setLineQty = (id: string, v: string) => { setQty((q) => ({ ...q, [id]: v })); setDirty(true); };
  const receiveAll = () => {
    setQty(Object.fromEntries(lines.map((l) => [l.id, String(l.quantityExpected)])));
    setDirty(true);
  };

  const post = async () => {
    if (!warehouseId) { toast.error('Choose the warehouse the goods land in'); return; }
    if (totals.received <= 0) { toast.error('Enter at least one received quantity'); return; }
    const overWarn = totals.over > 0 ? ` This is ${totals.over} more unit${totals.over === 1 ? '' : 's'} than were ordered.` : '';
    if (!(await confirm({
      title: 'Submit this goods receipt?',
      message: `It adds the received quantities to stock and updates the order.${overWarn}`,
      confirmLabel: 'Submit',
    }))) return;

    setBusy(true);
    try {
      const res = await goodsReceiptsApi.post(receiptId, {
        lines: lines.map((l) => ({
          lineId: l.id,
          quantityReceived: Number(qty[l.id]) || 0,
          ...(trackedIds.has((l as any).productId)
            ? { serials: splitSerials(serials[l.id]) }
            : {}),
        })),
        destinationWarehouseId: warehouseId,
        allowOverReceipt: totals.over > 0,
        closeShort,
        notes: notes.trim() || null,
      });
      toast.success(
        res.backorder
          ? `${res.receiptNumber} posted — backorder ${res.backorder.receiptNumber} raised for ${res.shortfall} unit${res.shortfall === 1 ? '' : 's'}`
          : res.closedShort
            ? `${res.receiptNumber} posted — order closed short by ${res.shortfall} unit${res.shortfall === 1 ? '' : 's'}`
            : `${res.receiptNumber} posted — stock updated`,
      );
      onPosted();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not post the receipt');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title={receipt ? `Receive ${receipt.receiptNumber}` : 'Receive goods'}
      subtitle={receipt ? `${receipt.purchaseOrder?.poNumber ?? ''} · ${receipt.purchaseOrder?.vendor?.name ?? ''}${receipt.isBackorder ? ' · backorder' : ''}` : undefined}
      dirty={dirty}
      primaryLabel={busy ? 'Submitting…' : 'Submit'}
      onPrimary={post}
      primaryDisabled={isLoading || busy}
      busy={busy}
      onClose={onClose}
      initialSize={{ w: 780, h: 600 }}
    >
      {isLoading || !receipt ? (
        <div className="py-10 text-center text-[13px] text-n-500">Loading…</div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 items-start gap-4 max-[560px]:grid-cols-1">
            <div>
              <label className="label">Receive into</label>
              <Select
                value={warehouseId}
                onChange={(v) => { setWarehouseId(v); setDirty(true); }}
                placeholder="— choose a warehouse"
                options={warehouses.filter((w) => w.includeInInventory).map((w) => ({ value: w.id, label: w.name }))}
              />
            </div>
            <div className="flex items-end justify-end pb-0.5">
              <button
                type="button"
                onClick={receiveAll}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-semibold text-n-700 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700"
              >
                <PackageCheck size={15} /> Receive all
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="grid gap-3 border-b border-n-100 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500" style={GRID}>
                <div>SKU</div>
                <div>Product</div>
                <div className="text-right">Ordered</div>
                <div className="text-right">Expected</div>
                <div className="text-right">Receiving</div>
              </div>
              {lines.map((l) => {
                const v = Number(qty[l.id]) || 0;
                const outstanding = l.quantityOrdered - l.quantityAlreadyReceived;
                const over = v > outstanding;
                return (
                  <div key={l.id} className="grid items-center gap-3 border-b border-n-100 px-1 py-2.5" style={GRID}>
                    <div className="code truncate text-[12.5px] font-semibold text-n-800" title={l.sku ?? ''}>{l.sku}</div>
                    <div className="truncate text-[13px] text-n-600" title={l.productName ?? ''}>{l.productName}</div>
                    <div className="mono text-right text-[13px] text-n-500">{l.quantityOrdered}</div>
                    <div className="mono text-right text-[13px] text-n-700">{l.quantityExpected}</div>
                    <div>
                      <input
                        className={`input mono text-right ${over ? 'border-warning-bd bg-warning-bg/40' : ''}`}
                        inputMode="numeric"
                        value={qty[l.id] ?? ''}
                        onChange={(e) => setLineQty(l.id, e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    {trackedIds.has((l as any).productId) && (
                      <div className="col-span-full mt-1.5">
                        <label className="mb-1 block text-[11.5px] font-semibold text-n-600">
                          Serial numbers — one per unit ({splitSerials(serials[l.id]).length}/{v})
                        </label>
                        <textarea
                          className="input mono h-[68px] resize-y py-1.5 text-[12.5px]"
                          placeholder="One serial per line, or comma separated"
                          value={serials[l.id] ?? ''}
                          onChange={(e) => { setSerials((sx) => ({ ...sx, [l.id]: e.target.value })); setDirty(true); }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-6 rounded-md bg-n-25 px-4 py-2.5 text-[13px]">
            <span className="text-n-500">Expected <span className="mono ml-1 font-semibold text-n-700">{totals.expected}</span></span>
            <span className="text-n-500">Receiving <span className="mono ml-1 font-semibold text-n-900">{totals.received}</span></span>
            {totals.short > 0 && <span className="text-warning">Short <span className="mono ml-1 font-semibold">{totals.short}</span></span>}
            {totals.over > 0 && <span className="text-danger">Over <span className="mono ml-1 font-semibold">{totals.over}</span></span>}
          </div>

          {totals.short > 0 && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-n-200 bg-n-25 px-3 py-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]" checked={closeShort} onChange={(e) => { setCloseShort(e.target.checked); setDirty(true); }} />
              <span className="text-[13px] text-n-700">
                Close the order short — don't expect the missing {totals.short} unit{totals.short === 1 ? '' : 's'}
                <span className="block text-[11.5px] text-n-400">
                  Leave unticked and a backorder receipt is raised automatically for the remainder.
                </span>
              </span>
            </label>
          )}

          {totals.over > 0 && (
            <p className="flex items-start gap-2 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              You're receiving {totals.over} more than ordered. You'll be asked to confirm, and the overage is recorded.
            </p>
          )}

          <div>
            <label className="label">Notes <span className="font-normal text-n-400">(optional)</span></label>
            <input className="input" value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="Delivery note number, condition on arrival…" />
          </div>

          <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
            Posting adds the received quantities to the chosen warehouse and updates the purchase order. A posted receipt can't be edited.
          </p>
        </div>
      )}
    </ModalShell>
  );
}

const GRID = { gridTemplateColumns: '1.1fr 2fr 70px 80px 110px' } as const;

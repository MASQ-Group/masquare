import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell, Select, SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { productsApi, stockApi, warehousesApi } from '../../lib/api';

interface Props {
  /** Pre-selected when opened from a warehouse row. */
  defaultWarehouseId?: string | null;
  defaultProductId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const REASONS = [
  { value: 'opening_balance', label: 'Opening balance — stock we already hold' },
  { value: 'stocktake', label: 'Stocktake — counted, correcting the system' },
  { value: 'adjustment', label: 'Adjustment — correcting an error' },
  { value: 'damage', label: 'Damage / write-off' },
];

/** Set an absolute count. The server derives the delta and writes the movement,
 *  so a balance can never change without a reason attached. */
export function StockAdjustModal({ defaultWarehouseId, defaultProductId, onClose, onSaved }: Props) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  const [product, setProduct] = useState<ReferenceOption | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(defaultWarehouseId ?? null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('opening_balance');
  const [notes, setNotes] = useState('');
  const productId = product?.id ?? defaultProductId ?? null;

  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() });

  // Current balance, so the user can see what they are changing from.
  const { data: current } = useQuery({
    queryKey: ['stock', 'product', productId],
    queryFn: () => stockApi.byProduct(productId!),
    enabled: !!productId,
  });
  const existing = useMemo(
    () => (warehouseId && current ? current.rows.find((r) => r.warehouseId === warehouseId)?.quantityOnHand ?? 0 : null),
    [current, warehouseId],
  );

  // 965 products — search server-side rather than shipping the catalogue to the browser.
  const fetchProducts = async (query: string): Promise<ReferenceOption[]> => {
    const res = await productsApi.list({ q: query || undefined, pageSize: 20 });
    return res.items.map((p) => ({ id: p.id, label: p.mainSku, sub: p.title }));
  };

  const target = qty.trim() === '' ? null : Number(qty);
  const delta = target !== null && existing !== null ? target - existing : null;

  const save = async () => {
    if (!productId) { toast.error('Pick a product'); return; }
    if (!warehouseId) { toast.error('Pick a warehouse'); return; }
    if (target === null || !Number.isInteger(target) || target < 0) { toast.error('Quantity must be a whole number, zero or more'); return; }
    setBusy(true);
    try {
      const res = await stockApi.setLevel({ productId, warehouseId, quantityOnHand: target, reason, notes: notes.trim() || null });
      toast.success(res.changed ? `Stock set to ${res.quantityOnHand}` : 'Already at that quantity — nothing changed');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not update stock');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title="Adjust Stock"
      subtitle="Set the true quantity for one product in one warehouse."
      dirty={dirty}
      primaryLabel="Save stock"
      onPrimary={save}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div>
          <label className="label">Product</label>
          <SmartReferenceInput
            value={product}
            fetchSuggestions={fetchProducts}
            onSelect={(o) => { setProduct(o); touch(); }}
            onClear={() => { setProduct(null); touch(); }}
            placeholder="Search by SKU or name"
          />
        </div>

        <div className="grid grid-cols-2 items-start gap-4 max-[560px]:grid-cols-1">
          <div>
            <label className="label">Warehouse</label>
            <Select
              value={warehouseId ?? ''}
              onChange={(v) => { setWarehouseId(v || null); touch(); }}
              placeholder="— pick a warehouse"
              options={warehouses.map((w) => ({ value: w.id, label: w.includeInInventory ? w.name : `${w.name} (excluded)` }))}
            />
          </div>
          <div>
            <label className="label">Quantity on hand</label>
            <input
              className="input mono"
              inputMode="numeric"
              value={qty}
              onChange={(e) => { setQty(e.target.value); touch(); }}
              placeholder={existing !== null ? String(existing) : '0'}
            />
          </div>
        </div>

        <div>
          <label className="label">Reason</label>
          <Select value={reason} onChange={(v) => { setReason(v); touch(); }} options={REASONS} />
        </div>

        <div>
          <label className="label">Notes <span className="font-normal text-n-400">(optional)</span></label>
          <input className="input" value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} placeholder="Anything worth recording against this change" />
        </div>

        {productId && warehouseId && (
          <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
            {delta === null ? (
              <>Currently <strong className="mono">{existing}</strong> on hand here.</>
            ) : delta === 0 ? (
              <>Already <strong className="mono">{existing}</strong> — saving changes nothing.</>
            ) : (
              <>
                <strong className="mono">{existing}</strong> → <strong className="mono">{target}</strong>
                {' '}({delta > 0 ? '+' : ''}{delta}). Recorded in the movement history against the reason above.
              </>
            )}
          </p>
        )}
      </div>
    </ModalShell>
  );
}

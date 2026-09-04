import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell, Select, SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { adjustmentsApi, productsApi, stockApi, warehousesApi, type AdjustmentMode } from '../../lib/api';

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

const DISPOSITIONS = [
  { value: 'scrapped', label: 'Scrapped — the unit is gone' },
  { value: 'returned_to_vendor', label: 'Returned to the vendor' },
];

const MODES: { value: AdjustmentMode; label: string; hint: string }[] = [
  { value: 'set', label: 'Set to', hint: 'State the true count. The change is worked out for you.' },
  { value: 'add', label: 'Add', hint: 'Stock arriving that no receipt covers.' },
  { value: 'remove', label: 'Remove', hint: 'Stock leaving that no sale covers.' },
];

function splitSerials(raw: string): string[] {
  return raw.split(/[\s,;|]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Change one product's balance in one warehouse by hand.
 *
 * Serial-tracked products cannot use "Set to". For them it would have to mean "these are all the
 * serials on the shelf", so a list that came up short would write off every unit it failed to
 * mention. Adding and removing named units can only ever affect what someone actually typed.
 */
export function StockAdjustModal({ defaultWarehouseId, defaultProductId, onClose, onSaved }: Props) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  const [product, setProduct] = useState<ReferenceOption | null>(null);
  const [serialTracked, setSerialTracked] = useState(false);
  const [warehouseId, setWarehouseId] = useState<string | null>(defaultWarehouseId ?? null);
  const [mode, setMode] = useState<AdjustmentMode>('set');
  const [qty, setQty] = useState('');
  const [serials, setSerials] = useState('');
  const [reason, setReason] = useState('opening_balance');
  const [disposition, setDisposition] = useState('scrapped');
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

  const trackedById = useRef(new Map<string, boolean>());

  // 1,174 products — search server-side rather than shipping the catalogue to the browser.
  const fetchProducts = async (query: string): Promise<ReferenceOption[]> => {
    const res = await productsApi.list({ q: query || undefined, pageSize: 20 });
    for (const p of res.items) trackedById.current.set(p.id, p.serialTracked);
    return res.items.map((p) => ({ id: p.id, label: p.mainSku, sub: p.title }));
  };

  const pickProduct = (o: ReferenceOption) => {
    const tracked = trackedById.current.get(o.id) ?? false;
    setProduct(o);
    setSerialTracked(tracked);
    // "Set to" is not available for a tracked product, so land somewhere legal rather than
    // leaving a mode selected that the server will refuse on save.
    if (tracked && mode === 'set') setMode('add');
    touch();
  };

  const serialList = splitSerials(serials);
  const units = serialTracked ? serialList.length : Number(qty) || 0;
  const target = qty.trim() === '' ? null : Number(qty);
  const delta =
    serialTracked
      ? mode === 'add' ? serialList.length : -serialList.length
      : target === null || existing === null
        ? null
        : mode === 'set' ? target - existing : mode === 'add' ? target : -target;

  const save = async () => {
    if (!productId) { toast.error('Pick a product'); return; }
    if (!warehouseId) { toast.error('Pick a warehouse'); return; }

    if (serialTracked) {
      if (!serialList.length) { toast.error('Enter the serial numbers'); return; }
      const dupes = serialList.filter((s, i) => serialList.indexOf(s) !== i);
      if (dupes.length) { toast.error(`The same serial is listed twice: ${[...new Set(dupes)].join(', ')}`); return; }
    } else {
      if (target === null || !Number.isInteger(target)) { toast.error('Quantity must be a whole number'); return; }
      if (mode === 'set' && target < 0) { toast.error('Quantity on hand cannot be negative'); return; }
      if (mode !== 'set' && target <= 0) { toast.error('Quantity must be above zero'); return; }
    }

    setBusy(true);
    try {
      const res = await adjustmentsApi.adjust({
        productId,
        warehouseId,
        mode,
        quantity: serialTracked ? undefined : (target as number),
        serials: serialTracked ? serialList : undefined,
        reason,
        disposition: serialTracked && mode === 'remove' ? (disposition as 'scrapped' | 'returned_to_vendor') : undefined,
        notes: notes.trim() || null,
      });
      toast.success(res.changed ? `Stock now ${res.quantityOnHand}` : 'Already at that quantity — nothing changed');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not update stock');
    } finally {
      setBusy(false);
    }
  };

  const modes = serialTracked ? MODES.filter((m) => m.value !== 'set') : MODES;

  return (
    <ModalShell
      open
      title="Adjust Stock"
      subtitle="Change one product's quantity in one warehouse."
      dirty={dirty}
      primaryLabel={busy ? 'Saving…' : 'Save stock'}
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
            onSelect={pickProduct}
            onClear={() => { setProduct(null); setSerialTracked(false); touch(); }}
            placeholder="Search by SKU or name"
          />
          {serialTracked && (
            <p className="mt-1.5 text-[11.5px] text-n-500">
              <span className="tag mr-1.5">Serial-tracked</span>
              Name the units being moved. Setting a count is not available, because it would write off
              every serial you did not list.
            </p>
          )}
        </div>

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
          <label className="label">Action</label>
          <div className="flex gap-2 max-[560px]:flex-col">
            {modes.map((m) => (
              <button
                key={m.value}
                onClick={() => { setMode(m.value); touch(); }}
                className={`flex-1 rounded-lg border px-3 py-2 text-left transition ${
                  mode === m.value
                    ? 'border-teal-400 bg-teal-50 text-teal-800'
                    : 'border-n-200 bg-n-0 text-n-600 hover:border-n-300'
                }`}
              >
                <div className="text-[13px] font-semibold">{m.label}</div>
                <div className="mt-0.5 text-[11px] leading-4 text-n-500">{m.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {serialTracked ? (
          <div>
            <label className="label">Serial numbers</label>
            <textarea
              className="input mono min-h-[96px] py-2 text-[12.5px]"
              value={serials}
              onChange={(e) => { setSerials(e.target.value); touch(); }}
              placeholder={'One per line\nSN-00412\nSN-00418\nSN-00431'}
            />
            <div className="mt-1 text-[11px] text-n-400">
              {serialList.length} serial{serialList.length === 1 ? '' : 's'} entered — that is the quantity.
            </div>
          </div>
        ) : (
          <div>
            <label className="label">{mode === 'set' ? 'Quantity on hand' : mode === 'add' ? 'Quantity to add' : 'Quantity to remove'}</label>
            <input
              className="input mono"
              inputMode="numeric"
              value={qty}
              onChange={(e) => { setQty(e.target.value.replace(/[^\d]/g, '')); touch(); }}
              placeholder={mode === 'set' && existing !== null ? String(existing) : '0'}
            />
          </div>
        )}

        <div>
          <label className="label">Reason</label>
          <Select value={reason} onChange={(v) => { setReason(v); touch(); }} options={REASONS} />
        </div>

        {serialTracked && mode === 'remove' && (
          <div>
            <label className="label">Where did they go?</label>
            <Select value={disposition} onChange={(v) => { setDisposition(v); touch(); }} options={DISPOSITIONS} />
          </div>
        )}

        <div>
          <label className="label">Notes <span className="font-normal text-n-400">(optional)</span></label>
          <input
            className="input"
            value={notes}
            onChange={(e) => { setNotes(e.target.value); touch(); }}
            placeholder="Anything worth recording against this change"
          />
        </div>

        {productId && warehouseId && (
          <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
            {delta === null || units === 0 ? (
              <>Currently <strong className="mono">{existing ?? 0}</strong> on hand here.</>
            ) : delta === 0 ? (
              <>Already <strong className="mono">{existing}</strong> — saving changes nothing.</>
            ) : (
              <>
                <strong className="mono">{existing ?? 0}</strong> → <strong className="mono">{(existing ?? 0) + delta}</strong>
                {' '}({delta > 0 ? '+' : ''}{delta}). Recorded in the movement history against the reason above.
              </>
            )}
          </p>
        )}
      </div>
    </ModalShell>
  );
}

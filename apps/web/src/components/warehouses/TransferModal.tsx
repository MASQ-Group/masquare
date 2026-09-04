import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select, SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { productsApi, stockApi, transfersApi, warehousesApi, type TransferLineInput } from '../../lib/api';

interface Props {
  defaultFromWarehouseId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

interface Line {
  productId: string;
  sku: string;
  title: string;
  serialTracked: boolean;
  /** Free text for quantity products; ignored for tracked ones, where the serials are the count. */
  quantity: string;
  /** One serial per line, which is how they arrive from a scanner or a paste. */
  serials: string;
}

/** Split however they were typed — scanners emit newlines, people type commas. */
function splitSerials(raw: string): string[] {
  return raw.split(/[\s,;|]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Move stock between two of our own warehouses.
 *
 * One direction for the whole document rather than per line: a sheet where every row could go
 * somewhere different is a list of moves, not a transfer, and the reference on it would mean
 * nothing. Different destinations means a second transfer.
 */
export function TransferModal({ defaultFromWarehouseId, onClose, onSaved }: Props) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  const [fromId, setFromId] = useState<string>(defaultFromWarehouseId ?? '');
  const [toId, setToId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [picker, setPicker] = useState<ReferenceOption | null>(null);

  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() });

  // What is actually on the source shelf, so a line can say "12 available" before anything is typed.
  const { data: sourceStock } = useQuery({
    queryKey: ['stock', 'levels', 'transfer-source', fromId],
    queryFn: () => stockApi.levels({ warehouseId: fromId, nonZeroOnly: true, pageSize: 500 }),
    enabled: !!fromId,
  });
  const onHand = useMemo(
    () => new Map((sourceStock?.rows ?? []).map((r) => [r.productId, r.quantityOnHand])),
    [sourceStock],
  );

  // Whether a product is serial-tracked decides the whole shape of its row, and the reference
  // option carries only a label. Rather than a second round trip per pick, the flag is kept from
  // the search that produced the option.
  const trackedById = useRef(new Map<string, boolean>());

  const fetchProducts = async (query: string): Promise<ReferenceOption[]> => {
    const res = await productsApi.list({ q: query || undefined, pageSize: 20 });
    for (const p of res.items) trackedById.current.set(p.id, p.serialTracked);
    return res.items.map((p) => ({ id: p.id, label: p.mainSku, sub: p.title }));
  };

  const addLine = (opt: ReferenceOption) => {
    if (lines.some((l) => l.productId === opt.id)) {
      toast.error(`${opt.label} is already on this transfer`);
      return;
    }
    setLines((ls) => [
      ...ls,
      {
        productId: opt.id,
        sku: opt.label,
        title: opt.sub ?? '',
        serialTracked: trackedById.current.get(opt.id) ?? false,
        quantity: '',
        serials: '',
      },
    ]);
    setPicker(null);
    touch();
  };

  const update = (productId: string, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
    touch();
  };
  const remove = (productId: string) => {
    setLines((ls) => ls.filter((l) => l.productId !== productId));
    touch();
  };

  const lineUnits = (l: Line) => (l.serialTracked ? splitSerials(l.serials).length : Number(l.quantity) || 0);
  const totalUnits = lines.reduce((s, l) => s + lineUnits(l), 0);

  const save = async () => {
    if (!fromId) { toast.error('Pick the warehouse the stock is leaving'); return; }
    if (!toId) { toast.error('Pick the warehouse the stock is going to'); return; }
    if (fromId === toId) { toast.error('Source and destination are the same warehouse'); return; }
    if (!lines.length) { toast.error('Add at least one product'); return; }

    const payload: TransferLineInput[] = [];
    for (const l of lines) {
      if (l.serialTracked) {
        const serials = splitSerials(l.serials);
        if (!serials.length) { toast.error(`${l.sku} is serial-tracked — enter the serial numbers`); return; }
        payload.push({ productId: l.productId, quantity: serials.length, serials });
      } else {
        const qty = Number(l.quantity);
        if (!Number.isInteger(qty) || qty <= 0) { toast.error(`${l.sku}: quantity must be a whole number above zero`); return; }
        payload.push({ productId: l.productId, quantity: qty });
      }
    }

    setBusy(true);
    try {
      const res = await transfersApi.create({ fromWarehouseId: fromId, toWarehouseId: toId, lines: payload, notes: notes.trim() || null });
      toast.success(`${res.reference} — ${res.totalUnits} unit${res.totalUnits === 1 ? '' : 's'} moved to ${res.to.name}`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not create the transfer');
    } finally {
      setBusy(false);
    }
  };

  const options = warehouses.map((w) => ({ value: w.id, label: w.includeInInventory ? w.name : `${w.name} (excluded)` }));

  return (
    <ModalShell
      open
      title="Transfer Stock"
      subtitle="Move stock from one of your warehouses to another."
      dirty={dirty}
      primaryLabel={busy ? 'Transferring…' : 'Transfer stock'}
      onPrimary={save}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 max-[560px]:grid-cols-1">
          <div>
            <label className="label">From</label>
            <Select value={fromId} onChange={(v) => { setFromId(v); touch(); }} placeholder="— leaving here" options={options} />
          </div>
          <ArrowRight size={16} className="mb-3 shrink-0 text-n-400 max-[560px]:hidden" />
          <div>
            <label className="label">To</label>
            <Select value={toId} onChange={(v) => { setToId(v); touch(); }} placeholder="— arriving here" options={options} />
          </div>
        </div>

        {fromId && toId && fromId === toId && (
          <p className="rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
            Those are the same warehouse. Pick a different destination.
          </p>
        )}

        <div>
          <label className="label">Add a product</label>
          <SmartReferenceInput
            value={picker}
            fetchSuggestions={fetchProducts}
            onSelect={addLine}
            onClear={() => setPicker(null)}
            placeholder="Search by SKU or name"
          />
        </div>

        {lines.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-n-200">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">Product</th>
                  <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">Quantity / serials</th>
                  <th className="border-b border-n-200 bg-n-25 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const available = onHand.get(l.productId);
                  const wanted = lineUnits(l);
                  const short = available != null && wanted > available;
                  return (
                    <tr key={l.productId} className="align-top">
                      <td className="border-b border-n-100 px-3 py-2.5">
                        <div className="code text-[13px] font-semibold text-n-800">{l.sku}</div>
                        <div className="text-[11.5px] text-n-500">{l.title}</div>
                        <div className="mt-1 text-[11px] text-n-400">
                          {!fromId ? 'Pick a source warehouse' : available == null ? 'None here' : `${available} here`}
                          {l.serialTracked && <span className="ml-1.5 tag">Serial-tracked</span>}
                        </div>
                      </td>
                      <td className="border-b border-n-100 px-3 py-2.5">
                        {l.serialTracked ? (
                          <>
                            <textarea
                              className="input mono min-h-[64px] py-2 text-[12.5px]"
                              value={l.serials}
                              onChange={(e) => update(l.productId, { serials: e.target.value })}
                              placeholder={'One serial per line\nSN-00412\nSN-00418'}
                            />
                            <div className="mt-1 text-[11px] text-n-400">{wanted} serial{wanted === 1 ? '' : 's'} entered</div>
                          </>
                        ) : (
                          <input
                            className="input mono w-28"
                            inputMode="numeric"
                            value={l.quantity}
                            onChange={(e) => update(l.productId, { quantity: e.target.value.replace(/[^\d]/g, '') })}
                            placeholder="0"
                          />
                        )}
                        {short && (
                          <div className="mt-1 text-[11px] font-semibold text-danger">
                            Only {available} available — the transfer will be refused.
                          </div>
                        )}
                      </td>
                      <td className="border-b border-n-100 px-3 py-2.5 text-right">
                        <button
                          onClick={() => remove(l.productId)}
                          title="Remove line"
                          className="grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 hover:border-danger-bd hover:bg-danger-bg hover:text-danger"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {lines.length === 0 && (
          <p className="rounded-md border border-dashed border-n-200 px-3 py-6 text-center text-[12.5px] text-n-400">
            <Plus size={14} className="mr-1 inline" />
            Search above to add the products you are moving.
          </p>
        )}

        <div>
          <label className="label">Notes <span className="font-normal text-n-400">(optional)</span></label>
          <input
            className="input"
            value={notes}
            onChange={(e) => { setNotes(e.target.value); touch(); }}
            placeholder="Why the stock is moving — kept on both sides of the movement history"
          />
        </div>

        {lines.length > 0 && (
          <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
            <strong>{totalUnits}</strong> unit{totalUnits === 1 ? '' : 's'} across {lines.length} line{lines.length === 1 ? '' : 's'}.
            The stock leaves and arrives in one step — there is no in-transit stage — and both sides are written to the
            movement history against one reference.
          </p>
        )}
      </div>
    </ModalShell>
  );
}

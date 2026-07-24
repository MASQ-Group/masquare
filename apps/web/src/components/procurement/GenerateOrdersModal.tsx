import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { procurementApi, vendorsApi, warehousesApi, type DemandRow } from '../../lib/api';

interface Props {
  rows: DemandRow[];
  onClose: () => void;
  onGenerated: (created: { id: string; poNumber: string }[]) => void;
}

const money = (v: number, ccy = 'EUR') => `${ccy === 'EUR' ? '€' : ccy + ' '}${v.toFixed(2)}`;

/**
 * Confirm a demand selection before it becomes draft purchase orders. Quantities and
 * costs stay editable, and any product without a vendor must be given one here —
 * the server refuses otherwise.
 */
export function GenerateOrdersModal({ rows, onClose, onGenerated }: Props) {
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() });

  const [warehouseId, setWarehouseId] = useState('');
  const [busy, setBusy] = useState(false);
  // Per-product overrides, keyed by productId.
  const [qty, setQty] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.productId, String(r.shortfall || r.requiredQuantity)])),
  );
  const [cost, setCost] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.productId, r.lastPurchaseCost != null ? String(r.lastPurchaseCost) : ''])),
  );
  const [vendorPick, setVendorPick] = useState<Record<string, string>>({});

  const vendorFor = (r: DemandRow) => r.vendor?.id ?? vendorPick[r.productId] ?? '';
  const unassigned = rows.filter((r) => !vendorFor(r));

  // One PO per distinct vendor — mirrors what the server will do.
  const poCount = useMemo(
    () => new Set(rows.map((r) => vendorFor(r)).filter(Boolean)).size,
    [rows, vendorPick],
  );

  const generate = async () => {
    if (unassigned.length) { toast.error(`Pick a vendor for ${unassigned.length} product${unassigned.length === 1 ? '' : 's'}`); return; }
    const lines = rows.map((r) => ({
      productId: r.productId,
      quantity: Number(qty[r.productId]) || 0,
      vendorId: r.vendor?.id ?? vendorPick[r.productId] ?? null,
      unitCost: cost[r.productId] === '' ? null : Number(cost[r.productId]),
    })).filter((l) => l.quantity > 0);
    if (!lines.length) { toast.error('Enter a quantity for at least one product'); return; }

    setBusy(true);
    try {
      const res = await procurementApi.generateOrders({ destinationWarehouseId: warehouseId || null, lines });
      toast.success(`${res.orderCount} draft purchase order${res.orderCount === 1 ? '' : 's'} created — review and submit`);
      onGenerated(res.created);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not generate purchase orders');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title="Generate Purchase Orders"
      subtitle={`${rows.length} product${rows.length === 1 ? '' : 's'} → ${poCount || '—'} draft order${poCount === 1 ? '' : 's'}, one per vendor`}
      primaryLabel={busy ? 'Generating…' : `Create ${poCount || ''} draft order${poCount === 1 ? '' : 's'}`.replace('  ', ' ')}
      onPrimary={generate}
      primaryDisabled={busy || unassigned.length > 0}
      busy={busy}
      onClose={onClose}
      initialSize={{ w: 860, h: 620 }}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 items-start gap-4 max-[560px]:grid-cols-1">
          <div>
            <label className="label">Receive into <span className="font-normal text-n-400">(optional)</span></label>
            <Select
              value={warehouseId}
              onChange={setWarehouseId}
              placeholder="— decide at receiving"
              options={warehouses.filter((w) => w.includeInInventory).map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
        </div>

        {unassigned.length > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            {unassigned.length} product{unassigned.length === 1 ? ' has' : 's have'} no vendor. Pick one for each before generating.
          </p>
        )}

        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid gap-3 border-b border-n-100 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500" style={GRID}>
              <div>SKU</div><div>Vendor</div>
              <div className="text-right">Required</div><div className="text-right">Order</div><div className="text-right">Unit cost</div><div className="text-right">Line</div>
            </div>
            {rows.map((r) => {
              const q = Number(qty[r.productId]) || 0;
              const c = cost[r.productId] === '' ? 0 : Number(cost[r.productId]) || 0;
              return (
                <div key={r.productId} className="grid items-center gap-3 border-b border-n-100 py-2.5 px-1" style={GRID}>
                  <div className="min-w-0">
                    <div className="code truncate text-[12.5px] font-semibold text-n-800" title={r.sku}>{r.sku}</div>
                    <div className="truncate text-[11.5px] text-n-400" title={r.productName}>{r.productName}</div>
                  </div>
                  <div className="min-w-0">
                    {r.vendor
                      ? <span className="truncate text-[12.5px] text-n-700" title={r.vendor.name}>{r.vendor.name}</span>
                      : (
                        <Select
                          dense
                          value={vendorPick[r.productId] ?? ''}
                          onChange={(v) => setVendorPick((s) => ({ ...s, [r.productId]: v }))}
                          placeholder="— pick vendor"
                          options={vendors.map((v) => ({ value: v.id, label: v.name }))}
                        />
                      )}
                  </div>
                  <div className="mono text-right text-[13px] text-n-500">{r.requiredQuantity}</div>
                  <div>
                    <input className="input mono h-9 text-right" inputMode="numeric" value={qty[r.productId] ?? ''}
                      onChange={(e) => setQty((s) => ({ ...s, [r.productId]: e.target.value }))} />
                  </div>
                  <div>
                    <input className="input mono h-9 text-right" inputMode="decimal" placeholder="0.00" value={cost[r.productId] ?? ''}
                      onChange={(e) => setCost((s) => ({ ...s, [r.productId]: e.target.value }))} />
                  </div>
                  <div className="mono text-right text-[13px] font-semibold text-n-800">{money(q * c)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
          Orders are created as <strong>drafts</strong> — quantities and costs stay editable until you submit each one. Nothing reaches stock until goods are received.
        </p>
      </div>
    </ModalShell>
  );
}

const GRID = { gridTemplateColumns: '2fr 1.6fr 80px 90px 110px 90px' } as const;

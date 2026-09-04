import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, ChevronRight, EyeOff, Pencil, Plus, Search, Trash2, Upload, Warehouse as WarehouseIcon } from 'lucide-react';
import { toast } from 'sonner';
import { BulkImport, DEFAULT_PAGE_SIZES, ModalShell, Pagination, Select, downloadTemplate, type ImportField } from '@masquare/ui';
import { stockApi, transfersApi, warehousesApi, type Warehouse, type WarehouseNode } from '../lib/api';
import { usePersistentState } from '../lib/usePersistentState';
import { WarehouseModal } from '../components/warehouses/WarehouseModal';
import { StockAdjustModal } from '../components/warehouses/StockAdjustModal';
import { TransferModal } from '../components/warehouses/TransferModal';
import { AdjustmentImportModal, TransferImportModal } from '../components/warehouses/InventoryImportModals';
import { PageHeader } from '../components/common/PageHeader';

const STOCK_IMPORT_FIELDS: ImportField[] = [
  { key: 'sku', label: 'SKU', required: true },
  { key: 'warehouse', label: 'Warehouse', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
];

/** Warehouse is a dropdown: a typo there files stock into a location that does not exist. */
function downloadStockTemplate(warehouses: { name: string }[]) {
  const first = warehouses[0]?.name ?? 'Main Warehouse';
  const second = warehouses[1]?.name ?? first;
  return downloadTemplate('masquare-opening-stock-template', {
    sheetName: 'Opening Stock',
    headers: STOCK_IMPORT_FIELDS.map((f) => f.label),
    sampleRows: [['RE-S8540', first, '25'], ['RE-AC8820', first, '8'], ['RE-S8540', second, '2']],
    lists: [{ column: STOCK_IMPORT_FIELDS.findIndex((f) => f.key === 'warehouse'), values: warehouses.map((w) => w.name) }]
      .filter((l) => l.column >= 0 && l.values.length > 0),
  });
}

const REASON_LABELS: Record<string, string> = {
  opening_balance: 'Opening balance',
  adjustment: 'Adjustment',
  damage: 'Damage / write-off',
  stocktake: 'Stocktake',
  goods_receipt: 'Goods receipt',
  sale: 'Sale',
  transfer: 'Transfer',
};

export function WarehousesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = usePersistentState<'tree' | 'stock' | 'transfers' | 'movements'>('warehouses.tab', 'tree');
  const [showInactive, setShowInactive] = usePersistentState('warehouses.showInactive', false);

  const [modal, setModal] = useState<{ warehouse?: Warehouse; defaultParentId?: string | null } | null>(null);
  const [adjustOpen, setAdjustOpen] = useState<{ warehouseId?: string | null } | null>(null);
  const [transferOpen, setTransferOpen] = useState<{ fromWarehouseId?: string | null } | null>(null);
  // One value rather than three booleans: the three sheets are alternatives, and two open at once
  // would be a bug that only shows up as a stacked modal.
  const [importOpen, setImportOpen] = useState<'stock' | 'transfer' | 'adjustment' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WarehouseNode | null>(null);

  const { data: tree = [], isLoading } = useQuery({
    queryKey: ['warehouses', 'tree', showInactive],
    queryFn: () => warehousesApi.tree({ includeInactive: showInactive }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['warehouses'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
    qc.invalidateQueries({ queryKey: ['transfers'] });
  };

  const del = useMutation({
    mutationFn: (id: string) => warehousesApi.remove(id),
    onSuccess: (res) => {
      toast.success(res.deactivated ? 'Warehouse deactivated — its stock history is kept' : 'Warehouse deleted');
      setConfirmDelete(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove warehouse'),
  });

  return (
    <div className="w-full">
      <PageHeader
        module="Catalogue & Inventory"
        title="Warehouses"
        info="Where stock is held. Only warehouses marked as available count toward what you can sell."
        actions={
          <>
            <button className="hbtn" onClick={() => setImportOpen(tab === 'transfers' ? 'transfer' : 'adjustment')}>
              <Upload size={15} className="text-n-500" /> Import {tab === 'transfers' ? 'transfers' : 'adjustments'}
            </button>
            <button className="hbtn" onClick={() => setTransferOpen({})}><ArrowRight size={15} className="text-n-500" /> Transfer stock</button>
            <button className="hbtn" onClick={() => setAdjustOpen({})}><Plus size={15} className="text-n-500" /> Adjust stock</button>
          </>
        }
        primary={<button className="hbtn-primary" onClick={() => setModal({})}><Plus size={16} /> New warehouse</button>}
      />

      <div className="mb-4 flex items-center gap-2 border-b border-n-200">
        {([['tree', 'Warehouses'], ['stock', 'Stock on hand'], ['transfers', 'Transfers'], ['movements', 'Movement history']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition ${
              tab === key ? 'border-teal-500 text-teal-700' : 'border-transparent text-n-500 hover:text-n-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'tree' && (
        <WarehouseTree
          tree={tree}
          isLoading={isLoading}
          showInactive={showInactive}
          onToggleInactive={setShowInactive}
          onEdit={(w) => setModal({ warehouse: w })}
          onAddChild={(id) => setModal({ defaultParentId: id })}
          onAdjust={(id) => setAdjustOpen({ warehouseId: id })}
          onTransfer={(id) => setTransferOpen({ fromWarehouseId: id })}
          onDelete={setConfirmDelete}
        />
      )}
      {tab === 'stock' && <StockTab tree={tree} onAdjust={(id) => setAdjustOpen({ warehouseId: id })} />}
      {tab === 'transfers' && <TransfersTab tree={tree} onNew={() => setTransferOpen({})} />}
      {tab === 'movements' && <MovementsTab tree={tree} />}

      {modal && (
        <WarehouseModal
          warehouse={modal.warehouse}
          defaultParentId={modal.defaultParentId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); invalidate(); }}
        />
      )}
      {adjustOpen && (
        <StockAdjustModal
          defaultWarehouseId={adjustOpen.warehouseId}
          onClose={() => setAdjustOpen(null)}
          onSaved={() => { setAdjustOpen(null); invalidate(); }}
        />
      )}
      {transferOpen && (
        <TransferModal
          defaultFromWarehouseId={transferOpen.fromWarehouseId}
          onClose={() => setTransferOpen(null)}
          onSaved={() => { setTransferOpen(null); invalidate(); }}
        />
      )}
      {importOpen === 'stock' && (
        <StockImportModal onClose={() => setImportOpen(null)} onDone={() => { setImportOpen(null); invalidate(); }} />
      )}
      {importOpen === 'transfer' && (
        <TransferImportModal onClose={() => setImportOpen(null)} onDone={() => { setImportOpen(null); invalidate(); }} />
      )}
      {importOpen === 'adjustment' && (
        <AdjustmentImportModal onClose={() => setImportOpen(null)} onDone={() => { setImportOpen(null); invalidate(); }} />
      )}
      {confirmDelete && (
        <ModalShell
          open
          title="Remove Warehouse"
          subtitle={confirmDelete.name}
          primaryLabel={del.isPending ? 'Removing…' : 'Remove'}
          onPrimary={() => del.mutate(confirmDelete.id)}
          busy={del.isPending}
          onClose={() => setConfirmDelete(null)}
        >
          <p className="text-[13px] text-n-700">
            {confirmDelete.rollupUnitCount > 0
              ? `${confirmDelete.name} still holds stock. Move or write it off first — this will be refused.`
              : `Remove ${confirmDelete.name}? If it has stock history it is deactivated rather than deleted, so past movements stay explainable.`}
          </p>
        </ModalShell>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- tree

function WarehouseTree({
  tree, isLoading, showInactive, onToggleInactive, onEdit, onAddChild, onAdjust, onTransfer, onDelete,
}: {
  tree: WarehouseNode[];
  isLoading: boolean;
  showInactive: boolean;
  onToggleInactive: (v: boolean) => void;
  onEdit: (w: Warehouse) => void;
  onAddChild: (id: string) => void;
  onAdjust: (id: string) => void;
  onTransfer: (id: string) => void;
  onDelete: (w: WarehouseNode) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const rows: WarehouseNode[] = [];
  const walk = (list: WarehouseNode[]) => {
    for (const n of list) {
      rows.push(n);
      if (!collapsed.has(n.id)) walk(n.children);
    }
  };
  walk(tree);

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-n-100 px-4 py-2.5">
        <span className="text-[12px] text-n-500">{rows.length} warehouse{rows.length === 1 ? '' : 's'}</span>
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-n-600">
          <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={showInactive} onChange={(e) => onToggleInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} text-left`}>Warehouse</th>
              <th className={`${th} text-left`}>Type</th>
              <th className={`${th} text-left`}>Availability</th>
              <th className={`${th} text-right`}>Products</th>
              <th className={`${th} text-right`}>Units here</th>
              <th className={`${th} text-right`}>Incl. sub-warehouses</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className={td} colSpan={7}>Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td className={`${td} py-10 text-center text-n-400`} colSpan={7}>No warehouses yet.</td></tr>
            )}
            {rows.map((n) => (
              <tr key={n.id} className={`group hover:bg-n-25 ${n.isActive ? '' : 'opacity-55'}`}>
                <td className={td}>
                  <div className="flex items-center gap-1.5" style={{ paddingLeft: n.depth * 20 }}>
                    {n.children.length > 0 ? (
                      <button onClick={() => toggle(n.id)} className="grid h-5 w-5 place-items-center rounded text-n-400 hover:bg-n-100 hover:text-n-700">
                        {collapsed.has(n.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                    ) : (
                      <span className="inline-block w-5" />
                    )}
                    <WarehouseIcon size={14} className="shrink-0 text-n-400" />
                    <span className="font-semibold text-n-800">{n.name}</span>
                    {!n.isActive && <span className="tag ml-1">Inactive</span>}
                  </div>
                  {n.notes && <div className="mt-0.5 text-[11.5px] text-n-400" style={{ paddingLeft: n.depth * 20 + 28 }}>{n.notes}</div>}
                </td>
                <td className={td}>
                  <span className="text-[12.5px] capitalize text-n-600">{n.type}</span>
                </td>
                <td className={td}>
                  {n.includeInInventory ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-info-bd bg-info-bg px-2 py-0.5 text-[11.5px] font-semibold text-info">
                      Available to sell
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-n-200 bg-n-50 px-2 py-0.5 text-[11.5px] font-semibold text-n-500">
                      <EyeOff size={11} /> Excluded
                    </span>
                  )}
                </td>
                <td className={`${td} mono text-right`}>{n.productCount || <span className="text-n-300">—</span>}</td>
                <td className={`${td} mono text-right`}>{n.unitCount || <span className="text-n-300">—</span>}</td>
                <td className={`${td} mono text-right`}>
                  {n.children.length > 0 && n.rollupUnitCount > 0 ? n.rollupUnitCount : <span className="text-n-300">—</span>}
                </td>
                <td className={`${td} text-right`}>
                  <div className="flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                    <IconBtn title="Adjust stock here" onClick={() => onAdjust(n.id)}><Plus size={14} /></IconBtn>
                    <IconBtn title="Transfer stock out of here" onClick={() => onTransfer(n.id)}><ArrowRight size={14} /></IconBtn>
                    <IconBtn title="Add sub-warehouse" onClick={() => onAddChild(n.id)}><WarehouseIcon size={14} /></IconBtn>
                    <IconBtn title="Edit" onClick={() => onEdit(n)}><Pencil size={14} /></IconBtn>
                    <IconBtn title="Remove" danger onClick={() => onDelete(n)}><Trash2 size={14} /></IconBtn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 ${
        danger ? 'hover:border-danger-bd hover:bg-danger-bg hover:text-danger' : 'hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- stock tab

function StockTab({ tree, onAdjust }: { tree: WarehouseNode[]; onAdjust: (id: string) => void }) {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = usePersistentState('warehouses.stock.warehouse', '');
  const [includeChildren, setIncludeChildren] = usePersistentState('warehouses.stock.includeChildren', true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const flat = flatten(tree);
  const params = { q: q || undefined, warehouseId: warehouseId || undefined, includeChildren, nonZeroOnly: true, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['stock', 'levels', params], queryFn: () => stockApi.levels(params) });

  const rows = data?.rows ?? [];
  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  return (
    <>
      <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
          <input className="input pl-8" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search SKU or product name" />
        </div>
        <div className="w-[240px]">
          <Select
            value={warehouseId}
            onChange={(v) => { setWarehouseId(v); setPage(1); }}
            placeholder="All warehouses"
            options={flat.map((w) => ({ value: w.id, label: `${'  '.repeat(w.depth)}${w.name}` }))}
          />
        </div>
        {warehouseId && (
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-n-600">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={includeChildren} onChange={(e) => { setIncludeChildren(e.target.checked); setPage(1); }} />
            Include sub-warehouses
          </label>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} text-left`}>SKU</th>
              <th className={`${th} text-left`}>Product</th>
              <th className={`${th} text-left`}>Warehouse</th>
              <th className={`${th} text-right`}>On hand</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className={td} colSpan={5}>Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td className={`${td} py-10 text-center text-n-400`} colSpan={5}>
                  No stock recorded yet. Use <strong>Import stock</strong> to load your opening quantities, or <strong>Adjust stock</strong> for a single product.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.productId}-${r.warehouseId}`} className="group hover:bg-n-25">
                <td className={`${td} code font-semibold text-n-800`}>{r.sku}</td>
                <td className={td}>{r.productName}</td>
                <td className={td}>
                  {r.warehouseName}
                  {!r.includeInInventory && <span className="ml-2 text-[11px] text-n-400">(excluded)</span>}
                </td>
                <td className={`${td} mono text-right font-semibold ${r.includeInInventory ? 'text-n-800' : 'text-n-400'}`}>{r.quantityOnHand}</td>
                <td className={`${td} text-right`}>
                  <div className="flex justify-end opacity-0 transition group-hover:opacity-100">
                    <IconBtn title="Adjust" onClick={() => onAdjust(r.warehouseId)}><Pencil size={14} /></IconBtn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      <Pagination
        page={data?.page ?? 1}
        pageCount={data?.pageCount ?? 1}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        pageSizeOptions={DEFAULT_PAGE_SIZES}
      />
    </>
  );
}

// ---------------------------------------------------------------- transfers tab

/**
 * Past transfers, newest first.
 *
 * Each row expands to its lines rather than linking to a detail page: a transfer is three fields
 * and a short list, and a page of its own would be almost entirely chrome.
 */
function TransfersTab({ tree, onNew }: { tree: WarehouseNode[]; onNew: () => void }) {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = usePersistentState('warehouses.transfers.warehouse', '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const flat = flatten(tree);
  const params = { q: q || undefined, warehouseId: warehouseId || undefined, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['transfers', params], queryFn: () => transfersApi.list(params) });
  const rows = data?.rows ?? [];

  const toggle = (id: string) =>
    setExpanded((sx) => { const n = new Set(sx); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
            <input className="input pl-8" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search reference, SKU or notes" />
          </div>
          <div className="w-[240px]">
            <Select
              value={warehouseId}
              onChange={(v) => { setWarehouseId(v); setPage(1); }}
              placeholder="All warehouses"
              options={flat.map((w) => ({ value: w.id, label: `${'  '.repeat(w.depth)}${w.name}` }))}
            />
          </div>
          {warehouseId && <span className="text-[12px] text-n-500">Both what left it and what arrived.</span>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Reference</th>
                <th className={`${th} text-left`}>When</th>
                <th className={`${th} text-left`}>Route</th>
                <th className={`${th} text-right`}>Lines</th>
                <th className={`${th} text-right`}>Units</th>
                <th className={`${th} text-left`}>By</th>
                <th className={`${th} text-left`}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={td} colSpan={7}>Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td className={`${td} py-10 text-center text-n-400`} colSpan={7}>
                    No transfers yet. Use <button onClick={onNew} className="font-semibold text-teal-700 underline">Transfer stock</button> to move
                    stock between warehouses, or import a spreadsheet of them.
                  </td>
                </tr>
              )}
              {rows.map((t) => (
                <Fragment key={t.id}>
                  <tr className="cursor-pointer hover:bg-n-25" onClick={() => toggle(t.id)}>
                    <td className={`${td} code font-semibold text-n-800`}>
                      <span className="mr-1.5 inline-block text-n-400">{expanded.has(t.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                      {t.reference}
                    </td>
                    <td className={`${td} mono whitespace-nowrap text-n-500`}>{new Date(t.createdAt).toLocaleString()}</td>
                    <td className={td}>
                      <span className="whitespace-nowrap">
                        {t.from.name} <ArrowRight size={12} className="mx-1 inline text-n-400" /> {t.to.name}
                      </span>
                    </td>
                    <td className={`${td} mono text-right`}>{t.lineCount}</td>
                    <td className={`${td} mono text-right font-semibold text-n-800`}>{t.totalUnits}</td>
                    <td className={`${td} text-[12px] text-n-500`}>{t.createdBy ?? '—'}</td>
                    <td className={`${td} text-[12px] text-n-500`}>{t.notes ?? ''}</td>
                  </tr>
                  {expanded.has(t.id) && (
                    <tr>
                      <td className="border-b border-n-100 bg-n-25 px-4 py-3" colSpan={7}>
                        <div className="flex flex-col gap-1.5">
                          {t.lines.map((l) => (
                            <div key={l.productId} className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                              <span className="code font-semibold text-n-800">{l.sku}</span>
                              <span className="text-n-500">{l.productName}</span>
                              <span className="mono ml-auto font-semibold text-n-700">{l.quantity}</span>
                              {l.serials.length > 0 && (
                                <div className="mono w-full text-[11.5px] text-n-400">{l.serials.join(', ')}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={data?.page ?? 1}
        pageCount={data?.pageCount ?? 1}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        pageSizeOptions={DEFAULT_PAGE_SIZES}
      />
    </>
  );
}

// ---------------------------------------------------------------- movements tab

function MovementsTab({ tree }: { tree: WarehouseNode[] }) {
  const [warehouseId, setWarehouseId] = usePersistentState('warehouses.movements.warehouse', '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const flat = flatten(tree);

  const params = { warehouseId: warehouseId || undefined, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['stock', 'movements', params], queryFn: () => stockApi.movements(params) });
  const rows = data?.rows ?? [];

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

  return (
    <>
      <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-n-100 px-4 py-3">
        <div className="w-[240px]">
          <Select
            value={warehouseId}
            onChange={(v) => { setWarehouseId(v); setPage(1); }}
            placeholder="All warehouses"
            options={flat.map((w) => ({ value: w.id, label: `${'  '.repeat(w.depth)}${w.name}` }))}
          />
        </div>
        <span className="text-[12px] text-n-500">Every stock change, newest first.</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} text-left`}>When</th>
              <th className={`${th} text-left`}>SKU</th>
              <th className={`${th} text-left`}>Warehouse</th>
              <th className={`${th} text-left`}>Reason</th>
              <th className={`${th} text-right`}>Change</th>
              <th className={`${th} text-right`}>Balance after</th>
              <th className={`${th} text-left`}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className={td} colSpan={7}>Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td className={`${td} py-10 text-center text-n-400`} colSpan={7}>No stock movements yet.</td></tr>
            )}
            {rows.map((m) => (
              <tr key={m.id} className="hover:bg-n-25">
                <td className={`${td} mono whitespace-nowrap text-n-500`}>{new Date(m.createdAt).toLocaleString()}</td>
                <td className={`${td} code font-semibold text-n-800`}>{m.sku}</td>
                <td className={td}>{m.warehouseName}</td>
                <td className={td}>
                  <span className="tag">{REASON_LABELS[m.reason] ?? m.reason}</span>
                  {/* A transfer leg alone reads as an unexplained -12; the other end is what makes it a move. */}
                  {m.counterparty && (
                    <span className="ml-1.5 whitespace-nowrap text-[11.5px] text-n-500">
                      {m.qtyDelta < 0 ? '→' : '←'} {m.counterparty}
                    </span>
                  )}
                </td>
                <td className={`${td} mono text-right font-semibold ${m.qtyDelta > 0 ? 'text-teal-700' : 'text-danger'}`}>
                  {m.qtyDelta > 0 ? '+' : ''}{m.qtyDelta}
                </td>
                <td className={`${td} mono text-right`}>{m.balanceAfter}</td>
                <td className={`${td} text-[12px] text-n-500`}>
                  {m.notes ?? m.reference ?? ''}
                  {m.serials && m.serials.length > 0 && (
                    <div className="mono mt-0.5 text-[11px] text-n-400">{m.serials.join(', ')}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      <Pagination
        page={data?.page ?? 1}
        pageCount={data?.pageCount ?? 1}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        pageSizeOptions={DEFAULT_PAGE_SIZES}
      />
    </>
  );
}

// ---------------------------------------------------------------- import

function StockImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  // Warehouse names for the template dropdown, flattened from the tree — a nested list is still a
  // flat set of names as far as a spreadsheet cell is concerned.
  const { data: whTree = [] } = useQuery({ queryKey: ['warehouses', 'tree', true], queryFn: () => warehousesApi.tree({ includeInactive: false }) });
  const flatten = (nodes: WarehouseNode[]): { name: string }[] =>
    nodes.flatMap((n) => [{ name: n.name }, ...flatten((n.children ?? []) as WarehouseNode[])]);
  const warehouses = flatten(whTree as WarehouseNode[]);

  const commit = async (rows: Record<string, string>[]) => {
    const check = await stockApi.importValidate(rows.map((r) => ({ sku: r.sku, warehouse: r.warehouse, quantity: r.quantity })));
    const bad = check.rows.filter((r) => !r.valid);
    if (bad.length) {
      // Nothing is written unless the whole sheet is clean — a half-applied opening
      // balance is worse than none.
      toast.error(`${bad.length} row${bad.length === 1 ? '' : 's'} rejected — nothing imported. First: row ${bad[0].row}, ${bad[0].errors[0]}`);
      throw new Error('validation failed');
    }
    const res = await stockApi.importCommit(
      check.rows.map((r) => ({ productId: r.productId!, warehouseId: r.warehouseId!, quantityOnHand: r.quantityOnHand! })),
    );
    toast.success(`${res.applied} stock level${res.applied === 1 ? '' : 's'} set${res.unchanged ? `, ${res.unchanged} already correct` : ''}`);
    onDone();
  };

  return (
    <ModalShell open title="Import Opening Stock" subtitle="Set quantities per SKU and warehouse from a spreadsheet." primaryLabel="Close" onPrimary={onClose} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
          Quantities are treated as the <strong>true count</strong> for that SKU in that warehouse — not added to what is already there.
          Every change is recorded in the movement history as an opening balance.
          <button onClick={() => downloadStockTemplate(warehouses)} className="ml-1 font-semibold underline">Download the template</button>.
        </p>
        <BulkImport fields={STOCK_IMPORT_FIELDS} onCommit={commit} onClose={onClose} />
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------- helpers

function flatten(tree: WarehouseNode[]): WarehouseNode[] {
  const out: WarehouseNode[] = [];
  const walk = (list: WarehouseNode[]) => { for (const n of list) { out.push(n); walk(n.children); } };
  walk(tree);
  return out;
}

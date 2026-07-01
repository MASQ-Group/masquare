import { useState } from 'react';
import { toast } from 'sonner';
import { ModalShell, downloadSheet } from '@masquare/ui';
import type { Product } from '../../lib/api';
import { EXPORT_COLUMNS } from './columns';

interface Props {
  products: Product[];
  onClose: () => void;
}

/** Export selected products: choose purpose (add/edit template), which columns, and format. */
export function ExportModal({ products, onClose }: Props) {
  const [purpose, setPurpose] = useState<'add' | 'edit'>('edit');
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(EXPORT_COLUMNS.filter((c) => c.editDefault).map((c) => c.key)),
  );

  const applyPurpose = (p: 'add' | 'edit') => {
    setPurpose(p);
    // edit defaults to identity + common fields; add offers the full set.
    setSelected(new Set(EXPORT_COLUMNS.filter((c) => (p === 'edit' ? c.editDefault : true)).map((c) => c.key)));
  };

  const toggle = (key: string) =>
    setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const doExport = () => {
    const cols = EXPORT_COLUMNS.filter((c) => selected.has(c.key));
    if (cols.length === 0) { toast.error('Select at least one column'); return; }
    // Main SKU is the identity key — always include it so the file can be re-imported.
    if (!selected.has('mainSku')) cols.unshift(EXPORT_COLUMNS.find((c) => c.key === 'mainSku')!);
    const header = cols.map((c) => c.label);
    const rows = products.map((p) => cols.map((c) => c.get(p)));
    downloadSheet(`masquare-products-${purpose}-${products.length}`, [header, ...rows], format);
    toast.success(`Exported ${products.length} products`);
    onClose();
  };

  return (
    <ModalShell
      open
      title={`Export ${products.length} product${products.length === 1 ? '' : 's'}`}
      primaryLabel="Download"
      onPrimary={doExport}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div>
          <label className="label">Purpose of this file</label>
          <div className="flex gap-2">
            {([['edit', 'Edit existing products'], ['add', 'Add new products']] as const).map(([val, lbl]) => (
              <button key={val} onClick={() => applyPurpose(val)}
                className={`h-10 flex-1 rounded-md border text-[13px] font-medium ${purpose === val ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:bg-n-50'}`}>
                {lbl}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-n-400">
            {purpose === 'edit'
              ? 'Includes Main SKU (used to match) plus commonly edited fields. Re-import with “Edit existing”.'
              : 'Full column set as a starting point for new products. Re-import with “Add new”.'}
          </p>
        </div>

        <div>
          <label className="label">Columns to include</label>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-n-200 p-3 max-[560px]:grid-cols-1">
            {EXPORT_COLUMNS.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-n-50">
                <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={selected.has(c.key)} disabled={c.key === 'mainSku'} onChange={() => toggle(c.key)} />
                <span className="text-[13px] text-n-700">{c.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Format</label>
          <div className="flex gap-2">
            {(['xlsx', 'csv'] as const).map((f) => (
              <button key={f} onClick={() => setFormat(f)}
                className={`mono h-10 w-24 rounded-md border text-[13px] font-medium uppercase ${format === f ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:bg-n-50'}`}>
                .{f}
              </button>
            ))}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

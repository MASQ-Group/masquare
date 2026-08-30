import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell, downloadSheet, downloadTemplate } from '@masquare/ui';
import {
  brandsApi, categoriesApi, fulfilmentTypesApi, productClassesApi, productTypesApi, vatClassesApi, vendorsApi,
  type Product,
} from '../../lib/api';
import { categoryOptions } from '../../lib/categoryPaths';
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

  // Cached by the products page, so opening this modal costs nothing extra.
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const ptypes = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });
  const ftypes = useQuery({ queryKey: ['fulfilment-types'], queryFn: () => fulfilmentTypesApi.list() });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.list() });
  const pclasses = useQuery({ queryKey: ['product-classes'], queryFn: () => productClassesApi.list() });
  const vatClasses = useQuery({ queryKey: ['vat-classes'], queryFn: () => vatClassesApi.list() });

  const doExport = async () => {
    const cols = EXPORT_COLUMNS.filter((c) => selected.has(c.key));
    if (cols.length === 0) { toast.error('Select at least one column'); return; }
    // Main SKU is the identity key — always include it so the file can be re-imported.
    if (!selected.has('mainSku')) cols.unshift(EXPORT_COLUMNS.find((c) => c.key === 'mainSku')!);
    const header = cols.map((c) => c.label);
    // The category is written as its full path, matching what the dropdown offers, so an exported
    // value is one of the listed ones rather than a leaf name that merely resembles it. The import
    // takes either form, but a cell that disagrees with its own dropdown invites someone to
    // "correct" a value that was already right.
    const paths = categoryOptions(categories.data ?? []);
    const rows = products.map((p) => cols.map((c) => (
      c.key === 'category' && p.category?.id
        ? paths.find((x) => x.id === p.category!.id)?.name ?? c.get(p)
        : c.get(p)
    )));
    const name = `masquare-products-${purpose}-${products.length}`;

    if (format === 'csv') {
      // CSV carries no validation — it is a flat text format. Worth saying so, because the xlsx
      // now does, and silently losing the dropdowns would look like a bug rather than a choice.
      downloadSheet(name, [header, ...rows], 'csv');
      toast.success(`Exported ${products.length} products — CSV has no dropdowns; use .xlsx for those`);
      onClose();
      return;
    }

    // The exported rows are exactly the ones about to be edited, so they get the same dropdowns a
    // blank template does. Every reference column is a closed list on import; without them here,
    // editing a category by hand means guessing at a value the import will then refuse.
    const col = (key: string) => cols.findIndex((c) => c.key === key);
    await downloadTemplate(name, {
      sheetName: 'Products',
      headers: header,
      sampleRows: rows,
      lists: [
        { column: col('brand'), values: (brands.data ?? []).map((b: any) => b.name) },
        { column: col('vendor'), values: (vendors.data ?? []).map((v: any) => v.name) },
        { column: col('productType'), values: (ptypes.data ?? []).map((t: any) => t.name) },
        { column: col('fulfilmentType'), values: (ftypes.data ?? []).map((f: any) => f.code ?? f.name) },
        { column: col('category'), values: categoryOptions(categories.data ?? []).map((c) => c.name) },
        { column: col('productClass'), values: (pclasses.data ?? []).map((c: any) => c.name) },
        { column: col('vatClass'), values: (vatClasses.data ?? []).map((v: any) => v.name) },
      // A column the user chose not to export has no index here, so it is dropped rather than
      // pointing a dropdown at whatever column happens to sit at -1.
      ].filter((l) => l.column >= 0),
    });
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

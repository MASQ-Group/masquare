import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Columns3, Download, Filter, Grid, List, Package, Pencil, Plus, Search, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { downloadSheet } from '@masquare/ui';
import {
  brandsApi, categoriesApi, fulfilmentTypesApi, productsApi, productTypesApi, vendorsApi,
  type Product, type ProductListParams,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney } from '../lib/format';
import { ProductModal } from '../components/products/ProductModal';
import { ExportModal } from '../components/products/ExportModal';
import { BulkEditModal } from '../components/products/BulkEditModal';
import { ProductImportModal } from '../components/products/ProductImportModal';
import { EXPORT_COLUMNS } from '../components/products/columns';

const SEARCH_FIELDS = [
  { key: '', label: 'All fields' },
  { key: 'mainSku', label: 'Main SKU' },
  { key: 'title', label: 'Title' },
  { key: 'ean', label: 'EAN' },
  { key: 'hsCode', label: 'HS Code' },
];

const OPTIONAL_COLUMNS: { key: string; label: string; render: (p: Product) => React.ReactNode; mono?: boolean; right?: boolean }[] = [
  { key: 'productType', label: 'Product Type', render: (p) => p.productType?.name ?? '—' },
  { key: 'vendorSku', label: 'Vendor SKU', render: (p) => p.vendorSku ?? '—', mono: true },
  { key: 'manufacturerSku', label: 'Mfr SKU', render: (p) => p.manufacturerSku ?? '—', mono: true },
  { key: 'ean', label: 'EAN', render: (p) => p.ean ?? '—', mono: true },
  { key: 'upc', label: 'UPC', render: (p) => p.upc ?? '—', mono: true },
  { key: 'countryOfOrigin', label: 'Country', render: (p) => p.countryOfOrigin ?? '—', mono: true },
  { key: 'hsCode', label: 'HS Code', render: (p) => p.hsCode ?? '—', mono: true },
  { key: 'map', label: 'MAP', render: (p) => formatMoney(p.map), mono: true, right: true },
  { key: 'msrp', label: 'MSRP', render: (p) => formatMoney(p.msrp), mono: true, right: true },
  { key: 'volumetricWeightKg', label: 'Volumetric', render: (p) => p.volumetricWeightKg ?? '—', mono: true, right: true },
];

interface Filters {
  vendorId: string[]; brandId: string[]; fulfilmentTypeId: string[]; productTypeId: string[]; categoryId: string[]; country: string;
}
const EMPTY: Filters = { vendorId: [], brandId: [], fulfilmentTypeId: [], productTypeId: [], categoryId: [], country: '' };

export function ProductsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [searchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const [qInput, setQInput] = useState(urlQ);
  const [q, setQ] = useState(urlQ);
  // Deep link from the global search: /products?q=… applies (and re-applies) the search.
  useEffect(() => { if (urlQ) { setQInput(urlQ); setQ(urlQ); setPage(1); } }, [urlQ]);
  const [field, setField] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [cols, setCols] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkEdit, setBulkEdit] = useState(false);
  const [exportProducts, setExportProducts] = useState<Product[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMenu, setOpenMenu] = useState<'filters' | 'columns' | null>(null);

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const params: ProductListParams = {
    q: q || undefined, field: field || undefined, page, pageSize: 25,
    vendorId: filters.vendorId.length ? filters.vendorId : undefined,
    brandId: filters.brandId.length ? filters.brandId : undefined,
    fulfilmentTypeId: filters.fulfilmentTypeId.length ? filters.fulfilmentTypeId : undefined,
    productTypeId: filters.productTypeId.length ? filters.productTypeId : undefined,
    categoryId: filters.categoryId.length ? filters.categoryId : undefined,
    country: filters.country || undefined,
  };

  const { data, isLoading } = useQuery({ queryKey: ['products', params], queryFn: () => productsApi.list(params) });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const ftypes = useQuery({ queryKey: ['fulfilment-types'], queryFn: () => fulfilmentTypesApi.list() });
  const ptypes = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.list() });

  const del = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => { toast.success('Product removed'); qc.invalidateQueries({ queryKey: ['products'] }); },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 25));

  const nameOf = (list: { id: string; name: string }[] | undefined, id: string) => list?.find((x) => x.id === id)?.name ?? id;

  const activeChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = [];
    filters.vendorId.forEach((id) => chips.push({ label: `Vendor: ${nameOf(vendors.data, id)}`, onRemove: () => toggle('vendorId', id) }));
    filters.brandId.forEach((id) => chips.push({ label: `Brand: ${nameOf(brands.data, id)}`, onRemove: () => toggle('brandId', id) }));
    filters.fulfilmentTypeId.forEach((id) => chips.push({ label: `Fulfilment: ${nameOf(ftypes.data, id)}`, onRemove: () => toggle('fulfilmentTypeId', id) }));
    filters.productTypeId.forEach((id) => chips.push({ label: `Type: ${nameOf(ptypes.data, id)}`, onRemove: () => toggle('productTypeId', id) }));
    filters.categoryId.forEach((id) => chips.push({ label: `Category: ${nameOf(categories.data, id)}`, onRemove: () => toggle('categoryId', id) }));
    if (filters.country) chips.push({ label: `Country: ${filters.country}`, onRemove: () => setFilters((f) => ({ ...f, country: '' })) });
    return chips;
  }, [filters, vendors.data, brands.data, ftypes.data, ptypes.data, categories.data]);

  const anyFilter = activeChips.length > 0 || !!q;

  function toggle(key: keyof Filters, id: string) {
    setPage(1);
    setFilters((f) => {
      const arr = f[key] as string[];
      return { ...f, [key]: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] };
    });
  }
  const clearAll = () => { setFilters(EMPTY); setQInput(''); setQ(''); setPage(1); };

  const bulkDelete = useMutation({
    mutationFn: () => productsApi.bulkDelete([...selected]),
    onSuccess: (r: any) => { toast.success(`Removed ${r.count} products`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: () => toast.error('Bulk delete failed'),
  });

  const onExport = async () => {
    if (selected.size === 0) {
      downloadSheet('masquare-products-template', [EXPORT_COLUMNS.map((c) => c.label), EXPORT_COLUMNS.map((c) => c.sample)], 'xlsx');
      toast.success('Template downloaded — fill it in, then Import');
      return;
    }
    try {
      const products = await productsApi.byIds([...selected]);
      setExportProducts(products);
    } catch { toast.error('Could not load selected products'); }
  };

  const allSelected = items.length > 0 && items.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected((prev) => {
    const n = new Set(prev);
    if (items.every((p) => n.has(p.id))) items.forEach((p) => n.delete(p.id));
    else items.forEach((p) => n.add(p.id));
    return n;
  });
  const toggleOne = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex-1">
          <div className="eyebrow mb-1.5">Products module</div>
          <h1 className="text-[24px] font-semibold tracking-tight text-n-900">All products</h1>
          <p className="mt-1 text-[13.5px] text-n-500">
            Master catalogue{user?.companies.length ? `, co-owned by ${user.companies.map((c) => c.officialName).join(' & ')}` : ''}.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => setImportOpen(true)}><Upload size={16} /> Import</button>
        <button className="btn btn-ghost" onClick={onExport}><Download size={16} /> Export</button>
        <button className="btn btn-primary" onClick={() => setEditing(null)}><Plus size={17} /> Add product</button>
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="flex h-[38px] min-w-[280px] flex-1 items-center overflow-hidden rounded-md border border-n-200 bg-n-0 focus-within:border-teal-400">
          <select value={field} onChange={(e) => setField(e.target.value)} className="h-full border-r border-n-200 bg-n-50 px-2 text-[12.5px] font-medium text-n-600 outline-none">
            {SEARCH_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <Search size={16} className="ml-2.5 text-n-400" />
          <input className="h-full flex-1 px-2 text-[13px] outline-none" placeholder="Search SKU, title, attributes…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>

        <div className="relative">
          <button className="filter-btn inline-flex h-[38px] items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-medium text-n-700 hover:border-n-300" onClick={() => setOpenMenu(openMenu === 'filters' ? null : 'filters')}>
            <Filter size={15} className="opacity-60" /> Filters {activeChips.length > 0 && <span className="mono rounded-pill bg-teal-100 px-1.5 text-[11px] text-teal-700">{activeChips.length}</span>}
          </button>
          {openMenu === 'filters' && (
            <FilterPanel
              onClose={() => setOpenMenu(null)}
              groups={[
                { key: 'vendorId', label: 'Vendor', options: vendors.data ?? [] },
                { key: 'brandId', label: 'Brand', options: brands.data ?? [] },
                { key: 'fulfilmentTypeId', label: 'Fulfilment', options: ftypes.data ?? [] },
                { key: 'productTypeId', label: 'Product type', options: ptypes.data ?? [] },
                { key: 'categoryId', label: 'Category', options: (categories.data ?? []).map((c) => ({ id: c.id, name: c.name })) },
              ]}
              filters={filters}
              onToggle={toggle}
              country={filters.country}
              onCountry={(v) => { setFilters((f) => ({ ...f, country: v })); setPage(1); }}
            />
          )}
        </div>

        {view === 'list' && (
          <div className="relative">
            <button className="inline-flex h-[38px] items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-medium text-n-700 hover:border-n-300" onClick={() => setOpenMenu(openMenu === 'columns' ? null : 'columns')}>
              <Columns3 size={15} className="opacity-60" /> Columns
            </button>
            {openMenu === 'columns' && (
              <div className="absolute right-0 top-11 z-40 w-56 rounded-lg border border-n-200 bg-n-0 p-2 shadow-lg" onMouseLeave={() => setOpenMenu(null)}>
                <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-n-500">Optional columns</div>
                {OPTIONAL_COLUMNS.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-n-50">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={cols.has(c.key)} onChange={() => setCols((s) => { const n = new Set(s); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })} />
                    <span className="text-[13px] text-n-700">{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {anyFilter && <button className="inline-flex h-[38px] items-center rounded-md border border-orange-200 px-3 text-[13px] font-medium text-orange-600 hover:bg-orange-50" onClick={clearAll}>Clear all</button>}

        <div className="ml-auto inline-flex gap-0.5 rounded-md bg-n-100 p-0.5">
          <button className={`grid h-8 w-9 place-items-center rounded ${view === 'list' ? 'bg-n-0 text-teal-700 shadow-xs' : 'text-n-500'}`} onClick={() => setView('list')} title="List"><List size={16} /></button>
          <button className={`grid h-8 w-9 place-items-center rounded ${view === 'grid' ? 'bg-n-0 text-teal-700 shadow-xs' : 'text-n-500'}`} onClick={() => setView('grid')} title="Grid"><Grid size={16} /></button>
        </div>
      </div>

      {/* Chips */}
      {activeChips.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {activeChips.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-pill border border-teal-100 bg-teal-50 px-3 py-1 text-[12.5px] font-medium text-teal-800">
              {c.label}
              <button onClick={c.onRemove} className="grid h-4 w-4 place-items-center rounded-full text-teal-600 hover:bg-teal-100"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2">
          <span className="text-[13px] font-semibold text-teal-800">{selected.size} selected</span>
          <div className="mx-1 h-5 w-px bg-teal-200" />
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-medium text-n-700 hover:bg-n-50" onClick={() => setBulkEdit(true)}><SlidersHorizontal size={14} /> Bulk edit</button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-medium text-n-700 hover:bg-n-50" onClick={onExport}><Download size={14} /> Export selected</button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-danger-bd bg-n-0 px-2.5 text-[12.5px] font-medium text-danger hover:bg-danger-bg" onClick={() => { if (confirm(`Remove ${selected.size} products?`)) bulkDelete.mutate(); }}><Trash2 size={14} /> Delete</button>
          <button className="ml-auto text-[12.5px] font-medium text-teal-700 hover:underline" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {view === 'list' ? (
        <ListView items={items} loading={isLoading} cols={cols} selected={selected} allSelected={allSelected} onToggleAll={toggleAll} onToggleOne={toggleOne} onEdit={setEditing} onDelete={(p) => confirm(`Remove ${p.mainSku}?`) && del.mutate(p.id)} />
      ) : (
        <GridView items={items} loading={isLoading} onEdit={setEditing} />
      )}

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[13px] text-n-500">Showing <span className="mono">{items.length}</span> of <span className="mono">{total}</span> products</span>
        <div className="flex gap-1">
          <button disabled={page <= 1} className="mono grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-[13px] text-n-600 disabled:opacity-40" onClick={() => setPage((p) => p - 1)}>‹</button>
          <span className="mono grid h-8 min-w-8 place-items-center px-2 text-[13px] text-n-600">{page} / {pageCount}</span>
          <button disabled={page >= pageCount} className="mono grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-[13px] text-n-600 disabled:opacity-40" onClick={() => setPage((p) => p + 1)}>›</button>
        </div>
      </div>

      {editing !== undefined && (
        <ProductModal product={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); qc.invalidateQueries({ queryKey: ['products'] }); }} />
      )}
      {importOpen && (
        <ProductImportModal onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); qc.invalidateQueries({ queryKey: ['products'] }); }} />
      )}
      {exportProducts && <ExportModal products={exportProducts} onClose={() => setExportProducts(null)} />}
      {bulkEdit && (
        <BulkEditModal ids={[...selected]} onClose={() => setBulkEdit(false)} onDone={() => { setBulkEdit(false); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['products'] }); }} />
      )}
    </div>
  );
}

function ListView({ items, loading, cols, selected, allSelected, onToggleAll, onToggleOne, onEdit, onDelete }: {
  items: Product[]; loading: boolean; cols: Set<string>;
  selected: Set<string>; allSelected: boolean; onToggleAll: () => void; onToggleOne: (id: string) => void;
  onEdit: (p: Product) => void; onDelete: (p: Product) => void;
}) {
  const extra = OPTIONAL_COLUMNS.filter((c) => cols.has(c.key));
  const span = 11 + extra.length;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse">
          <thead>
            <tr>
              <th className="border-b border-n-200 bg-n-25 px-3 py-3">
                <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={allSelected} onChange={onToggleAll} title="Select all" />
              </th>
              {['', 'SKU', 'Aliases SKUs', 'Product', 'Brand', 'Vendor', 'Fulfilment', 'Category', 'Attributes'].map((h, i) => (
                <th key={i} className="border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap">{h}</th>
              ))}
              {extra.map((c) => <th key={c.key} className={`border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${c.right ? 'text-right' : 'text-left'}`}>{c.label}</th>)}
              <th className="border-b border-n-200 bg-n-25 px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-n-500">Purchase cost</th>
              <th className="border-b border-n-200 bg-n-25" />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={span} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={span} className="px-4 py-12 text-center text-[13px] text-n-500">No products match. Add your first product, or import a .csv.</td></tr>}
            {items.map((p) => (
              <tr key={p.id} className={`cursor-pointer hover:bg-teal-50 ${selected.has(p.id) ? 'bg-teal-50/60' : ''}`} onClick={() => onEdit(p)}>
                <td className="border-b border-n-100 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={selected.has(p.id)} onChange={() => onToggleOne(p.id)} />
                </td>
                <td className="border-b border-n-100 px-4 py-2.5">
                  <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-md bg-n-100 text-n-400">
                    {p.featuredImage ? <img src={p.featuredImage} alt="" className="h-full w-full object-cover" /> : <Package size={18} />}
                  </div>
                </td>
                <td className="border-b border-n-100 px-4 py-2.5"><div className="mono font-medium text-n-800">{p.mainSku}</div></td>
                <td className="border-b border-n-100 px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {p.aliases.length === 0 && <span className="text-n-300">—</span>}
                    {p.aliases.slice(0, 4).map((a) => (
                      <span key={a.id ?? a.skuValue} className="mono inline-flex items-center gap-1 rounded bg-n-100 px-1.5 py-0.5 text-[11px] text-n-600" title={a.label ?? undefined}>
                        {a.skuValue}
                        {a.fulfilmentType?.code && <span className="text-[9px] font-semibold text-teal-700">{a.fulfilmentType.code}</span>}
                      </span>
                    ))}
                    {p.aliases.length > 4 && <span className="text-[11px] text-n-400">+{p.aliases.length - 4}</span>}
                  </div>
                </td>
                <td className="border-b border-n-100 px-4 py-2.5"><div className="font-medium text-n-800">{p.title}</div>{p.productType && <div className="text-[12px] text-n-500">{p.productType.name}</div>}</td>
                <td className="border-b border-n-100 px-4 py-2.5 text-[13.5px] text-n-700">{p.brand?.name ?? '—'}</td>
                <td className="border-b border-n-100 px-4 py-2.5 text-[13.5px] text-n-700">{p.vendor?.name ?? '—'}</td>
                <td className="border-b border-n-100 px-4 py-2.5">{p.fulfilmentType ? <span className={`tag ${p.fulfilmentType.code === 'FBA' ? 'border border-info-bd bg-info-bg text-info' : 'border border-n-200 bg-n-100 text-n-600'}`}>{p.fulfilmentType.code ?? p.fulfilmentType.name}</span> : '—'}</td>
                <td className="border-b border-n-100 px-4 py-2.5 text-[13.5px] text-n-700">{p.category?.name ?? '—'}</td>
                <td className="border-b border-n-100 px-4 py-2.5"><div className="flex flex-wrap gap-1">{p.attributes.slice(0, 3).map((a) => <span key={a.id} className="mono rounded bg-n-100 px-1.5 py-0.5 text-[11px] text-n-600">{a.value}</span>)}</div></td>
                {extra.map((c) => <td key={c.key} className={`border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700 ${c.mono ? 'mono' : ''} ${c.right ? 'text-right' : ''}`}>{c.render(p)}</td>)}
                <td className="border-b border-n-100 px-4 py-2.5 text-right"><span className="mono font-medium text-n-800">{formatMoney(p.purchaseCost)}</span></td>
                <td className="border-b border-n-100 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" onClick={() => onEdit(p)}><Pencil size={15} /></button>
                    <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => onDelete(p)}><Trash2 size={15} /></button>
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

function GridView({ items, loading, onEdit }: { items: Product[]; loading: boolean; onEdit: (p: Product) => void }) {
  if (loading) return <div className="card px-4 py-12 text-center text-[13px] text-n-500">Loading…</div>;
  if (items.length === 0) return <div className="card px-4 py-12 text-center text-[13px] text-n-500">No products match. Add your first product, or import a .csv.</div>;
  return (
    <div className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-3 max-[760px]:grid-cols-2">
      {items.map((p) => (
        <button key={p.id} onClick={() => onEdit(p)} className="card overflow-hidden text-left transition-shadow hover:shadow-md">
          <div className="grid aspect-square place-items-center bg-n-100 text-n-300">
            {p.featuredImage ? <img src={p.featuredImage} alt="" className="h-full w-full object-cover" /> : <Package size={32} />}
          </div>
          <div className="p-3">
            <div className="mono text-[12px] font-medium text-n-800">{p.mainSku}</div>
            <div className="mt-0.5 line-clamp-2 text-[13px] text-n-700">{p.title}</div>
            <div className="mt-1 text-[12px] text-n-500">{p.brand?.name ?? '—'}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function FilterPanel({
  groups, filters, onToggle, country, onCountry, onClose,
}: {
  groups: { key: keyof Filters; label: string; options: { id: string; name: string }[] }[];
  filters: Filters;
  onToggle: (key: keyof Filters, id: string) => void;
  country: string;
  onCountry: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-11 z-40 grid w-[560px] max-w-[calc(100vw-2rem)] grid-cols-2 gap-4 rounded-lg border border-n-200 bg-n-0 p-4 shadow-lg max-[760px]:left-0 max-[760px]:right-auto max-[760px]:w-[92vw] max-[760px]:grid-cols-1" onMouseLeave={onClose}>
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">{g.label}</div>
          <div className="max-h-36 overflow-auto pr-1">
            {g.options.length === 0 && <p className="text-[12px] text-n-400">None</p>}
            {g.options.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-n-50">
                <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={(filters[g.key] as string[]).includes(o.id)} onChange={() => onToggle(g.key, o.id)} />
                <span className="truncate text-[13px] text-n-700">{o.name}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">Country of origin</div>
        <input className="input mono" placeholder="e.g. CN" value={country} onChange={(e) => onCountry(e.target.value)} />
      </div>
    </div>
  );
}

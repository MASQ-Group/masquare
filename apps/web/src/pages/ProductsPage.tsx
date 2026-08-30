import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Columns3, ChevronsUpDown, Download, Filter, Grid, List, Package, Pencil, Plus, Search, SlidersHorizontal, Store, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { downloadTemplate, Pagination } from '@masquare/ui';
import {
  brandsApi, categoriesApi, fulfilmentTypesApi, productClassesApi, productsApi, productTypesApi, vatClassesApi, vendorsApi,
  type Product, type ProductListParams,
} from '../lib/api';
import { categoryOptions, categoryPath } from '../lib/categoryPaths';
import { useAuth } from '../lib/auth';
import { usePersistentState } from '../lib/usePersistentState';
import { formatMoney } from '../lib/format';
import { ProductModal } from '../components/products/ProductModal';
import { ExportModal } from '../components/products/ExportModal';
import { BulkEditModal } from '../components/products/BulkEditModal';
import { ProductImportModal } from '../components/products/ProductImportModal';
import { ConfirmDeleteModal } from '../components/products/ConfirmDeleteModal';
import { EXPORT_COLUMNS } from '../components/products/columns';
import { PageHeader } from '../components/common/PageHeader';
import { AnchoredPanel } from '../components/common/AnchoredPanel';
import { useIsMobile } from '../lib/useIsMobile';

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
  // Moving average landed cost. A bare EUR number (not a {amount,currency} object), and
  // em-dash until the product has been received at least once.
  { key: 'averageCost', label: 'Avg cost', render: (p) => (p.averageCostEur != null ? `€${p.averageCostEur.toFixed(2)}` : '—'), mono: true, right: true },
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
  const isMobile = useIsMobile();
  // On mobile the wide list table is unusable — always show the responsive card grid instead.
  const effectiveGrid = view === 'grid' || isMobile;
  const scopeBtnRef = useRef<HTMLButtonElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const [qInput, setQInput] = useState(urlQ);
  const [q, setQ] = useState(urlQ);
  // Deep link from the global search: /products?q=… applies (and re-applies) the search.
  useEffect(() => { if (urlQ) { setQInput(urlQ); setQ(urlQ); setPage(1); } }, [urlQ]);
  // Deep link from Channel Listings "Edit product": /products?edit=<id> opens that product's card.
  const editId = searchParams.get('edit');
  const openedEdit = useRef<string | null>(null);
  useEffect(() => {
    if (!editId) { openedEdit.current = null; return; }
    if (openedEdit.current === editId) return;
    openedEdit.current = editId;
    productsApi.get(editId)
      .then((p) => setEditing(p))
      .catch(() => toast.error('Product not found'))
      .finally(() => setSearchParams((sp) => { sp.delete('edit'); return sp; }, { replace: true }));
  }, [editId, setSearchParams]);
  const [field, setField] = useState('');
  // Filters persist across reloads until the user clears them.
  const [filters, setFilters] = usePersistentState<Filters>('products.filters', EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectingAll, setSelectingAll] = useState(false);
  const [cols, setCols] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkEdit, setBulkEdit] = useState(false);
  const [exportProducts, setExportProducts] = useState<Product[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMenu, setOpenMenu] = useState<'filters' | 'columns' | 'scope' | null>(null);
  // Pending delete awaiting confirmation: a single product, or a bulk delete of the selection.
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'single'; product: Product } | { kind: 'bulk'; ids: string[] } | null>(null);

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [qInput]);

  // Shared filter (without paging) — reused for the "select all matching" lookup.
  const filterParams: Omit<ProductListParams, 'page' | 'pageSize'> = {
    q: q || undefined, field: field || undefined,
    vendorId: filters.vendorId.length ? filters.vendorId : undefined,
    brandId: filters.brandId.length ? filters.brandId : undefined,
    fulfilmentTypeId: filters.fulfilmentTypeId.length ? filters.fulfilmentTypeId : undefined,
    productTypeId: filters.productTypeId.length ? filters.productTypeId : undefined,
    categoryId: filters.categoryId.length ? filters.categoryId : undefined,
    country: filters.country || undefined,
  };
  const params: ProductListParams = { ...filterParams, page, pageSize };

  const { data, isLoading } = useQuery({ queryKey: ['products', params], queryFn: () => productsApi.list(params) });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const ftypes = useQuery({ queryKey: ['fulfilment-types'], queryFn: () => fulfilmentTypesApi.list() });
  // These feed the template's dropdowns. Every one is a closed list on import: an unrecognised
  // value is refused, never created, so the dropdown is how a filled-in sheet stays importable.
  const vatClasses = useQuery({ queryKey: ['vat-classes'], queryFn: () => vatClassesApi.list() });
  const ptypes = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.list() });
  const pclasses = useQuery({ queryKey: ['product-classes'], queryFn: () => productClassesApi.list() });

  const del = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => { toast.success('Product removed'); setPendingDelete(null); qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: () => toast.error('Could not remove product'),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const allDbSelected = total > 0 && selected.size >= total;

  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const ids = await productsApi.ids(filterParams);
      setSelected(new Set(ids));
    } catch { toast.error('Could not select all products'); }
    finally { setSelectingAll(false); }
  };

  const nameOf = (list: { id: string; name: string }[] | undefined, id: string) => list?.find((x) => x.id === id)?.name ?? id;

  const activeChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = [];
    filters.vendorId.forEach((id) => chips.push({ label: `Vendor: ${nameOf(vendors.data, id)}`, onRemove: () => toggle('vendorId', id) }));
    filters.brandId.forEach((id) => chips.push({ label: `Brand: ${nameOf(brands.data, id)}`, onRemove: () => toggle('brandId', id) }));
    filters.fulfilmentTypeId.forEach((id) => chips.push({ label: `Fulfilment: ${nameOf(ftypes.data, id)}`, onRemove: () => toggle('fulfilmentTypeId', id) }));
    filters.productTypeId.forEach((id) => chips.push({ label: `Type: ${nameOf(ptypes.data, id)}`, onRemove: () => toggle('productTypeId', id) }));
    filters.categoryId.forEach((id) => chips.push({ label: `Category: ${categoryPath(categories.data, id)}`, onRemove: () => toggle('categoryId', id) }));
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
    mutationFn: (ids: string[]) => productsApi.bulkDelete(ids),
    onSuccess: (r: any) => { toast.success(`Removed ${r.count} products`); setSelected(new Set()); setPendingDelete(null); qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: () => toast.error('Bulk delete failed'),
  });

  const onExport = async () => {
    if (selected.size === 0) {
      // Every reference column is a closed list, matching what the import enforces: an unrecognised
      // value is refused, never created. The dropdown is the humane half of that rule — nobody has
      // to type a category name exactly right, or find out at import time that they didn't.
      //
      // Categories carry their full path rather than the leaf alone. Leaf names are only unique
      // within a parent, so "Accessories" on its own would be a guess. The server accepts either
      // form, but the template should offer the one that cannot be misread.
      const col = (key: string) => EXPORT_COLUMNS.findIndex((c) => c.key === key);
      const { emptyLists } = await downloadTemplate('masquare-products-template', {
        sheetName: 'Products',
        headers: EXPORT_COLUMNS.map((c) => c.label),
        sampleRows: [EXPORT_COLUMNS.map((c) => c.sample)],
        lists: [
          { column: col('brand'), values: (brands.data ?? []).map((b: any) => b.name) },
          { column: col('vendor'), values: (vendors.data ?? []).map((v: any) => v.name) },
          { column: col('productType'), values: (ptypes.data ?? []).map((t: any) => t.name) },
          { column: col('fulfilmentType'), values: (ftypes.data ?? []).map((f: any) => f.code ?? f.name) },
          { column: col('category'), values: categoryOptions(categories.data ?? []).map((c) => c.name) },
          { column: col('productClass'), values: (pclasses.data ?? []).map((c: any) => c.name) },
          { column: col('vatClass'), values: (vatClasses.data ?? []).map((v: any) => v.name) },
        ].filter((l) => l.column >= 0),
      });
      // A list with no values leaves its column as free text, and the import will then refuse
      // whatever gets typed there. Name them, rather than letting that be discovered at import.
      if (emptyLists.length) {
        toast.warning(`Template downloaded — but ${emptyLists.join(', ')} had nothing to offer. Create those first, or leave the columns empty.`);
      } else {
        toast.success('Template downloaded — fill it in, then Import');
      }
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
      <PageHeader
        module="Catalogue & Inventory"
        title="All products"
        info={`Master catalogue${user?.companies.length ? `, co-owned by ${user.companies.map((c) => c.officialName).join(' & ')}` : ''}.`}
        summary={`${total.toLocaleString()} product${total === 1 ? '' : 's'}${activeChips.length ? ` · ${activeChips.length} filter${activeChips.length === 1 ? '' : 's'}` : ''}`}
        actions={isMobile ? undefined : (
          <>
            <button className="hbtn" onClick={() => setImportOpen(true)}><Upload size={15} className="text-n-500" /> Import</button>
            <button className="hbtn" onClick={onExport}><Download size={15} className="text-n-500" /> Export</button>
          </>
        )}
        overflow={isMobile ? [
          { label: 'Import products', onClick: () => setImportOpen(true) },
          { label: 'Export selected', onClick: onExport },
        ] : undefined}
        primary={<button className="hbtn-primary" onClick={() => setEditing(null)}><Plus size={16} /> Add<span className="max-[767px]:hidden"> product</span></button>}
        toolbar={
          <>
            <div className="relative flex-[0_1_380px] max-[767px]:min-w-0 max-[767px]:flex-1">
              <span className="flex h-8 items-stretch overflow-hidden rounded-lg border border-n-200 bg-n-0 focus-within:border-teal-400">
                <button
                  type="button"
                  ref={scopeBtnRef}
                  onClick={() => setOpenMenu(openMenu === 'scope' ? null : 'scope')}
                  className="flex shrink-0 items-center gap-1 whitespace-nowrap border-r border-n-200 bg-n-25 px-2.5 text-[12.5px] font-medium text-n-600 hover:bg-n-100"
                >
                  {SEARCH_FIELDS.find((f) => f.key === field)?.label ?? 'All fields'}
                  <ChevronsUpDown size={13} className="text-n-400" />
                </button>
                <span className="flex flex-1 items-center gap-2 px-2.5">
                  <Search size={15} className="text-n-400" />
                  <input className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none" placeholder="Search SKU, title, attributes…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
                </span>
              </span>
              {openMenu === 'scope' && (
                <AnchoredPanel anchorRef={scopeBtnRef} onClose={() => setOpenMenu(null)} align="left" className="min-w-[160px] p-1">
                  {SEARCH_FIELDS.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => { setField(f.key); setOpenMenu(null); }}
                      className={`block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-n-50 ${f.key === field ? 'font-semibold text-teal-700' : 'text-n-700'}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </AnchoredPanel>
              )}
            </div>

            <div className="relative shrink-0">
              <button ref={filterBtnRef} className="hbtn" onClick={() => setOpenMenu(openMenu === 'filters' ? null : 'filters')}>
                <Filter size={15} className="opacity-60" /> <span className="max-[767px]:hidden">Filters</span> {activeChips.length > 0 && <span className="mono rounded-pill bg-teal-100 px-1.5 text-[11px] text-teal-700">{activeChips.length}</span>}
              </button>
              {openMenu === 'filters' && (
                <FilterPanel
                  onClose={() => setOpenMenu(null)}
                  anchorRef={filterBtnRef}
                  groups={[
                    { key: 'vendorId', label: 'Vendor', options: vendors.data ?? [] },
                    { key: 'brandId', label: 'Brand', options: brands.data ?? [] },
                    { key: 'fulfilmentTypeId', label: 'Fulfilment', options: ftypes.data ?? [] },
                    { key: 'productTypeId', label: 'Product type', options: ptypes.data ?? [] },
                    { key: 'categoryId', label: 'Category', options: categoryOptions(categories.data ?? []).map((c) => ({ id: c.id, name: c.name })) },
                  ]}
                  filters={filters}
                  onToggle={toggle}
                  country={filters.country}
                  onCountry={(v) => { setFilters((f) => ({ ...f, country: v })); setPage(1); }}
                />
              )}
            </div>

            {view === 'list' && !isMobile && (
              <div className="relative">
                <button className="hbtn" onClick={() => setOpenMenu(openMenu === 'columns' ? null : 'columns')}>
                  <Columns3 size={15} className="opacity-60" /> Columns
                </button>
                {openMenu === 'columns' && (
                  <div className="absolute right-0 top-9 z-50 w-56 rounded-lg border border-n-200 bg-n-0 p-2 shadow-lg" onMouseLeave={() => setOpenMenu(null)}>
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

            {anyFilter && <button className="inline-flex h-8 shrink-0 items-center rounded-lg border border-orange-200 px-3 text-[13px] font-medium text-orange-600 hover:bg-orange-50 max-[767px]:hidden" onClick={clearAll}>Clear all</button>}

            <div className="flex-1 max-[767px]:hidden" />
            <div className="hseg max-[767px]:hidden">
              <button className={view === 'list' ? 'hseg-on' : ''} onClick={() => setView('list')} title="List"><List size={15} /></button>
              <button className={view === 'grid' ? 'hseg-on' : ''} onClick={() => setView('grid')} title="Grid"><Grid size={15} /></button>
            </div>
          </>
        }
      />

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
          <span className="text-[13px] font-semibold text-teal-800">{allDbSelected ? `All ${total} products selected` : `${selected.size} selected`}</span>
          {!allDbSelected && allSelected && total > items.length && (
            <button className="text-[12.5px] font-semibold text-teal-700 hover:underline disabled:opacity-50" disabled={selectingAll} onClick={selectAllMatching}>
              {selectingAll ? 'Selecting…' : `Select all ${total} products`}
            </button>
          )}
          <div className="mx-1 h-5 w-px bg-teal-200" />
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-medium text-n-700 hover:bg-n-50" onClick={() => setBulkEdit(true)}><SlidersHorizontal size={14} /> Bulk edit</button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-medium text-n-700 hover:bg-n-50" onClick={onExport}><Download size={14} /> Export selected</button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-danger-bd bg-n-0 px-2.5 text-[12.5px] font-medium text-danger hover:bg-danger-bg" onClick={() => setPendingDelete({ kind: 'bulk', ids: [...selected] })}><Trash2 size={14} /> Delete</button>
          <button className="ml-auto text-[12.5px] font-medium text-teal-700 hover:underline" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {!effectiveGrid ? (
        <ListView items={items} loading={isLoading} cols={cols} selected={selected} allSelected={allSelected} onToggleAll={toggleAll} onToggleOne={toggleOne} onEdit={setEditing} onDelete={(p) => setPendingDelete({ kind: 'single', product: p })} />
      ) : (
        <GridView
          items={items}
          loading={isLoading}
          selected={selected}
          onToggleOne={toggleOne}
          onEdit={setEditing}
          rangeStart={(page - 1) * pageSize + 1}
          total={total}
        />
      )}

      <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />

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
      {pendingDelete && (
        <ConfirmDeleteModal
          count={pendingDelete.kind === 'single' ? 1 : pendingDelete.ids.length}
          label={pendingDelete.kind === 'single' ? pendingDelete.product.mainSku : undefined}
          busy={del.isPending || bulkDelete.isPending}
          onConfirm={() => {
            if (pendingDelete.kind === 'single') del.mutate(pendingDelete.product.id);
            else bulkDelete.mutate(pendingDelete.ids);
          }}
          onClose={() => setPendingDelete(null)}
        />
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
                <td className="border-b border-n-100 px-4 py-2.5"><div className="code font-medium text-n-800">{p.mainSku}</div></td>
                <td className="border-b border-n-100 px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {p.aliases.length === 0 && <span className="text-n-300">—</span>}
                    {p.aliases.slice(0, 4).map((a) => (
                      <span key={a.id ?? a.skuValue} className="code inline-flex items-center gap-1 rounded bg-n-100 px-1.5 py-0.5 text-[11px] text-n-600" title={a.label ?? undefined}>
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
                <td className="border-b border-n-100 px-4 py-2.5">
                  {p.attributes.length === 0 ? <span className="text-n-400">—</span> : (
                    <div className="flex max-w-[190px] items-center gap-1" title={p.attributes.map((a) => a.value).join(', ')}>
                      <span className="truncate rounded bg-n-100 px-1.5 py-0.5 text-[11px] text-n-600">{p.attributes[0].value}</span>
                      {p.attributes.length > 1 && <span className="shrink-0 rounded bg-n-100 px-1.5 py-0.5 text-[11px] font-semibold text-n-500">+{p.attributes.length - 1}</span>}
                    </div>
                  )}
                </td>
                {extra.map((c) => <td key={c.key} className={`border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700 ${c.mono ? 'mono' : ''} ${c.right ? 'text-right' : ''}`}>{c.render(p)}</td>)}
                <td className="border-b border-n-100 px-4 py-2.5 text-right"><span className="mono font-medium text-n-800">{formatMoney(p.purchaseCost)}</span></td>
                <td className="border-b border-n-100 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    {/* Opens in a new tab: it is the customer's view of this product, not a step
                        in the work being done here, and coming back should not cost the list. */}
                    <a
                      href={`/store-preview/product/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                      title="See this product as a customer would"
                      className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800"
                    >
                      <Store size={15} />
                    </a>
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

function GridView({ items, loading, selected, onToggleOne, onEdit, rangeStart, total }: {
  items: Product[];
  loading: boolean;
  selected: Set<string>;
  onToggleOne: (id: string) => void;
  onEdit: (p: Product) => void;
  rangeStart: number;
  total: number;
}) {
  if (loading) return <div className="card px-4 py-12 text-center text-[13px] text-n-500">Loading…</div>;
  if (items.length === 0) return <div className="card px-4 py-12 text-center text-[13px] text-n-500">No products match. Add your first product, or import a .csv.</div>;
  return (
    <>
      <p className="mb-3 text-[13px] text-n-500">
        Showing <span className="font-medium text-n-800">{rangeStart}–{rangeStart + items.length - 1}</span> of{' '}
        <span className="font-medium text-n-800">{total.toLocaleString()}</span> products
      </p>
      <div className="grid grid-cols-5 gap-4 max-[1400px]:grid-cols-4 max-[1100px]:grid-cols-3 max-[760px]:grid-cols-2">
        {items.map((p) => (
          <div
            key={p.id}
            onClick={() => onEdit(p)}
            className={`cursor-pointer overflow-hidden rounded-lg border bg-n-0 transition-shadow hover:shadow-md ${selected.has(p.id) ? 'border-teal-300 ring-1 ring-teal-200' : 'border-n-200'}`}
          >
            {/* Image, with the select box and fulfilment badge overlaid on it. */}
            <div className="relative grid aspect-[5/3] place-items-center border-b border-n-100 bg-n-50 text-n-300">
              {p.featuredImage ? <img src={p.featuredImage} alt="" className="h-full w-full object-cover" /> : <Package size={30} strokeWidth={1.5} />}
              <div className="absolute left-2.5 top-2.5" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--teal-500)]"
                  checked={selected.has(p.id)}
                  onChange={() => onToggleOne(p.id)}
                />
              </div>
              {p.fulfilmentType && (
                <span className={`tag absolute right-2.5 top-2.5 ${p.fulfilmentType.code === 'FBA' ? 'border border-info-bd bg-info-bg text-info' : 'border border-n-200 bg-n-100 text-n-600'}`}>
                  {p.fulfilmentType.code ?? p.fulfilmentType.name}
                </span>
              )}
            </div>

            <div className="p-3">
              <div className="code truncate text-[11.5px] text-teal-700">{p.mainSku}</div>
              {/* Fixed two-line title so every card in a row lines up. */}
              <div className="mt-1 line-clamp-2 min-h-[2.25rem] text-[13px] font-medium leading-[1.15rem] text-n-800">{p.title}</div>
              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-n-100 pt-2.5">
                <span className="truncate text-[12px] text-n-500">{p.brand?.name ?? '—'}</span>
                <span className="mono shrink-0 text-[13px] font-semibold text-n-800">{formatMoney(p.purchaseCost)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function FilterPanel({
  groups, filters, onToggle, country, onCountry, onClose, anchorRef,
}: {
  groups: { key: keyof Filters; label: string; options: { id: string; name: string }[] }[];
  filters: Filters;
  onToggle: (key: keyof Filters, id: string) => void;
  country: string;
  onCountry: (v: string) => void;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  return (
    <AnchoredPanel anchorRef={anchorRef} onClose={onClose} align="left" showClose className="grid w-[560px] max-w-[calc(100vw-2rem)] grid-cols-2 gap-4 p-4 max-[760px]:w-[92vw] max-[760px]:grid-cols-1">
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
    </AnchoredPanel>
  );
}

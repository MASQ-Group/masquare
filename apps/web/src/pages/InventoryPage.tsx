import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Search } from 'lucide-react';
import { DEFAULT_PAGE_SIZES, Pagination, Select } from '@masquare/ui';
import { inventoryApi, productsApi, vendorsApi, type InventoryRow, type Product } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { usePersistentState } from '../lib/usePersistentState';
import { ProductModal } from '../components/products/ProductModal';

const FILTERS = [
  { value: 'all', label: 'All products' },
  { value: 'in_stock', label: 'In stock only' },
];

const eur = (v: number | null) => (v == null ? '—' : `€${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * The Inventory view — distinct from the Products catalogue. Products answers "what is this
 * product"; Inventory answers "how much have I got, how much is spoken for, how much is
 * coming". Every figure is derived (see the API), so there's nothing to edit here — clicking
 * a row opens the product card, where stock is shown per warehouse.
 */
export function InventoryPage() {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [vendorId, setVendorId] = usePersistentState('inv.vendor', '');
  const [filter, setFilter] = usePersistentState('inv.filter', 'all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });

  const params = { q: q || undefined, vendorId: vendorId || undefined, filter, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['inventory', params], queryFn: () => inventoryApi.list(params) });
  const rows = data?.rows ?? [];

  // Clicking a row opens the product card; fetch the full record on demand.
  const { data: openProduct } = useQuery<Product>({
    queryKey: ['product', openId],
    queryFn: () => productsApi.get(openId as string),
    enabled: !!openId,
  });

  return (
    <div className="w-full">
      <PageHeader
        module="Catalogue & Inventory"
        title="Inventory"
        info="What you hold, what's spoken for, and what's on its way. Click a product to see its stock by warehouse."
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
            <input className="input pl-8" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search SKU or product" />
          </div>
          <div className="w-[210px]">
            <Select
              value={vendorId}
              onChange={(v) => { setVendorId(v); setPage(1); }}
              placeholder="All vendors"
              options={[{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}
            />
          </div>
          <div className="w-[170px]">
            <Select value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={FILTERS} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${TH} text-left`}>SKU</th>
                <th className={`${TH} text-left`}>Product</th>
                <th className={`${TH} text-right`}>On hand</th>
                <th className={`${TH} text-right`}>Committed</th>
                <th className={`${TH} text-right`}>On order</th>
                <th className={`${TH} text-right`}>Available</th>
                <th className={`${TH} text-right`}>Avg cost</th>
                <th className={`${TH} text-right`}>Stock value</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={TD} colSpan={8}>Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td className={`${TD} py-12 text-center`} colSpan={8}>
                    <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-lg bg-n-50 text-n-400"><Boxes size={18} /></span>
                    <div className="text-[13px] text-n-500">No products match.</div>
                  </td>
                </tr>
              )}
              {rows.map((r: InventoryRow) => (
                <tr key={r.productId} className="cursor-pointer hover:bg-n-25" onClick={() => setOpenId(r.productId)}>
                  <td className={`${TD} code font-semibold text-teal-700`}>{r.sku}</td>
                  <td className={`${TD} max-w-[320px] truncate`} title={r.title}>{r.title}</td>
                  <td className={`${TD} mono text-right font-semibold text-n-900`}>{r.onHand}</td>
                  <td className={`${TD} mono text-right ${r.committed > 0 ? 'text-warning' : 'text-n-300'}`}>{r.committed || '—'}</td>
                  <td className={`${TD} mono text-right ${r.onOrder > 0 ? 'text-info' : 'text-n-300'}`}>{r.onOrder || '—'}</td>
                  <td className={`${TD} mono text-right font-semibold ${r.available > 0 ? 'text-teal-700' : 'text-n-400'}`}>{r.available}</td>
                  <td className={`${TD} mono text-right text-n-600`}>{eur(r.averageCostEur)}</td>
                  <td className={`${TD} mono text-right text-n-700`}>{eur(r.stockValueEur)}</td>
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

      {openId && openProduct && (
        <ProductModal product={openProduct} onClose={() => setOpenId(null)} onSaved={() => setOpenId(null)} />
      )}
    </div>
  );
}

const TH = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
const TD = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Pagination, Select } from '@masquare/ui';
import { availabilityApi, brandsApi, productTypesApi, vendorsApi, type AvailabilityRow } from '../lib/api';
import { usePersistentState } from '../lib/usePersistentState';

const SOURCE_LABEL: Record<string, string> = { manual: 'Manual', vendor_import: 'Vendor import', sale: 'Sale', return: 'Return' };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export function AvailabilityPage() {
  const qc = useQueryClient();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [brandId, setBrandId] = usePersistentState('availability.brand', '');
  const [vendorId, setVendorId] = usePersistentState('availability.vendor', '');
  const [productTypeId, setProductTypeId] = usePersistentState('availability.type', '');
  const [onlyUnset, setOnlyUnset] = usePersistentState('availability.unset', false);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  // Per-row edit buffer (productId -> typed string), so several rows can be edited before saving.
  const [edits, setEdits] = useState<Record<string, string>>({});

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);
  useEffect(() => { setPage(1); }, [brandId, vendorId, productTypeId, onlyUnset]);

  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const { data: types = [] } = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });

  const params = { q: q || undefined, brandId: brandId || undefined, vendorId: vendorId || undefined, productTypeId: productTypeId || undefined, unset: onlyUnset || undefined, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['availability', params], queryFn: () => availabilityApi.list(params) });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const save = useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) => availabilityApi.setQuantity(productId, quantity),
    onSuccess: (_r, v) => {
      setEdits((e) => { const n = { ...e }; delete n[v.productId]; return n; });
      qc.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save quantity'),
  });

  const hasFilters = !!(q || brandId || vendorId || productTypeId || onlyUnset);
  const resetFilters = () => { setQInput(''); setQ(''); setBrandId(''); setVendorId(''); setProductTypeId(''); setOnlyUnset(false); };

  const edited = (r: AvailabilityRow) => edits[r.productId] !== undefined && edits[r.productId] !== String(r.quantity ?? '');
  const commit = (r: AvailabilityRow) => {
    const raw = edits[r.productId];
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 0) { toast.error('Enter a whole number ≥ 0'); return; }
    save.mutate({ productId: r.productId, quantity: n });
  };

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';
  const opts = (rows: { id: string; name: string }[], all: string) => [{ value: '', label: all }, ...rows.map((r) => ({ value: r.id, label: r.name }))];

  return (
    <div className="w-full">
      <div className="mb-5">
        <div className="eyebrow mb-1.5">Catalogue &amp; Inventory</div>
        <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Availability</h1>
        <p className="mt-1 text-[13.5px] text-n-500">The sellable quantity broadcast to your sales channels — the single source of truth for how much of each SKU is available. Separate from warehouse stock; set it from your vendors' availability.</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="flex h-9 min-w-[220px] max-w-[300px] flex-1 items-center gap-2 rounded-md border border-n-200 bg-n-50 px-3">
          <Search size={15} className="text-n-400" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search SKU or title…" className="flex-1 bg-transparent text-[13px] text-n-900 outline-none placeholder:text-n-400" />
        </div>
        <Select dense className="w-40" value={brandId} onChange={setBrandId} options={opts(brands, 'All brands')} />
        <Select dense className="w-40" value={vendorId} onChange={setVendorId} options={opts(vendors, 'All vendors')} />
        <Select dense className="w-40" value={productTypeId} onChange={setProductTypeId} options={opts(types, 'All types')} />
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-n-600">
          <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={onlyUnset} onChange={(e) => setOnlyUnset(e.target.checked)} /> Not set yet
        </label>
        {hasFilters && <button onClick={resetFilters} className="text-[12.5px] font-semibold text-n-500 hover:text-n-700">Reset</button>}
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-n-100 px-4 py-2.5 text-[12px] text-n-500">{total} product{total === 1 ? '' : 's'}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>SKU</th>
                <th className={`${th} text-left`}>Product</th>
                <th className={`${th} text-left`}>Brand</th>
                <th className={`${th} text-left`}>Vendor</th>
                <th className={`${th} text-left`}>Type</th>
                <th className={`${th} text-right`}>Available</th>
                <th className={`${th} text-left`}>Source</th>
                <th className={`${th} text-left`}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={td} colSpan={8}>Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td className={`${td} py-10 text-center text-n-400`} colSpan={8}>{hasFilters ? 'No products match these filters.' : 'No products yet.'}</td></tr>}
              {items.map((r) => {
                const val = edits[r.productId] ?? String(r.quantity ?? '');
                return (
                  <tr key={r.productId} className="group hover:bg-n-25">
                    <td className={`${td} code whitespace-nowrap text-n-800`}>{r.mainSku}</td>
                    <td className={`${td} max-w-[280px] truncate`} title={r.title}>{r.title}</td>
                    <td className={td}>{r.brand ?? <span className="text-n-300">—</span>}</td>
                    <td className={td}>{r.vendor ?? <span className="text-n-300">—</span>}</td>
                    <td className={td}>{r.productType ?? <span className="text-n-300">—</span>}</td>
                    <td className={`${td} text-right`}>
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          className={`mono w-20 rounded-md border px-2 py-1 text-right text-[13px] outline-none focus:border-teal-400 ${edited(r) ? 'border-teal-300 bg-teal-50/40' : 'border-n-200 bg-n-0'} ${r.quantity == null && !edited(r) ? 'text-n-300' : 'text-n-900'}`}
                          inputMode="numeric"
                          placeholder="—"
                          value={val}
                          onChange={(e) => setEdits((s) => ({ ...s, [r.productId]: e.target.value.replace(/[^\d]/g, '') }))}
                          onKeyDown={(e) => { if (e.key === 'Enter' && edited(r)) commit(r); if (e.key === 'Escape') setEdits((s) => { const n = { ...s }; delete n[r.productId]; return n; }); }}
                        />
                        {edited(r) ? (
                          <div className="flex gap-0.5">
                            <button title="Save (Enter)" disabled={save.isPending} onClick={() => commit(r)} className="grid h-7 w-7 place-items-center rounded-md border border-teal-300 bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50"><Check size={14} /></button>
                            <button title="Cancel (Esc)" onClick={() => setEdits((s) => { const n = { ...s }; delete n[r.productId]; return n; })} className="grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 hover:text-n-700"><X size={14} /></button>
                          </div>
                        ) : <span className="w-[58px]" />}
                      </div>
                    </td>
                    <td className={td}>{r.lastSource ? <span className="tag border border-n-200 bg-n-50 text-n-500">{SOURCE_LABEL[r.lastSource] ?? r.lastSource}</span> : <span className="text-n-300">—</span>}</td>
                    <td className={`${td} whitespace-nowrap text-n-500`}>{fmtDate(r.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex justify-end">
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}

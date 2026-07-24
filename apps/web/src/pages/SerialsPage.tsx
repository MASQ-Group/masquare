import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScanBarcode, Search } from 'lucide-react';
import { DEFAULT_PAGE_SIZES, Pagination, Select } from '@masquare/ui';
import { serialsApi, warehousesApi, type SerialNumberRow } from '../lib/api';
import { usePersistentState } from '../lib/usePersistentState';
import { formatDate } from '../lib/format';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'sold', label: 'Sold' },
  { value: 'returned_to_vendor', label: 'Returned to vendor' },
  { value: 'scrapped', label: 'Scrapped' },
];

const STATUS_STYLE: Record<string, string> = {
  in_stock: 'border-teal-300 bg-teal-50 text-teal-700',
  sold: 'border-n-200 bg-n-50 text-n-600',
  returned_to_vendor: 'border-warning-bd bg-warning-bg text-warning',
  scrapped: 'border-danger-bd bg-danger-bg text-danger',
};

/** The register of individual units — where every serial is and how it got there. */
export function SerialsPage() {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = usePersistentState('serials.status', 'in_stock');
  const [warehouseId, setWarehouseId] = usePersistentState('serials.warehouse', '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() });
  const params = { q: q || undefined, status: status || undefined, warehouseId: warehouseId || undefined, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['serials', params], queryFn: () => serialsApi.list(params) });
  const rows = data?.rows ?? [];

  return (
    <div className="w-full">
      <div className="mb-5">
        <h1 className="text-[22px] font-bold tracking-tight text-n-900">Serial Numbers</h1>
        <p className="mt-1 text-[13px] text-n-500">
          Individual units of serial-tracked products. Received into stock, and retired when sold or sent back.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
            <input className="input pl-8" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search serial or SKU" />
          </div>
          <div className="w-[190px]">
            <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS} />
          </div>
          <div className="w-[210px]">
            <Select
              value={warehouseId}
              onChange={(v) => { setWarehouseId(v); setPage(1); }}
              placeholder="All warehouses"
              options={[{ value: '', label: 'All warehouses' }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${TH} text-left`}>Serial</th>
                <th className={`${TH} text-left`}>SKU</th>
                <th className={`${TH} text-left`}>Product</th>
                <th className={`${TH} text-left`}>Status</th>
                <th className={`${TH} text-left`}>Warehouse</th>
                <th className={`${TH} text-left`}>Received</th>
                <th className={`${TH} text-left`}>Left</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={TD} colSpan={7}>Loading…</td></tr>}
              {!isLoading && !rows.length && (
                <tr>
                  <td className={`${TD} py-12 text-center`} colSpan={7}>
                    <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-lg bg-n-50 text-n-400">
                      <ScanBarcode size={18} />
                    </span>
                    <div className="text-[13px] text-n-500">No serials match.</div>
                    <div className="mt-0.5 text-[12.5px] text-n-400">
                      Turn on “Track individual units” on a product, then receive it against a purchase order.
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((s: SerialNumberRow) => (
                <tr key={s.id} className="hover:bg-n-25">
                  <td className={`${TD} code font-semibold text-n-800`}>{s.serial}</td>
                  <td className={`${TD} code text-teal-700`}>{s.product?.mainSku ?? '—'}</td>
                  <td className={`${TD} max-w-[280px] truncate`} title={s.product?.title ?? ''}>{s.product?.title ?? '—'}</td>
                  <td className={TD}>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${STATUS_STYLE[s.status] ?? ''}`}>
                      {s.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={`${TD} text-n-500`}>{s.warehouse?.name ?? '—'}</td>
                  <td className={`${TD} whitespace-nowrap text-n-500`}>{s.receivedAt ? formatDate(s.receivedAt) : '—'}</td>
                  <td className={`${TD} whitespace-nowrap text-n-500`}>{s.dispatchedAt ? formatDate(s.dispatchedAt) : '—'}</td>
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
    </div>
  );
}

const TH = 'border-b border-n-200 bg-n-25 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500';
const TD = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

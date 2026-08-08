import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, PackageX } from 'lucide-react';
import { DEFAULT_PAGE_SIZES, Pagination, Select } from '@masquare/ui';
import { inventoryApi, type StockOwedRow } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { formatDate } from '../lib/format';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open (needs action)' },
  { value: 'settled', label: 'Settled' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

const STATUS_STYLE: Record<string, string> = {
  open: 'border-warning-bd bg-warning-bg text-warning',
  settled: 'border-teal-300 bg-teal-50 text-teal-700',
  cancelled: 'border-n-200 bg-n-50 text-n-500',
};

/**
 * The stock-owed register: products sold before they were in stock. Open rows clear
 * themselves when the goods are received, oldest first — this page is where they're watched
 * until they do.
 */
export function StockOwedPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const params = { status, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['stock-owed', params], queryFn: () => inventoryApi.owed(params) });
  const rows = data?.rows ?? [];

  return (
    <div className="w-full">
      <PageHeader
        module="Catalogue & Inventory"
        title="Stock Owed"
        info="Units sold before they were in stock. Each clears automatically when the product is next received."
        actions={(data?.totalOpenUnits ?? 0) > 0 ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-warning-bd bg-warning-bg px-3 text-[12px] font-semibold text-warning">
            <span className="mono text-[14px] font-bold">{data!.totalOpenUnits}</span> units owed
          </span>
        ) : undefined}
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-3">
          <div className="w-[220px]">
            <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${TH} text-left`}>SKU</th>
                <th className={`${TH} text-left`}>Product</th>
                <th className={`${TH} text-left`}>Sale</th>
                <th className={`${TH} text-left`}>Status</th>
                <th className={`${TH} text-right`}>Owed</th>
                <th className={`${TH} text-left`}>Since</th>
                <th className={`${TH} text-left`}>Settled</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={TD} colSpan={7}>Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td className={`${TD} py-12 text-center`} colSpan={7}>
                    <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-lg bg-n-50 text-n-400"><PackageX size={18} /></span>
                    <div className="text-[13px] text-n-500">Nothing owed.</div>
                    <div className="mt-0.5 text-[12.5px] text-n-400">A shortfall appears here only when a sale ships more than is in stock.</div>
                  </td>
                </tr>
              )}
              {rows.map((r: StockOwedRow) => (
                <tr key={r.id} className="hover:bg-n-25">
                  <td className={`${TD} code font-semibold text-teal-700`}>{r.sku}</td>
                  <td className={`${TD} max-w-[280px] truncate`} title={r.productName}>{r.productName}</td>
                  <td className={TD}>
                    {r.transactionRef
                      ? <button className="code text-n-700 hover:text-teal-700" onClick={() => navigate(`/sales-transactions?q=${encodeURIComponent(r.transactionRef!)}`)}>{r.transactionRef}</button>
                      : <span className="text-n-300">—</span>}
                  </td>
                  <td className={TD}>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${STATUS_STYLE[r.status] ?? ''}`}>
                      {r.status === 'open' && <AlertTriangle size={11} />}{r.status}
                    </span>
                  </td>
                  <td className={`${TD} mono text-right font-semibold ${r.status === 'open' ? 'text-warning' : 'text-n-500'}`}>{r.quantity}</td>
                  <td className={`${TD} whitespace-nowrap text-n-500`}>{formatDate(r.openedAt)}</td>
                  <td className={`${TD} whitespace-nowrap text-n-500`}>{r.settledAt ? formatDate(r.settledAt) : '—'}</td>
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

const TH = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
const TD = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Undo2 } from 'lucide-react';
import { DEFAULT_PAGE_SIZES, Pagination, Select } from '@masquare/ui';
import { vendorReturnsApi, vendorsApi } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { usePersistentState } from '../lib/usePersistentState';
import { formatDate } from '../lib/format';

const money = (v: number) => `€${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Everything sent back to vendors — the counterpart to Goods Receipts. */
export function VendorReturnsPage() {
  const navigate = useNavigate();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [vendorId, setVendorId] = usePersistentState('rtv.vendor', '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const params = { q: q || undefined, vendorId: vendorId || undefined, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['vendor-returns', params], queryFn: () => vendorReturnsApi.list(params) });
  const rows = data?.rows ?? [];

  const totalUnits = rows.reduce((s, r) => s + r.totalQuantity, 0);
  const totalValue = rows.reduce((s, r) => s + r.totalCostEur, 0);

  return (
    <div className="w-full">
      <PageHeader
        module="Purchasing"
        title="Returns to Vendor"
        info="Goods sent back to suppliers. Stock leaves at its average cost, so what you still hold is valued unchanged."
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
            <input
              className="input pl-8"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search return number, credit note or vendor"
            />
          </div>
          <div className="w-[210px]">
            <Select
              value={vendorId}
              onChange={(v) => { setVendorId(v); setPage(1); }}
              placeholder="All vendors"
              options={[{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${TH} text-left`}>Return</th>
                <th className={`${TH} text-left`}>Purchase order</th>
                <th className={`${TH} text-left`}>Vendor</th>
                <th className={`${TH} text-left`}>Reason</th>
                <th className={`${TH} text-left`}>Credit note</th>
                <th className={`${TH} text-left`}>From</th>
                <th className={`${TH} text-right`}>Units</th>
                <th className={`${TH} text-right`}>Value</th>
                <th className={`${TH} text-left`}>Posted</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={TD} colSpan={9}>Loading…</td></tr>}
              {!isLoading && !rows.length && (
                <tr>
                  <td className={`${TD} py-12 text-center`} colSpan={9}>
                    <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-lg bg-n-50 text-n-400">
                      <Undo2 size={18} />
                    </span>
                    <div className="text-[13px] text-n-500">No returns yet.</div>
                    <div className="mt-0.5 text-[12.5px] text-n-400">
                      Raise one from a purchase order that has received goods.
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={r.purchaseOrder ? 'cursor-pointer hover:bg-n-25' : 'hover:bg-n-25'}
                  onClick={() => r.purchaseOrder && navigate(`/purchase-orders/${r.purchaseOrder.id}`)}
                >
                  <td className={`${TD} code font-semibold text-n-800`}>{r.returnNumber}</td>
                  <td className={`${TD} code text-teal-700`}>{r.purchaseOrder?.poNumber ?? '—'}</td>
                  <td className={TD}>{r.vendor?.name ?? '—'}</td>
                  <td className={`${TD} max-w-[240px] truncate`} title={r.reason}>{r.reason}</td>
                  <td className={`${TD} code text-n-500`}>{r.creditNoteRef ?? '—'}</td>
                  <td className={`${TD} text-n-500`}>{r.warehouse?.name ?? '—'}</td>
                  <td className={`${TD} mono text-right font-semibold text-danger`}>−{r.totalQuantity}</td>
                  <td className={`${TD} mono text-right font-semibold text-n-800`}>{money(r.totalCostEur)}</td>
                  <td className={`${TD} whitespace-nowrap text-n-500`}>{formatDate(r.postedAt)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td className="border-t border-n-200 bg-n-25 px-4 py-3 text-[12.5px] text-n-500" colSpan={6}>
                    {rows.length} return{rows.length === 1 ? '' : 's'} on this page
                  </td>
                  <td className="mono border-t border-n-200 bg-n-25 px-4 py-3 text-right text-[13px] font-semibold text-n-700">−{totalUnits}</td>
                  <td className="mono border-t border-n-200 bg-n-25 px-4 py-3 text-right text-[13px] font-semibold text-n-800">{money(totalValue)}</td>
                  <td className="border-t border-n-200 bg-n-25" />
                </tr>
              </tfoot>
            )}
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

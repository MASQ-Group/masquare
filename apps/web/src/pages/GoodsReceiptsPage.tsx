import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Search } from 'lucide-react';
import { DEFAULT_PAGE_SIZES, Pagination, Select } from '@masquare/ui';
import { goodsReceiptsApi, vendorsApi, type GoodsReceiptStatus } from '../lib/api';
import { usePersistentState } from '../lib/usePersistentState';
import { formatDate } from '../lib/format';
import { ReceiveModal } from '../components/purchase-orders/ReceiveModal';

// "Open" is the receiving desk's default: everything still awaiting goods, backorders included.
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open (incl. backorders)' },
  { value: 'posted', label: 'Posted' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];
const STATUS_STYLE: Record<GoodsReceiptStatus, string> = {
  pending: 'border-info-bd bg-info-bg text-info',
  posted: 'border-teal-300 bg-teal-50 text-teal-700',
  cancelled: 'border-danger-bd bg-danger-bg text-danger',
};
const STATUS_LABEL: Record<GoodsReceiptStatus, string> = { pending: 'Pending', posted: 'Posted', cancelled: 'Cancelled' };

export function GoodsReceiptsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = usePersistentState('gr.status', 'open');
  const [vendorId, setVendorId] = usePersistentState('gr.vendor', '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [receiving, setReceiving] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const params = { q: q || undefined, status, vendorId: vendorId || undefined, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['goods-receipts', params], queryFn: () => goodsReceiptsApi.list(params) });
  const rows = data?.rows ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['goods-receipts'] });
    qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
  };

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-[22px] font-bold tracking-tight text-n-900">Goods Receipts</h1>
          <p className="mt-1 text-[13px] text-n-500">
            What's on its way in. Receiving a delivery is what puts stock on hand; a short delivery raises a backorder automatically.
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
            <input className="input pl-8" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search receipt, PO or vendor" />
          </div>
          <div className="w-[210px]">
            <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS} />
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
                <th className={`${TH} text-left`}>Receipt</th>
                <th className={`${TH} text-left`}>Status</th>
                <th className={`${TH} text-left`}>Purchase order</th>
                <th className={`${TH} text-left`}>Vendor</th>
                <th className={`${TH} text-left`}>Into</th>
                <th className={`${TH} text-right`}>Expected</th>
                <th className={`${TH} text-right`}>Received</th>
                <th className={`${TH} text-left`}>Raised</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={TD} colSpan={9}>Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td className={`${TD} py-10 text-center text-n-400`} colSpan={9}>
                    {status === 'open' ? 'Nothing awaiting delivery. Submit a purchase order to raise a receipt.' : 'No goods receipts match your filters.'}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="group hover:bg-n-25">
                  <td className={`${TD} code font-semibold text-n-800`}>
                    {r.receiptNumber}
                    {r.isBackorder && <span className="ml-2 rounded bg-warning-bg px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-warning">Backorder</span>}
                  </td>
                  <td className={TD}>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${STATUS_STYLE[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className={TD}>
                    {r.purchaseOrder
                      ? <button className="code font-semibold text-teal-700 hover:underline" onClick={() => navigate(`/purchase-orders/${r.purchaseOrder!.id}`)}>{r.purchaseOrder.poNumber}</button>
                      : <span className="text-n-300">—</span>}
                  </td>
                  <td className={TD}>{r.vendor?.name ?? <span className="text-n-300">—</span>}</td>
                  <td className={TD}>{r.destinationWarehouse?.name ?? <span className="text-n-400">at receiving</span>}</td>
                  <td className={`${TD} mono text-right`}>{r.expectedQuantity}</td>
                  <td className={`${TD} mono text-right font-semibold ${r.status === 'posted' ? 'text-n-800' : 'text-n-400'}`}>{r.receivedQuantity || '—'}</td>
                  <td className={`${TD} whitespace-nowrap text-n-500`}>{formatDate(r.createdAt)}</td>
                  <td className={`${TD} text-right`}>
                    {r.status === 'pending' && (
                      <button
                        onClick={() => setReceiving(r.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-600"
                      >
                        <PackageCheck size={14} /> Receive
                      </button>
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

      {receiving && (
        <ReceiveModal
          receiptId={receiving}
          onClose={() => setReceiving(null)}
          onPosted={() => { setReceiving(null); refresh(); }}
        />
      )}
    </div>
  );
}

const TH = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
const TD = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700 whitespace-nowrap';

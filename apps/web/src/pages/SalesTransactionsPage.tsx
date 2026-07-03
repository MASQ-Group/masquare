import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Receipt, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { salesTransactionsApi, type SalesTransaction } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney } from '../lib/format';
import { SalesTransactionModal } from '../components/sales/SalesTransactionModal';

export function SalesTransactionsPage() {
  const qc = useQueryClient();
  const { activeCompanyId } = useAuth();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SalesTransaction | null | undefined>(undefined);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const params = { q: q || undefined, companyId: activeCompanyId || undefined, page, pageSize: 50 };
  const { data, isLoading } = useQuery({ queryKey: ['sales-transactions', params], queryFn: () => salesTransactionsApi.list(params) });
  const del = useMutation({
    mutationFn: (id: string) => salesTransactionsApi.remove(id),
    onSuccess: () => { toast.success('Transaction removed'); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex-1">
          <div className="eyebrow mb-1.5">Sales Transactions</div>
          <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Sales transactions</h1>
          <p className="mt-1 text-[13.5px] text-n-500">Register and review sales across all channels. Revenue/profit analytics build on this data.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(null)}><Plus size={17} /> Register transaction</button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="flex h-[38px] min-w-[280px] flex-1 items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3">
          <Search size={16} className="text-n-400" />
          <input className="h-full flex-1 text-[13px] outline-none" placeholder="Search transaction ID or SKU…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <span className="rounded-md border border-dashed border-n-200 px-3 py-2 text-[12px] text-n-400">Dynamic registration via sales-channel APIs — coming with the Integrations module</span>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                {['Date', 'Transaction ID', 'Sales channel', 'Destination', 'SKUs', 'Qty'].map((h) => (
                  <th key={h} className="border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap">{h}</th>
                ))}
                <th className="border-b border-n-200 bg-n-25 px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-n-500">Net sales</th>
                <th className="border-b border-n-200 bg-n-25 px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-n-500">Sales fee</th>
                <th className="border-b border-n-200 bg-n-25" />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-[13px] text-n-500">No transactions yet. Register your first sale.</td></tr>}
              {items.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-teal-50" onClick={() => setEditing(t)}>
                  <td className="mono border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700">{formatDate(t.date)}</td>
                  <td className="mono border-b border-n-100 px-4 py-2.5 text-[13px] font-medium text-n-800">{t.transactionRef}</td>
                  <td className="border-b border-n-100 px-4 py-2.5 text-[13.5px] text-n-700">{t.salesChannel?.name ?? '—'}</td>
                  <td className="border-b border-n-100 px-4 py-2.5 text-[13.5px] text-n-700">{t.destinationCountry?.name ?? '—'}</td>
                  <td className="border-b border-n-100 px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {t.items.slice(0, 3).map((it, idx) => <span key={idx} className="mono rounded bg-n-100 px-1.5 py-0.5 text-[11px] text-n-600">{it.sku}</span>)}
                      {t.itemCount > 3 && <span className="text-[11px] text-n-400">+{t.itemCount - 3}</span>}
                    </div>
                  </td>
                  <td className="mono border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700">{t.totals.quantity}</td>
                  <td className="mono border-b border-n-100 px-4 py-2.5 text-right text-[13px] font-medium text-n-800">{formatMoney({ amount: t.totals.netSales, currency: t.currency ?? 'EUR' })}</td>
                  <td className="mono border-b border-n-100 px-4 py-2.5 text-right text-[13px] text-n-700">{formatMoney({ amount: t.totals.fee, currency: t.feeCurrency ?? t.currency ?? 'EUR' })}</td>
                  <td className="border-b border-n-100 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" onClick={() => setEditing(t)}><Pencil size={15} /></button>
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => confirm(`Remove transaction ${t.transactionRef}?`) && del.mutate(t.id)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[13px] text-n-500">Showing <span className="mono">{items.length}</span> of <span className="mono">{total}</span> transactions</span>
        <div className="flex gap-1">
          <button disabled={page <= 1} className="mono grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-[13px] text-n-600 disabled:opacity-40" onClick={() => setPage((p) => p - 1)}>‹</button>
          <span className="mono grid h-8 min-w-8 place-items-center px-2 text-[13px] text-n-600">{page} / {pageCount}</span>
          <button disabled={page >= pageCount} className="mono grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-[13px] text-n-600 disabled:opacity-40" onClick={() => setPage((p) => p + 1)}>›</button>
        </div>
      </div>

      {editing !== undefined && (
        <SalesTransactionModal transaction={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); }} />
      )}
    </div>
  );
}

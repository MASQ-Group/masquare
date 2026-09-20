import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { jiniusOrdersApi, salesChannelsApi, salesTransactionsApi } from '../../lib/api';

const money = (v: number | null | undefined) => (v == null ? '—' : `€${v.toFixed(2)}`);
const day = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

/**
 * Turning selected Jinius sales into the local invoice accounting raises for them.
 *
 * A Jinius sale is an ordinary transaction and counts like one. Accounting then invoices a batch of
 * them locally, and that invoice is the same money a second time — so these two dialogs are how a
 * person says which invoice covers which sales. From that moment the Jinius transactions stay
 * visible and stop counting.
 *
 * Both take the ids of the SELECTED TRANSACTIONS; the server resolves them to the orders behind.
 */
export function CreateLocalSaleDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const preview = useQuery({
    queryKey: ['jinius', 'local-sale', ids],
    queryFn: () => jiniusOrdersApi.previewLocalSale(ids),
    retry: false,
  });
  const channels = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const locals = (channels.data ?? []).filter((c) => c.kind === 'local');
  const [channelId, setChannelId] = useState('');
  const [date, setDate] = useState('');
  const [ref, setRef] = useState('');

  const create = useMutation({
    mutationFn: () => jiniusOrdersApi.createLocalSale({ orderIds: ids, salesChannelId: channelId, date: date || undefined, transactionRef: ref.trim() || undefined }),
    onSuccess: (r) => { toast.success(`Draft ${r.transactionRef ?? ''} created from ${r.orderCount} Jinius sale${r.orderCount === 1 ? '' : 's'}`); onDone(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not create the transaction', { duration: 12000 }),
  });

  const p = preview.data;
  const ready = !!channelId && !!p && p.problems.length === 0 && p.lines.length > 0;

  return (
    <Shell onClose={onClose} title="Create the local sales transaction" wide>
      <p className="text-[12.5px] text-n-500">
        Each line is one Jinius order line at the price it sold for, less everything Jinius keeps. VAT is
        split out of that at the product’s own rate. Saved as a <b>draft</b> to review and submit; the Jinius
        sales it covers stop counting in the reports.
      </p>

      {preview.isLoading && <p className="text-[13px] text-n-500">Working it out…</p>}
      {preview.isError && <p className="text-[13px] text-warning">{(preview.error as any)?.response?.data?.message ?? 'Could not read those sales.'}</p>}
      {p && p.problems.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          {p.problems.map((x) => <div key={x} className="flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{x}</div>)}
        </div>
      )}

      {p && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="label">Local sales channel</span>
              <Select value={channelId} onChange={setChannelId} options={[{ value: '', label: 'Choose…' }, ...locals.map((c) => ({ value: c.id, label: c.name }))]} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Date</span>
              <input type="date" className="input h-9 text-[13px]" value={date || (p.date ? new Date(p.date).toISOString().slice(0, 10) : '')} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Transaction ID</span>
              <input className="input mono h-9 text-[13px]" placeholder={p.suggestedRef} value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
          </div>
          <p className="-mt-1 text-[11.5px] text-n-400">The date is the newest sale in the batch; change either as you need. Put your accounting invoice number in the Transaction ID if you have it.</p>

          <div className="max-h-[38vh] overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-n-500">
                  {['Order', 'SKU', 'Qty', 'Sold for − fee', 'Net', 'VAT'].map((h) => <th key={h} className="border-b border-n-200 px-2 py-1.5">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={`${l.orderId}-${l.orderLineId}`}>
                    <td className="mono border-b border-n-100 px-2 py-1 text-n-500">{l.orderId}</td>
                    <td className="mono border-b border-n-100 px-2 py-1 text-teal-700">{l.sku}</td>
                    <td className="mono border-b border-n-100 px-2 py-1 text-n-600">{l.quantity}</td>
                    <td className="mono border-b border-n-100 px-2 py-1 text-n-800">{money(l.grossAmount)}</td>
                    <td className="mono border-b border-n-100 px-2 py-1 text-n-600">{money(l.netSalesAmount)}</td>
                    <td className="mono border-b border-n-100 px-2 py-1 text-n-500">{money(l.vatAmount)} ({l.vatPct}%)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-4 text-[12.5px] text-n-600">
            <span>Invoice total <b className="mono text-n-900">{money(p.grossTotal)}</b></span>
            <span>net <span className="mono">{money(p.netTotal)}</span></span>
            <span>VAT <span className="mono">{money(p.vatTotal)}</span></span>
            <span className="text-n-400">Jinius kept <span className="mono">{money(p.commissionTotal)}</span></span>
          </div>
        </>
      )}

      <Actions onClose={onClose}>
        <button type="button" className="btn btn-primary" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create draft
        </button>
      </Actions>
    </Shell>
  );
}

/** Point selected Jinius sales at an invoice already entered — for everything invoiced before this existed. */
export function LinkLocalSaleDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState('');
  const found = useQuery({
    queryKey: ['jinius', 'link-search', q],
    queryFn: () => salesTransactionsApi.list({ q: q.trim() || undefined, pageSize: 20 }),
    enabled: q.trim().length >= 2,
  });
  const link = useMutation({
    mutationFn: () => jiniusOrdersApi.link(ids, picked),
    onSuccess: (r) => { toast.success(`${r.linked} Jinius sale${r.linked === 1 ? '' : 's'} linked to ${r.transactionRef}`); onDone(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not link', { duration: 10000 }),
  });

  return (
    <Shell onClose={onClose} title="Link to an existing local transaction">
      <p className="text-[12.5px] text-n-500">
        For sales your accounting has already invoiced. The transaction must be on a local sales channel.
        Once linked, these {ids.length} Jinius sale{ids.length === 1 ? '' : 's'} stop counting in the reports.
      </p>
      <input className="input h-9 text-[13px]" placeholder="Search by transaction ID" value={q} onChange={(e) => { setQ(e.target.value); setPicked(''); }} />
      <div className="flex max-h-[45vh] flex-col gap-1 overflow-auto">
        {found.isFetching && <span className="text-[12.5px] text-n-500">Searching…</span>}
        {(found.data?.items ?? []).map((t) => (
          <label key={t.id} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px] ${picked === t.id ? 'border-teal-300 bg-teal-50' : 'border-n-200'}`}>
            <input type="radio" name="tx" checked={picked === t.id} onChange={() => setPicked(t.id)} className="h-3.5 w-3.5 accent-[var(--teal-500)]" />
            <span className="mono text-n-800">{t.transactionRef}</span>
            <span className="text-n-500">{day(t.date)}</span>
            <span className="text-n-400">{t.salesChannel?.name ?? '—'}</span>
            <span className="ml-auto text-n-400">{t.status}</span>
          </label>
        ))}
        {q.trim().length >= 2 && !found.isFetching && (found.data?.items ?? []).length === 0 && (
          <span className="text-[12.5px] text-n-500">Nothing matches that.</span>
        )}
      </div>
      <Actions onClose={onClose}>
        <button type="button" className="btn btn-primary" disabled={!picked || link.isPending} onClick={() => link.mutate()}>
          {link.isPending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Link
        </button>
      </Actions>
    </Shell>
  );
}

function Shell({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className={`card flex max-h-[85vh] ${wide ? 'w-[720px]' : 'w-[560px]'} max-w-full flex-col gap-3 overflow-auto p-4`} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold text-n-800">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Actions({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-1 flex justify-end gap-2">
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      {children}
    </div>
  );
}

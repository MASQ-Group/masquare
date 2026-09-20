import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Link2, Link2Off, Loader2, RefreshCw, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { jiniusOrdersApi, salesChannelsApi, salesTransactionsApi, type JiniusOrder } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';

const money = (v: number | null | undefined, ccy = 'EUR') => (v == null ? '—' : `${ccy === 'EUR' ? '€' : `${ccy} `}${v.toFixed(2)}`);
const day = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

/**
 * Jinius orders, and the local invoice that accounts for them.
 *
 * These orders are deliberately not sales transactions: accounting issues a local invoice for them,
 * that invoice is entered here as a local transaction, and the reports count it. So this page is
 * where a Jinius sale is turned into that transaction — or pointed at the one already raised for it.
 *
 * An order shows as covered once it is linked. Anything still uncovered is money the reports have
 * not counted yet, which is exactly the list a person needs at the end of a week.
 */
export function JiniusOrdersPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [linked, setLinked] = useState<'' | 'yes' | 'no'>('no');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);

  const orders = useQuery({
    queryKey: ['jinius', 'orders', linked, q],
    queryFn: () => jiniusOrdersApi.list({ linked: linked || undefined, q: q.trim() || undefined }),
    retry: false,
  });

  const sync = useMutation({
    mutationFn: () => jiniusOrdersApi.sync(),
    onSuccess: (r) => {
      toast.success(`${r.scanned} order${r.scanned === 1 ? '' : 's'} read — ${r.created} new`
        + (r.unmatched ? `, ${r.unmatched} line${r.unmatched === 1 ? '' : 's'} matching no product` : ''));
      if (r.availability.deducted || r.availability.returned) {
        toast.info(`Availability: ${r.availability.deducted} taken, ${r.availability.returned} given back`);
      }
      qc.invalidateQueries({ queryKey: ['jinius'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not read Jinius orders', { duration: 10000 }),
  });

  const rows = orders.data?.orders ?? [];
  const chosen = useMemo(() => rows.filter((o) => selected.has(o.id)), [rows, selected]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = rows.length > 0 && rows.every((o) => selected.has(o.id));

  const unlink = useMutation({
    mutationFn: () => jiniusOrdersApi.unlink(chosen.map((o) => o.id)),
    onSuccess: (r) => { toast.success(`${r.unlinked} order${r.unlinked === 1 ? '' : 's'} unlinked`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['jinius'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not unlink'),
  });

  if (orders.isError) {
    const msg = (orders.error as any)?.response?.data?.message ?? 'Jinius orders could not be loaded.';
    return (
      <div className="flex flex-col gap-4">
        <PageHeader module="Sales" title="Jinius orders" info="Marketplace orders that accounting invoices locally. They are not counted in revenue themselves — the local transaction they are linked to is." />
        <p className="card px-4 py-3 text-[13px] text-n-600">{msg}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        module="Sales"
        title="Jinius orders"
        info="Marketplace orders that accounting invoices locally. They are not counted in revenue themselves — the local transaction they are linked to is."
        summary={`${rows.length} order${rows.length === 1 ? '' : 's'}${linked === 'no' ? ' not invoiced yet' : linked === 'yes' ? ' already invoiced' : ''}`}
        primary={
          <button type="button" className="hbtn-primary" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Read from Jinius
          </button>
        }
      />

      <p className="text-[12.5px] text-n-500">
        These orders are not counted in revenue or profit: accounting invoices them locally, and that
        local transaction is what the reports count. Select orders to raise it, or to point them at an
        invoice you have already entered.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44">
          <Select
            value={linked}
            onChange={(v) => { setLinked(v as '' | 'yes' | 'no'); setSelected(new Set()); }}
            options={[
              { value: 'no', label: 'Not invoiced yet' },
              { value: 'yes', label: 'Already invoiced' },
              { value: '', label: 'All orders' },
            ]}
          />
        </div>
        <input
          className="input h-9 w-64 text-[13px]"
          placeholder="Order number or SKU"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex-1" />
        {chosen.length > 0 && (
          <>
            <span className="text-[12.5px] text-n-500">{chosen.length} selected</span>
            {chosen.every((o) => !o.linked) && (
              <>
                <button type="button" className="hbtn-primary" onClick={() => setCreating(true)}>
                  <Receipt size={14} /> Create local transaction
                </button>
                <button type="button" className="hbtn" onClick={() => setLinking(true)}>
                  <Link2 size={14} /> Link to existing
                </button>
              </>
            )}
            {chosen.every((o) => o.linked) && (
              <button type="button" className="hbtn" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
                <Link2Off size={14} /> Unlink
              </button>
            )}
          </>
        )}
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-n-500">
              <th className="border-b border-n-200 bg-n-25 px-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--teal-500)]"
                  checked={allOn}
                  onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((o) => o.id)))}
                />
              </th>
              {['Order', 'Date', 'State', 'Lines', 'Sold for', 'Jinius keeps', 'To invoice', 'Invoice'].map((h) => (
                <th key={h} className="border-b border-n-200 bg-n-25 px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.isLoading && <tr><td colSpan={9} className="px-4 py-10 text-center text-n-500">Loading…</td></tr>}
            {!orders.isLoading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-n-500">No Jinius orders here yet. Press “Read from Jinius”.</td></tr>
            )}
            {rows.map((o) => (
              <OrderRow key={o.id} order={o} selected={selected.has(o.id)} onToggle={() => toggle(o.id)} onOpenTransaction={(id) => navigate(`/sales-transactions?open=${id}`)} />
            ))}
          </tbody>
        </table>
      </div>

      {creating && <CreateLocalSale orders={chosen} onClose={() => setCreating(false)} onDone={() => { setCreating(false); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['jinius'] }); }} />}
      {linking && <LinkExisting orders={chosen} onClose={() => setLinking(false)} onDone={() => { setLinking(false); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['jinius'] }); }} />}
    </div>
  );
}

function OrderRow({ order, selected, onToggle, onOpenTransaction }: {
  order: JiniusOrder;
  selected: boolean;
  onToggle: () => void;
  onOpenTransaction: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={`cursor-pointer hover:bg-teal-50/40 ${selected ? 'bg-teal-50/60' : ''}`} onClick={() => setOpen((v) => !v)}>
        <td className="border-b border-n-100 px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={selected} onChange={onToggle} />
        </td>
        <td className="border-b border-n-100 px-3 py-2"><span className="mono text-n-800">{order.commercialId || order.orderId}</span></td>
        <td className="border-b border-n-100 px-3 py-2 text-n-600">{day(order.orderedAt)}</td>
        <td className="border-b border-n-100 px-3 py-2"><span className="tag border border-n-200 bg-n-50 text-n-600">{order.state}</span></td>
        <td className="border-b border-n-100 px-3 py-2 text-n-600">{order.lines.length}</td>
        <td className="mono border-b border-n-100 px-3 py-2 text-n-800">{money(order.priceTotal, order.currency)}</td>
        <td className="mono border-b border-n-100 px-3 py-2 text-n-500">{money(order.totalCommission, order.currency)}</td>
        <td className="mono border-b border-n-100 px-3 py-2 font-semibold text-n-800">{money(order.netOfCommission, order.currency)}</td>
        <td className="border-b border-n-100 px-3 py-2" onClick={(e) => e.stopPropagation()}>
          {order.linked ? (
            <button type="button" className="mono text-[12px] font-semibold text-teal-700 hover:underline" onClick={() => onOpenTransaction(order.linked!.id)}>
              {order.linked.ref}
            </button>
          ) : (
            <span className="text-[12px] text-n-400">not invoiced</span>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={8} className="border-b border-n-100 px-3 pb-3">
            <table className="w-full text-[12px]">
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1 pr-3"><span className="mono text-teal-700">{l.sku}</span>{!l.productId && <span className="ml-2 text-warning">matches no product</span>}</td>
                    <td className="py-1 pr-3 text-n-600">{l.title ?? '—'}</td>
                    <td className="mono py-1 pr-3 text-n-500">×{l.quantity}</td>
                    <td className="mono py-1 pr-3 text-n-700">{money(l.price, order.currency)}</td>
                    <td className="mono py-1 pr-3 text-n-500">− {money(l.totalCommission, order.currency)} fee</td>
                    <td className="mono py-1 font-semibold text-n-800">{money(l.netOfCommission, order.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

/** The draft invoice, shown before anything is written. */
function CreateLocalSale({ orders, onClose, onDone }: { orders: JiniusOrder[]; onClose: () => void; onDone: () => void }) {
  const ids = orders.map((o) => o.id);
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
    onSuccess: (r) => { toast.success(`Draft transaction ${r.transactionRef ?? ''} created from ${r.orderCount} order(s)`); onDone(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not create the transaction', { duration: 12000 }),
  });

  const p = preview.data;
  const ready = !!channelId && !!p && p.problems.length === 0 && p.lines.length > 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="card flex max-h-[85vh] w-[720px] max-w-full flex-col gap-3 overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold text-n-800">Create the local sales transaction</h3>
        <p className="text-[12.5px] text-n-500">
          Each line is one Jinius order line at the price it sold for, less everything Jinius keeps. VAT is
          split out of that at the product’s own rate. It is saved as a <b>draft</b> for you to review and submit.
        </p>

        {preview.isLoading && <p className="text-[13px] text-n-500">Working it out…</p>}
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
            <p className="-mt-1 text-[11.5px] text-n-400">The date is the newest order in the batch; change either as you need. Put your accounting invoice number in the Transaction ID if you have it.</p>

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
            <div className="flex flex-wrap gap-4 text-[12.5px] text-n-600">
              <span>Invoice total <b className="mono text-n-900">{money(p.grossTotal)}</b></span>
              <span>net <span className="mono">{money(p.netTotal)}</span></span>
              <span>VAT <span className="mono">{money(p.vatTotal)}</span></span>
              <span className="text-n-400">Jinius kept <span className="mono">{money(p.commissionTotal)}</span></span>
            </div>
          </>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create draft
          </button>
        </div>
      </div>
    </div>
  );
}

/** Point orders at an invoice already entered — the answer for everything sold before this existed. */
function LinkExisting({ orders, onClose, onDone }: { orders: JiniusOrder[]; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState('');
  const found = useQuery({
    queryKey: ['jinius', 'link-search', q],
    queryFn: () => salesTransactionsApi.list({ q: q.trim() || undefined, pageSize: 20 }),
    enabled: q.trim().length >= 2,
  });
  const link = useMutation({
    mutationFn: () => jiniusOrdersApi.link(orders.map((o) => o.id), picked),
    onSuccess: (r) => { toast.success(`${r.linked} order(s) linked to ${r.transactionRef}`); onDone(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not link', { duration: 10000 }),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="card flex max-h-[80vh] w-[560px] max-w-full flex-col gap-3 overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold text-n-800">Link to an existing transaction</h3>
        <p className="text-[12.5px] text-n-500">
          For orders your accounting already invoiced. The transaction must be on a local sales channel.
          Once linked, these {orders.length} order{orders.length === 1 ? '' : 's'} count as covered by it.
        </p>
        <input className="input h-9 text-[13px]" placeholder="Search by transaction ID" value={q} onChange={(e) => { setQ(e.target.value); setPicked(''); }} />
        <div className="flex flex-col gap-1">
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
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!picked || link.isPending} onClick={() => link.mutate()}>
            {link.isPending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Link
          </button>
        </div>
      </div>
    </div>
  );
}

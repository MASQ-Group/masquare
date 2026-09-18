import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, MessageSquareWarning, PackagePlus, RefreshCcw, Search, Trash2, Truck, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Pagination, TableScroll } from '@masquare/ui';
import { customerShipmentsApi, type CustomerShipment } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';
import { useAccess } from '../../lib/useAccess';
import { FulfilCustomerShipmentModal } from './FulfilCustomerShipmentModal';
import { BookCustomerShipmentModal } from './BookCustomerShipmentModal';
import { AskCustomerModal } from './AskCustomerModal';

/**
 * The shipments our customers have filed, on our side of the glass.
 *
 * Two queues rather than a status column to squint at: what is waiting for us, and what has gone.
 * The waiting one is ordered oldest first, because it is a queue and a queue is worked from the
 * front — the newest-first ordering everywhere else in the platform would quietly bury the shipment
 * that has been waiting longest.
 */
const PAGE = 25;

export function CustomerShipmentsTab({ queue }: { queue: 'pending' | 'fulfilled' }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { may } = useAccess();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [fulfilling, setFulfilling] = useState<CustomerShipment | null>(null);
  const [asking, setAsking] = useState<CustomerShipment | null>(null);
  const [booking, setBooking] = useState<CustomerShipment | null>(null);

  const query = useQuery({
    queryKey: ['customer-shipments', queue, { q, page }],
    queryFn: () => customerShipmentsApi.list({ queue, q: q.trim() || undefined, take: PAGE, skip: (page - 1) * PAGE }),
    placeholderData: (prev) => prev,
  });
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ['customer-shipments'] });
  const failed = (e: any) => toast.error(e?.response?.data?.message ?? 'That did not work', { duration: 9000 });

  const askFor = useMutation({
    mutationFn: ({ id, question }: { id: string; question: string }) => customerShipmentsApi.requestInfo(id, question),
    onSuccess: () => { toast.success('Sent back to the customer'); setAsking(null); refresh(); },
    onError: failed,
  });
  const reopen = useMutation({
    mutationFn: (id: string) => customerShipmentsApi.reopen(id),
    onSuccess: () => { toast.success('Back in the waiting queue'); refresh(); },
    onError: failed,
  });
  /**
   * Remove one altogether.
   *
   * For the ones that were never real — a test, a duplicate, the wrong customer. Cancelling is the
   * answer when a real shipment is not going: it stays on the record, because the customer filed it
   * and is owed an account of what became of it.
   */
  const remove = useMutation({
    mutationFn: (id: string) => customerShipmentsApi.remove(id),
    onSuccess: (r) => { toast.success(`${r.reference} removed`); refresh(); },
    onError: failed,
  });

  const askRemove = async (s: CustomerShipment) => {
    const sent = s.status === 'FULFILLED' || s.status === 'ARCHIVED';
    const ok = await confirm({
      title: `Remove ${s.reference}?`,
      // What actually happens, and — where it applies — what does not. Deleting the record of a
      // parcel already with the carrier does not stop the parcel.
      message: sent
        ? 'It disappears from both queues and from the customer’s own list. This parcel has already gone to the carrier; removing the record here does not recall it.'
        : 'It disappears from this queue and from the customer’s own list. If it is a real shipment that is not going, send it back with a question or cancel it instead.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (ok) remove.mutate(s.id);
  };

  const recheck = useMutation({
    mutationFn: (id: string) => customerShipmentsApi.refreshTracking(id),
    onSuccess: (r) => {
      // What actually happened, rather than a cheerful nothing: a number the carrier does not
      // recognise and a number with no news look identical unless the message says which.
      if (r.updated === 0) toast.info(r.messages[0] ?? 'The carrier had nothing new.');
      else if (r.notFound > 0) toast.warning('The carrier does not recognise that tracking number yet.');
      else toast.success(r.delivered > 0 ? 'Delivered' : 'Tracking updated');
      refresh();
    },
    onError: failed,
  });

  const trackingLink = (s: CustomerShipment) => {
    const template = s.shippingService?.trackingUrlTemplate;
    if (!template || !s.trackingNumber) return null;
    return template.replace('{tracking}', encodeURIComponent(s.trackingNumber));
  };

  const money = (cents: number | null, currency: string) =>
    cents == null ? '—' : `${currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `}${(cents / 100).toFixed(2)}`;

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px]';

  return (
    <div className="card overflow-hidden">
      {fulfilling && <FulfilCustomerShipmentModal shipment={fulfilling} onClose={() => setFulfilling(null)} />}
      {booking && <BookCustomerShipmentModal shipment={booking} onClose={() => setBooking(null)} />}
      {asking && (
        <AskCustomerModal
          shipment={asking}
          busy={askFor.isPending}
          onAsk={(question) => askFor.mutate({ id: asking.id, question })}
          onClose={() => setAsking(null)}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
        <div className="flex h-8 flex-[0_1_320px] items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-2.5 focus-within:border-teal-400">
          <Search size={15} className="text-n-400" />
          <input
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            placeholder="Search reference, customer, recipient or tracking…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex-1" />
        <span className="text-[12px] text-n-500">{total.toLocaleString()} shipment{total === 1 ? '' : 's'}</span>
        {/* For the customers who email their details instead of filing them. Beside the queue it
            joins, rather than in the page header, where it would sit above the other tabs too. */}
        <Link to="/shipments/customer/new" className="hbtn-primary">
          <PackagePlus size={15} /> File for a customer
        </Link>
      </div>

      <TableScroll>
        <table className="w-full min-w-[980px] border-collapse">
          <thead>
            <tr>
              <th className={th}>Reference</th>
              <th className={th}>Customer</th>
              <th className={th}>{queue === 'pending' ? 'Filed' : 'Sent'}</th>
              <th className={th}>Collect from</th>
              <th className={th}>Deliver to</th>
              <th className={th}>Parcels</th>
              {queue === 'fulfilled' && <th className={th}>Carrier</th>}
              {queue === 'fulfilled' && <th className={th}>Where it is</th>}
              {queue === 'fulfilled' && <th className={th}>Tracking</th>}
              {queue === 'fulfilled' && <th className={`${th} text-right`}>Cost</th>}
              {queue === 'fulfilled' && <th className={`${th} text-right`}>Charged</th>}
              <th className={`${th} text-right`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr><td colSpan={12} className="px-4 py-6 text-center text-n-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-n-500">
                  {q ? 'Nothing matches that.' : queue === 'pending' ? 'Nothing waiting. Filed shipments appear here as soon as a customer sends one.' : 'Nothing sent yet.'}
                </td>
              </tr>
            ) : (
              rows.map((s) => {
                const link = trackingLink(s);
                const weight = s.parcels.reduce((n, p) => n + Number(p.weightKg), 0);
                return (
                  <tr key={s.id} className="hover:bg-n-25">
                    <td className={`${td} mono font-semibold text-n-800`}>
                      {s.reference}
                      {s.status === 'NEEDS_INFO' && (
                        <span className="ml-1.5 rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-orange-700" title={s.infoRequest ?? undefined}>
                          asked
                        </span>
                      )}
                      {s.customerReference && <div className="mono text-[11px] font-normal text-n-500">{s.customerReference}</div>}
                    </td>
                    <td className={`${td} text-n-700`}>{s.customer.name}</td>
                    <td className={`${td} text-n-600`}>
                      {new Date(queue === 'pending' ? s.createdAt : s.shippedAt ?? s.fulfilledAt ?? s.createdAt).toLocaleDateString()}
                    </td>
                    <td className={`${td} text-n-600`}>{[s.fromCompany || s.fromName, s.fromCity, s.fromCountryIso].filter(Boolean).join(', ') || '—'}</td>
                    <td className={`${td} text-n-600`}>{[s.toCompany || s.toName, s.toCity, s.toCountryIso].filter(Boolean).join(', ') || '—'}</td>
                    <td className={`${td} mono text-n-600`}>{s.parcels.length} · {weight.toFixed(2)}kg</td>
                    {queue === 'fulfilled' && <td className={`${td} text-n-600`}>{s.shippingService?.name ?? '—'}</td>}
                    {queue === 'fulfilled' && (
                      <td className={td}>
                        {/* Only the carriers with an API say anything here. For the rest the
                            tracking link beside it is the whole answer, and pretending otherwise
                            would be worse than a dash. */}
                        {s.tracking?.deliveredAt ? (
                          <span className="tag bg-teal-50 text-teal-700">Delivered {new Date(s.tracking.deliveredAt).toLocaleDateString()}</span>
                        ) : s.tracking?.exceptionDescription ? (
                          <span className="tag bg-warning-bg text-warning" title={s.tracking.exceptionCode ?? undefined}>{s.tracking.exceptionDescription}</span>
                        ) : s.tracking?.found === false ? (
                          <span className="text-n-500">Not recognised</span>
                        ) : s.tracking?.statusDescription ? (
                          <span className="text-n-700">{s.tracking.statusDescription}</span>
                        ) : (
                          <span className="text-n-400">—</span>
                        )}
                        {s.tracking?.lastScanDescription && !s.tracking.deliveredAt && (
                          <div className="text-[11.5px] text-n-500">
                            {[s.tracking.lastScanLocation, s.tracking.lastScanAt ? new Date(s.tracking.lastScanAt).toLocaleDateString() : null].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                    )}
                    {queue === 'fulfilled' && (
                      <td className={`${td} mono`}>
                        {link ? (
                          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-700 hover:underline">
                            {s.trackingNumber}<ExternalLink size={11} />
                          </a>
                        ) : (s.trackingNumber ?? '—')}
                      </td>
                    )}
                    {/* Ours, and labelled: this column does not exist on the customer's screen. */}
                    {queue === 'fulfilled' && <td className={`${td} mono text-right text-n-600`} title="What the carrier charged us">{money(s.costCents, 'EUR')}</td>}
                    {queue === 'fulfilled' && <td className={`${td} mono text-right text-n-800`}>{money(s.chargeCents, s.chargeCurrency)}</td>}
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {queue === 'pending' ? (
                        <>
                          <button
                            type="button"
                            className="mr-3 text-[11.5px] font-semibold text-n-600 hover:underline"
                            title="Send it back with a question"
                            onClick={() => setAsking(s)}
                          >
                            <MessageSquareWarning size={12} className="mr-1 inline" />Ask
                          </button>
                          {may('delete_records') && (
                            <button
                              type="button"
                              className="mr-3 text-[11.5px] font-semibold text-n-500 hover:text-danger hover:underline"
                              title="Remove it altogether — for a test or a duplicate"
                              disabled={remove.isPending}
                              onClick={() => askRemove(s)}
                            >
                              <Trash2 size={12} className="mr-1 inline" />Delete
                            </button>
                          )}
                          {/* Booked here, a real label on production; the right to do that is the
                              same one booking our own orders needs. */}
                          {may('marketplace_write') && (
                            <button
                              type="button"
                              className="mr-3 text-[11.5px] font-semibold text-teal-700 hover:underline"
                              title="Book it with FedEx from here: label, invoice and tracking"
                              onClick={() => setBooking(s)}
                            >
                              <Truck size={12} className="mr-1 inline" />Book FedEx
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-[11.5px] font-semibold text-teal-700 hover:underline"
                            title="Record a booking made on the carrier's own site"
                            onClick={() => setFulfilling(s)}
                          >
                            Fulfil
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="mr-3 text-[11.5px] font-semibold text-n-600 hover:underline"
                            title="It was not actually sent"
                            onClick={async () => {
                              const ok = await confirm({
                                title: `Reopen ${s.reference}?`,
                                message: 'It goes back into the waiting queue. The customer sees it as in progress again.',
                                confirmLabel: 'Reopen',
                              });
                              if (ok) reopen.mutate(s.id);
                            }}
                          >
                            <Undo2 size={12} className="mr-1 inline" />Reopen
                          </button>
                          {s.trackingNumber && (
                            <button
                              type="button"
                              className="mr-3 text-[11.5px] font-semibold text-n-600 hover:underline"
                              title="Ask the carrier where it is now"
                              disabled={recheck.isPending}
                              onClick={() => recheck.mutate(s.id)}
                            >
                              <RefreshCcw size={12} className="mr-1 inline" />Recheck
                            </button>
                          )}
                          {may('delete_records') && (
                            <button
                              type="button"
                              className="mr-3 text-[11.5px] font-semibold text-n-500 hover:text-danger hover:underline"
                              title="Remove it altogether — for a test or a duplicate"
                              disabled={remove.isPending}
                              onClick={() => askRemove(s)}
                            >
                              <Trash2 size={12} className="mr-1 inline" />Delete
                            </button>
                          )}
                          <button type="button" className="text-[11.5px] font-semibold text-teal-700 hover:underline" onClick={() => setFulfilling(s)}>
                            Amend
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableScroll>

      <div className="px-4 pb-3">
        <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / PAGE))} onPageChange={setPage} />
      </div>
    </div>
  );
}

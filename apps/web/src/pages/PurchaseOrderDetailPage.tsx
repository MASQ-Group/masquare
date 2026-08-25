import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, LockOpen, PackageCheck, Send, Undo2, SquarePen } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { goodsReceiptsApi, purchaseOrdersApi, vendorReturnsApi, type PurchaseOrder, type PurchaseOrderStatus } from '../lib/api';
import { formatDate } from '../lib/format';
import { ReceiveModal } from '../components/purchase-orders/ReceiveModal';
import { ReturnToVendorModal } from '../components/purchase-orders/ReturnToVendorModal';
import { useConfirm } from '../components/ConfirmProvider';
import { AmendOrderModal } from '../components/purchase-orders/AmendOrderModal';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/common/PageHeader';

const money = (v: number, ccy = 'EUR') => `${ccy === 'EUR' ? '€' : ccy + ' '}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  draft: 'border-n-200 bg-n-50 text-n-600',
  submitted: 'border-info-bd bg-info-bg text-info',
  partially_received: 'border-warning-bd bg-warning-bg text-warning',
  received: 'border-teal-300 bg-teal-50 text-teal-700',
  cancelled: 'border-danger-bd bg-danger-bg text-danger',
};
const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  partially_received: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [receiving, setReceiving] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockNote, setUnlockNote] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  const { data: po, isLoading } = useQuery({ queryKey: ['purchase-order', id], queryFn: () => purchaseOrdersApi.get(id!), enabled: !!id });
  const { data: receipts = [] } = useQuery({ queryKey: ['purchase-order', id, 'receipts'], queryFn: () => goodsReceiptsApi.forPurchaseOrder(id!), enabled: !!id });
  const { data: returns } = useQuery({
    queryKey: ['purchase-order', id, 'returns'],
    queryFn: () => vendorReturnsApi.list({ purchaseOrderId: id!, pageSize: 50 }),
    enabled: !!id,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['purchase-order', id] });
    qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    qc.invalidateQueries({ queryKey: ['goods-receipts'] });
    qc.invalidateQueries({ queryKey: ['vendor-returns'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
  };

  const submit = useMutation({
    mutationFn: () => purchaseOrdersApi.submit(id!),
    onSuccess: (r) => { toast.success(`${r.poNumber} submitted`); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not submit'),
  });
  const cancel = useMutation({
    mutationFn: () => purchaseOrdersApi.cancel(id!, cancelReason.trim() || undefined),
    onSuccess: (r) => { toast.success(`${r.poNumber} cancelled`); setConfirmCancel(false); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not cancel'),
  });
  // Admins unlock outright; everyone else raises a request for an admin to decide.
  const unlock = useMutation({
    mutationFn: () =>
      isAdmin
        ? purchaseOrdersApi.unlock(id!, unlockNote.trim() || undefined)
        : purchaseOrdersApi.requestUnlock(id!, unlockNote.trim() || undefined),
    onSuccess: (r: any) => {
      if (isAdmin) toast.success(`${r.poNumber} unlocked — it is a draft again`);
      else if (r?.alreadyRequested) toast.info('An unlock request is already pending for this order');
      else toast.success('Unlock request sent to the admins');
      setUnlockOpen(false);
      setUnlockNote('');
      refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not unlock'),
  });
  const del = useMutation({
    mutationFn: () => purchaseOrdersApi.remove(id!),
    onSuccess: () => { toast.success('Draft deleted'); navigate('/purchase-orders'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not delete'),
  });

  if (isLoading || !po) {
    return <div className="w-full"><div className="card p-6 text-[13px] text-n-500">Loading…</div></div>;
  }

  const isDraft = po.status === 'draft';
  const canCancel = po.status === 'draft' || po.status === 'submitted';
  // Only a submitted order is reopenable — once stock has moved it must be corrected through receiving.
  const canUnlock = po.status === 'submitted' && po.totalReceived === 0;
  // With no action available, say why rather than leaving an empty toolbar. Once stock
  // has been received the order is history: correcting it has to go through receiving.
  // Admin corrections once goods have moved: amend the order, or send stock back.
  const canAmend = isAdmin && ['submitted', 'partially_received', 'received'].includes(po.status);
  const canReturn = po.totalReceived > 0 && po.status !== 'cancelled';

  const lockedReason =
    isDraft || canUnlock || canAmend || canReturn || po.status === 'cancelled'
      ? null
      : po.totalReceived > 0
        ? `${po.totalReceived} unit${po.totalReceived === 1 ? '' : 's'} received against this order, so it can no longer be edited or deleted. Corrections go through a goods receipt or a return.`
        : 'This order can no longer be edited or deleted.';

  return (
    <div className="w-full">
      <PageHeader
        module="Purchasing"
        moduleHref="/purchase-orders"
        title={po.poNumber}
        // The status chip rides in the toolbar slot: it is the one piece of state that decides
        // which actions are even possible, so it belongs beside them rather than down the page.
        toolbar={
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${STATUS_STYLE[po.status]}`}>
            {STATUS_LABEL[po.status]}
          </span>
        }
        actions={
          <>
            <button
              onClick={async () => {
                setPdfBusy(true);
                try { await purchaseOrdersApi.downloadPdf(po.id, po.poNumber); }
                catch { toast.error('Could not generate the PDF'); }
                finally { setPdfBusy(false); }
              }}
              disabled={pdfBusy}
              title="Download the branded purchase order"
              className="hbtn"
            >
              <FileDown size={15} /> {pdfBusy ? 'Preparing…' : 'Export PDF'}
            </button>
            {/* One contextual secondary at a time — these states are mutually exclusive in
                practice, so the header never grows past two buttons plus the primary. */}
            {canAmend && (
              <button onClick={() => setAmendOpen(true)} title="Change ordered quantities or add items" className="hbtn">
                <SquarePen size={15} /> Amend
              </button>
            )}
            {canReturn && (
              <button onClick={() => setReturnOpen(true)} title="Send received goods back to the vendor" className="hbtn">
                <Undo2 size={15} /> Return to Vendor
              </button>
            )}
            {canUnlock && (
              <button
                onClick={() => setUnlockOpen(true)}
                title={isAdmin ? 'Reopen this order for editing' : 'Ask an admin to reopen this order'}
                className="hbtn"
              >
                <LockOpen size={15} /> {isAdmin ? 'Unlock' : 'Request unlock'}
              </button>
            )}
          </>
        }
        // Destructive and rarely-wanted actions sit behind the ⋯ so they cannot be hit by reflex.
        overflow={[
          ...(isDraft ? [{ label: 'Edit', onClick: () => navigate(`/purchase-orders/${po.id}/edit`) }] : []),
          ...(isDraft ? [{ label: 'Delete', onClick: () => setConfirmDelete(true), danger: true }] : []),
          ...(canCancel && !isDraft ? [{ label: 'Cancel PO', onClick: () => setConfirmCancel(true), danger: true }] : []),
        ]}
        primary={
          isDraft ? (
            <button
              onClick={async () => { if (await confirm({ title: 'Submit this purchase order?', message: 'It locks the order and prepares a goods receipt to receive against.', confirmLabel: 'Submit' })) submit.mutate(); }}
              disabled={submit.isPending}
              className="hbtn-primary"
            >
              <Send size={15} /> Submit
            </button>
          ) : undefined
        }
      />

      {lockedReason && (
        <div className="mb-5 rounded-lg border border-n-200 bg-n-25 px-4 py-3 text-[12.5px] text-n-600">{lockedReason}</div>
      )}

      <div className="grid grid-cols-[1fr_320px] gap-5 max-[900px]:grid-cols-1">
        <div className="flex flex-col gap-5">
          {/* Parties + dates */}
          <div className="card grid grid-cols-2 gap-x-6 gap-y-4 p-5 max-[560px]:grid-cols-1">
            <InfoBlock label="Vendor">
              <div className="text-[14px] font-semibold text-n-900">{po.vendor?.name ?? '—'}</div>
              {po.vendor?.vatNumber && <div className="text-[12px] text-n-500">VAT {po.vendor.vatNumber}</div>}
              {(po.vendor?.addressCity || po.vendor?.addressCountry) && (
                <div className="text-[12px] text-n-500">{[po.vendor?.addressCity, po.vendor?.addressCountry].filter(Boolean).join(', ')}</div>
              )}
              {po.vendor?.email && <div className="text-[12px] text-n-500">{po.vendor.email}</div>}
            </InfoBlock>
            <InfoBlock label="Issuing company">
              <div className="text-[14px] font-semibold text-n-900">{po.company?.officialName ?? '—'}</div>
              {po.company?.registrationNumber && <div className="text-[12px] text-n-500">Reg. {po.company.registrationNumber}</div>}
            </InfoBlock>
            <InfoBlock label="Expected delivery">
              <div className="text-[13px] text-n-700">{po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : '—'}</div>
            </InfoBlock>
            <InfoBlock label="Receive into">
              <div className="text-[13px] text-n-700">{po.destinationWarehouse?.name ?? 'Decide at receiving'}</div>
            </InfoBlock>
          </div>

          {/* Lines */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={`${TH} text-left`}>SKU</th>
                    <th className={`${TH} text-left`}>Product</th>
                    <th className={`${TH} text-right`}>Qty</th>
                    <th className={`${TH} text-right`}>Unit cost</th>
                    <th className={`${TH} text-right`}>VAT</th>
                    <th className={`${TH} text-right`}>Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((l) => (
                    <tr key={l.id} className="hover:bg-n-25">
                      <td className={`${TD} code font-semibold text-n-800`}>{l.sku}</td>
                      <td className={TD}>
                        {l.productName}
                        {l.notes && <div className="text-[11.5px] text-n-400">{l.notes}</div>}
                      </td>
                      <td className={`${TD} mono text-right`}>{l.quantityOrdered}</td>
                      <td className={`${TD} mono text-right`}>{money(l.unitCost, po.currency)}</td>
                      <td className={`${TD} mono text-right text-n-500`}>{l.vatRatePct ? `${l.vatRatePct}%` : '—'}</td>
                      <td className={`${TD} mono text-right font-semibold text-n-800`}>{money(l.lineTotal ?? l.unitCost * l.quantityOrdered, po.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="bg-n-25 px-4 py-3" colSpan={2}>
                      <span className="text-[12.5px] text-n-500">{po.lines.length} line{po.lines.length === 1 ? '' : 's'}</span>
                    </td>
                    <td className="mono border-t border-n-200 bg-n-25 px-4 py-3 text-right text-[13px] font-semibold text-n-700">{po.totalQuantity}</td>
                    <td className="border-t border-n-200 bg-n-25 px-4 py-3" colSpan={2} />
                    <td className="mono border-t border-n-200 bg-n-25 px-4 py-3 text-right text-[13px] font-semibold text-n-700">{money(po.totalNet, po.currency)}</td>
                  </tr>
                  {po.totalVat > 0 && (
                    <tr>
                      <td className="bg-n-25 px-4 py-2 text-right text-[12.5px] text-n-500" colSpan={5}>VAT</td>
                      <td className="mono bg-n-25 px-4 py-2 text-right text-[13px] text-n-700">{money(po.totalVat, po.currency)}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="bg-n-25 px-4 py-3 text-right text-[12.5px] font-semibold text-n-600" colSpan={5}>Total</td>
                    <td className="mono bg-n-25 px-4 py-3 text-right text-[15px] font-bold text-n-900">{money(po.totalGross, po.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Goods sent back against this PO */}
          {!!returns?.rows.length && (
            <div className="card overflow-hidden">
              <div className="border-b border-n-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500">
                Returns to Vendor
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={`${TH} text-left`}>Return</th>
                      <th className={`${TH} text-left`}>Reason</th>
                      <th className={`${TH} text-left`}>Credit note</th>
                      <th className={`${TH} text-right`}>Units</th>
                      <th className={`${TH} text-right`}>Value</th>
                      <th className={`${TH} text-left`}>Posted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returns.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-n-25">
                        <td className={`${TD} code font-semibold text-n-800`}>{r.returnNumber}</td>
                        <td className={TD}>{r.reason}</td>
                        <td className={`${TD} code text-n-500`}>{r.creditNoteRef ?? '—'}</td>
                        <td className={`${TD} mono text-right text-danger`}>−{r.totalQuantity}</td>
                        <td className={`${TD} mono text-right text-n-700`}>{money(r.totalCostEur, 'EUR')}</td>
                        <td className={`${TD} whitespace-nowrap text-n-500`}>{formatDate(r.postedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-n-100 bg-n-25 px-5 py-2.5 text-[11.5px] text-n-500">
                Stock left at its average cost, so the cost of the units still held is unchanged.
              </div>
            </div>
          )}

          {/* Goods receipts raised against this PO (PR10) */}
          {receipts.length > 0 && (
            <div className="card overflow-hidden">
              <div className="border-b border-n-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500">
                Goods receipts
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={`${TH} text-left`}>Receipt</th>
                      <th className={`${TH} text-left`}>Status</th>
                      <th className={`${TH} text-right`}>Expected</th>
                      <th className={`${TH} text-right`}>Received</th>
                      <th className={`${TH} text-left`}>Raised</th>
                      <th className={TH} />
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r) => (
                      <tr key={r.id} className="hover:bg-n-25">
                        <td className={`${TD} code font-semibold text-n-800`}>
                          {r.receiptNumber}
                          {r.isBackorder && <span className="ml-2 rounded bg-warning-bg px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-warning">Backorder</span>}
                        </td>
                        <td className={TD}>
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${
                            r.status === 'posted' ? 'border-teal-300 bg-teal-50 text-teal-700'
                              : r.status === 'cancelled' ? 'border-danger-bd bg-danger-bg text-danger'
                              : 'border-info-bd bg-info-bg text-info'}`}>
                            {r.status === 'pending' ? 'Pending' : r.status === 'posted' ? 'Posted' : 'Cancelled'}
                          </span>
                        </td>
                        <td className={`${TD} mono text-right`}>{r.expectedQuantity}</td>
                        <td className={`${TD} mono text-right`}>{r.receivedQuantity || <span className="text-n-300">—</span>}</td>
                        <td className={`${TD} whitespace-nowrap text-n-500`}>{formatDate(r.createdAt)}</td>
                        <td className={`${TD} text-right`}>
                          {r.status === 'pending' && (
                            <button
                              onClick={() => setReceiving(r.id)}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-teal-500 px-2.5 text-[12px] font-semibold text-white hover:bg-teal-600"
                            >
                              <PackageCheck size={13} /> Receive
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {po.notes && (
            <div className="card p-5">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-n-500">Notes</div>
              <p className="whitespace-pre-wrap text-[13px] text-n-700">{po.notes}</p>
            </div>
          )}
        </div>

        {/* Status history */}
        <div className="card h-fit p-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-n-500">Status history</div>
          <ol className="flex flex-col gap-3">
            {po.statusHistory.map((e, i) => (
              <li key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${i === po.statusHistory.length - 1 ? 'bg-teal-500' : 'bg-n-300'}`} />
                  {i < po.statusHistory.length - 1 && <span className="w-px flex-1 bg-n-200" />}
                </div>
                <div className="pb-1">
                  <div className="text-[13px] font-semibold text-n-800">{STATUS_LABEL[e.status as PurchaseOrderStatus] ?? e.status}</div>
                  {e.note && <div className="text-[12px] text-n-500">{e.note}</div>}
                  <div className="mono text-[11px] text-n-400">{formatDate(e.at)}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {confirmCancel && (
        <ModalShell
          open
          title="Cancel Purchase Order"
          subtitle={po.poNumber}
          dirty={!!cancelReason}
          primaryLabel={cancel.isPending ? 'Cancelling…' : 'Cancel purchase order'}
          onPrimary={() => cancel.mutate()}
          busy={cancel.isPending}
          onClose={() => setConfirmCancel(false)}
        >
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-n-700">This marks {po.poNumber} as cancelled. It can’t be un-cancelled — you’d raise a new PO instead.</p>
            <div>
              <label className="label">Reason <span className="font-normal text-n-400">(optional)</span></label>
              <input className="input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. vendor out of stock" />
            </div>
          </div>
        </ModalShell>
      )}
      {unlockOpen && (
        <ModalShell
          open
          title={isAdmin ? 'Unlock purchase order' : 'Request unlock'}
          subtitle={po.poNumber}
          dirty={!!unlockNote}
          primaryLabel={unlock.isPending ? 'Working…' : isAdmin ? 'Unlock for editing' : 'Send request'}
          onPrimary={() => unlock.mutate()}
          busy={unlock.isPending}
          onClose={() => setUnlockOpen(false)}
        >
          <div className="flex flex-col gap-3">
            {isAdmin ? (
              <p className="text-[13px] text-n-700">
                {po.poNumber} goes back to <strong>draft</strong> so it can be edited. The goods receipt waiting on it is voided —
                submitting again raises a fresh one with a new receipt number.
              </p>
            ) : (
              <p className="text-[13px] text-n-700">
                Only an admin can reopen a submitted order. This sends them a request; {po.poNumber} stays locked until one approves it.
              </p>
            )}
            <div>
              <label className="label">
                {isAdmin ? 'Note' : 'Reason'} <span className="font-normal text-n-400">(optional)</span>
              </label>
              <input
                className="input"
                value={unlockNote}
                onChange={(e) => setUnlockNote(e.target.value)}
                placeholder={isAdmin ? 'Recorded in the status history' : 'e.g. wrong quantity on line 2'}
              />
            </div>
          </div>
        </ModalShell>
      )}
      {amendOpen && (
        <AmendOrderModal po={po} onClose={() => setAmendOpen(false)} onDone={() => { setAmendOpen(false); refresh(); }} />
      )}
      {returnOpen && po.vendor && (
        <ReturnToVendorModal
          purchaseOrderId={po.id}
          poNumber={po.poNumber}
          vendorId={po.vendor.id}
          onClose={() => setReturnOpen(false)}
          onPosted={() => { setReturnOpen(false); refresh(); }}
        />
      )}
      {receiving && (
        <ReceiveModal receiptId={receiving} onClose={() => setReceiving(null)} onPosted={() => { setReceiving(null); refresh(); }} />
      )}
      {confirmDelete && (
        <ModalShell
          open
          title="Delete Draft"
          subtitle={po.poNumber}
          primaryLabel={del.isPending ? 'Deleting…' : 'Delete draft'}
          onPrimary={() => del.mutate()}
          busy={del.isPending}
          onClose={() => setConfirmDelete(false)}
        >
          <p className="text-[13px] text-n-700">Delete draft {po.poNumber}? This can’t be undone. Only drafts can be deleted — submitted POs are cancelled instead, keeping the audit trail.</p>
        </ModalShell>
      )}
    </div>
  );
}

const TH = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
const TD = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-n-500">{label}</div>
      {children}
    </div>
  );
}

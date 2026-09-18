import { useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { customerShipmentsApi, type CustomerShipmentBooking } from '../../lib/api';

/**
 * The labels and invoices kept for a shipment's FedEx bookings, ready to print.
 *
 * Every booking is listed, cancelled and sandbox ones included and marked as such, because a label
 * printed from the wrong one is a parcel with somebody else's tracking number on it. The live
 * production booking is the one without a mark.
 */
export function BookingDocuments({ bookings, reference }: { bookings: CustomerShipmentBooking[]; reference: string }) {
  const [opening, setOpening] = useState<string | null>(null);
  if (bookings.length === 0) return null;

  const open = async (bookingId: string, doc: CustomerShipmentBooking['documents'][number]) => {
    setOpening(doc.id);
    try {
      await customerShipmentsApi.openBookingDocument(bookingId, doc, reference);
    } catch (e: any) {
      toast.error(e?.response?.status === 404 ? 'That document is no longer available.' : 'Could not open the document.');
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {bookings.map((b) => {
        const sandbox = b.environment !== 'production';
        const cancelled = b.status === 'cancelled';
        return (
          <div key={b.id} className={`rounded-md border p-2.5 text-[12.5px] ${sandbox || cancelled ? 'border-n-100 bg-n-25' : 'border-teal-100 bg-teal-50/40'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-n-800">FedEx</span>
              <span className="mono text-n-700">{b.masterTrackingNumber ?? 'no tracking number read'}</span>
              <span className="text-n-500">{b.serviceName ?? b.serviceType}</span>
              {sandbox && <span className="tag border border-orange-200 bg-orange-50 text-orange-800">Sandbox — test only</span>}
              {cancelled && <span className="tag bg-n-100 text-n-600">Cancelled</span>}
              <div className="flex-1" />
              <span className="text-[11.5px] text-n-500">{new Date(b.createdAt).toLocaleString()}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {b.documents.length === 0 && <span className="text-n-500">No documents were kept from FedEx’s reply.</span>}
              {b.documents.map((d) => {
                const label = d.kind === 'LABEL'
                  ? `Label${b.documents.filter((x) => x.kind === 'LABEL').length > 1 && d.pieceIndex != null ? ` ${d.pieceIndex + 1}` : ''}`
                  : d.kind === 'COMMERCIAL_INVOICE' ? 'Commercial invoice' : 'Document';
                return (
                  <button
                    key={d.id}
                    type="button"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:bg-n-50 disabled:opacity-50"
                    disabled={opening === d.id}
                    onClick={() => open(b.id, d)}
                    title={`${d.docType ?? 'PDF'} · ${(d.sizeBytes / 1024).toFixed(1)} kB`}
                  >
                    {d.kind === 'LABEL' ? <Printer size={13} /> : <FileText size={13} />}
                    {label}
                    <span className="font-normal text-n-500">{d.docType === 'ZPLII' ? 'ZPL' : d.docType ?? 'PDF'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A shipment's FedEx labels and invoice, on their own — for reprinting from a list. */
export function LabelsModal({ bookings, reference, onClose }: { bookings: CustomerShipmentBooking[]; reference: string; onClose: () => void }) {
  return (
    <ModalShell open title={`Labels — ${reference}`} primaryLabel="Close" onPrimary={onClose} onClose={onClose} initialSize={{ w: 720, h: 420 }}>
      <div className="p-1">
        <BookingDocuments bookings={bookings} reference={reference} />
      </div>
    </ModalShell>
  );
}

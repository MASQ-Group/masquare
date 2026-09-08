import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { carriersApi, type CarrierAccount } from '../../lib/api';

interface Props {
  account: CarrierAccount;
  onClose: () => void;
}

/**
 * Make one booking on sandbox and show the reply, so the response can be mapped.
 *
 * FedEx ships 1,335 sample Ship requests and no sample responses. The shape of a booking reply —
 * where the tracking number sits, how the label is encoded — cannot be known without making one,
 * and learning it on production would mean a real label and a real charge.
 *
 * The API refuses production outright, so this cannot create a billable shipment however it is
 * called. It also writes no record: a sandbox booking is not a shipment, and a fictitious one
 * sitting among real ones is worse than none.
 */
export function TestBookingModal({ account, onClose }: Props) {
  // FedEx's sandbox only knows the lanes in its own sample data. A Cyprus origin is refused there
  // even with the correct test account, so this defaults to the US→CA lane their samples use.
  const [postalCode, setPostalCode] = useState('M4B 1B4');
  const [countryIso, setCountryIso] = useState('CA');
  const [serviceType, setServiceType] = useState('FEDEX_INTERNATIONAL_PRIORITY');
  const [weightKg, setWeightKg] = useState('2');
  const [dutiesPaidBy, setDutiesPaidBy] = useState<'sender' | 'recipient'>('recipient');
  const [labelImageType, setLabelImageType] = useState<'PDF' | 'ZPLII'>('PDF');

  const today = new Date();
  const [shipDate, setShipDate] = useState(new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10));

  const book = useMutation({
    mutationFn: () =>
      carriersApi.testBook(account.id, {
        recipient: {
          personName: 'Test Recipient',
          streetLines: ['100 Queen Street'],
          city: 'Toronto',
          stateOrProvinceCode: countryIso === 'CA' ? 'ON' : null,
          postalCode: postalCode.trim(),
          countryIso: countryIso.trim().toUpperCase(),
          phone: '4165551234',
        },
        serviceType,
        shipDate,
        parcels: [{ weightKg: Number(weightKg) || 1 }],
        dutiesPaidBy,
        labelImageType,
      }),
    onSuccess: (r) => {
      if (r.ok) toast.success('Sandbox booking made — the reply is below');
      else toast.error(`FedEx returned ${r.status}`, { duration: 8000 });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not reach FedEx'),
  });

  const busy = book.isPending;
  const result = book.data;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-[860px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">Test a booking (sandbox)</h2>
          <p className="mt-0.5 text-[12.5px] text-n-500">{account.name} · account <span className="mono">{account.accountNumber}</span></p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 flex items-start gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-[12.5px] text-teal-900">
            <ShieldCheck size={14} className="mt-[2px] shrink-0" />
            <span>
              Sandbox only, and refused on production by the API itself rather than by this screen.
              Nothing is recorded — this exists to learn the shape of a booking reply without creating
              a real label or a real charge. Ships from FedEx's own sample US origin, because their
              sandbox does not recognise a Cyprus one.
            </span>
          </p>

          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="label">Deliver to — postcode</label>
              <input className="input mono" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
            <div>
              <label className="label">Country</label>
              <input className="input mono uppercase" maxLength={2} value={countryIso} onChange={(e) => setCountryIso(e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className="label">Weight (kg)</label>
              <input className="input mono" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="label">Service</label>
              <input className="input mono" value={serviceType} onChange={(e) => setServiceType(e.target.value)} />
            </div>
            <div>
              <label className="label">Ship date</label>
              <input className="input mono" type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Label format</label>
              <Select
                value={labelImageType}
                onChange={(v) => setLabelImageType(v as 'PDF' | 'ZPLII')}
                options={[{ value: 'PDF', label: 'PDF (laser)' }, { value: 'ZPLII', label: 'ZPL II (thermal)' }]}
              />
            </div>
          </div>

          <div className="mt-3 w-1/2 pr-1.5">
            <label className="label">Duties and taxes paid by</label>
            {/* No default worth the name: this is the decision the whole rules idea exists to stop
                people skipping, so it is asked here too rather than assumed. */}
            <Select
              value={dutiesPaidBy}
              onChange={(v) => setDutiesPaidBy(v as 'sender' | 'recipient')}
              options={[
                { value: 'recipient', label: 'Recipient — billed at delivery (DAP)' },
                { value: 'sender', label: 'Us — duty paid (DDP)' },
              ]}
            />
          </div>

          {result && (
            <div className="mt-4 border-t border-n-100 pt-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className={`tag border ${result.ok ? 'border-teal-100 bg-teal-50 text-teal-700' : 'border-orange-200 bg-orange-50 text-orange-800'}`}>
                  HTTP {result.status}
                </span>
                <span className="text-n-500">{result.customs ? 'customs declaration included' : 'no customs declaration'}</span>
              </div>

              {!result.ok && result.message && (
                <p className="mb-3 whitespace-pre-line rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5 text-[12.5px] leading-[1.55] text-orange-900">
                  {result.message}
                </p>
              )}

              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-n-500">What we sent</div>
              <pre className="max-h-[220px] overflow-auto rounded-md border border-n-200 bg-n-25 p-3 text-[11.5px] leading-[1.5] text-n-700">
                {JSON.stringify(result.request, null, 2)}
              </pre>

              <div className="mb-2 mt-3 text-[12px] font-semibold uppercase tracking-wide text-n-500">What FedEx replied</div>
              <pre className="max-h-[360px] overflow-auto rounded-md border border-n-200 bg-n-25 p-3 text-[11.5px] leading-[1.5] text-n-700">
                {typeof result.response === 'string' ? result.response : JSON.stringify(result.response, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-n-200 px-5 py-3.5">
          <button className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50" onClick={() => !busy && onClose()}>Close</button>
          <button
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            disabled={busy}
            onClick={() => book.mutate()}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Booking…' : 'Make a sandbox booking'}
          </button>
        </div>
      </div>
    </div>
  );
}

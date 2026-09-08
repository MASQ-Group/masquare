import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { carriersApi, type CarrierAccount } from '../../lib/api';

interface Props {
  account: CarrierAccount;
  onClose: () => void;
}

/**
 * Ask FedEx what a shipment would cost, and show the reply exactly as it arrived.
 *
 * A diagnostic, not a feature — for now. FedEx publishes sample rate REQUESTS but no sample
 * responses (the sandbox generates those when a request is run), so nobody here has yet seen the
 * shape of a reply. Mapping one blind would mean inventing field names and rewriting them the day a
 * real response turned up, so this fetches a real one instead.
 *
 * It also does something the connection test cannot: a rate request is the first call that uses the
 * account NUMBER, so it is what confirms that figure is right.
 */
export function RateQuoteModal({ account, onClose }: Props) {
  const [postalCode, setPostalCode] = useState('LS1 1AA');
  const [countryIso, setCountryIso] = useState('GB');
  const [weightKg, setWeightKg] = useState('2');
  const [lengthCm, setLengthCm] = useState('30');
  const [widthCm, setWidthCm] = useState('20');
  const [heightCm, setHeightCm] = useState('15');
  const [value, setValue] = useState('100');

  const quote = useMutation({
    mutationFn: () =>
      carriersApi.rateQuote(account.id, {
        recipient: { postalCode: postalCode.trim(), countryIso: countryIso.trim().toUpperCase() },
        parcels: [{
          weightKg: Number(weightKg),
          lengthCm: Number(lengthCm) || null,
          widthCm: Number(widthCm) || null,
          heightCm: Number(heightCm) || null,
        }],
        customsValue: { amount: Number(value) || 0, currency: 'EUR' },
        goodsDescription: 'Consumer goods',
      }),
    onSuccess: (r) => {
      if (r.ok) toast.success('FedEx answered — the reply is below');
      else toast.error(`FedEx returned ${r.status}`, { duration: 8000 });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not reach FedEx'),
  });

  const busy = quote.isPending;
  const result = quote.data;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-[820px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">Test a rate quote</h2>
          <p className="mt-0.5 text-[12.5px] text-n-500">
            {account.name} · {account.environment === 'production' ? 'Production' : 'Sandbox'} · account{' '}
            <span className="mono">{account.accountNumber}</span>
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {account.environment === 'sandbox' && (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              Sandbox is virtualised: it answers with canned data regardless of what is sent. That is
              enough to learn the shape of a reply and to prove our request is accepted, but the
              prices it returns are not ours and the account number is not really being checked.
            </p>
          )}

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
              <input className="input mono" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-3">
            <div><label className="label">Length (cm)</label><input className="input mono" value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} /></div>
            <div><label className="label">Width (cm)</label><input className="input mono" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} /></div>
            <div><label className="label">Height (cm)</label><input className="input mono" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} /></div>
            <div><label className="label">Value (€)</label><input className="input mono" value={value} onChange={(e) => setValue(e.target.value)} /></div>
          </div>

          <p className="mt-2 text-[12px] text-n-500">
            The ship-from address comes from this account, or from its company where the account has
            none. No service is named, so FedEx returns every service that runs on the lane.
          </p>

          {result && (
            <div className="mt-4 border-t border-n-100 pt-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className={`tag border ${result.ok ? 'border-teal-100 bg-teal-50 text-teal-700' : 'border-orange-200 bg-orange-50 text-orange-800'}`}>
                  HTTP {result.status}
                </span>
                <span className="text-n-500">
                  Origin from {result.origin === 'account' ? 'this account' : 'the company address'} ·{' '}
                  {result.customs ? 'customs declaration included' : 'no customs declaration (same customs area)'}
                </span>
              </div>

              {/*
                What the failure actually means, above the raw reply.

                FedEx answers a refused rate request with "We could not authenticate your
                credentials", which is misleading: a token had to be minted before this call could
                be made at all. Left unexplained it sends somebody to replace a working key.
              */}
              {!result.ok && result.message && (
                <p className="mb-3 whitespace-pre-line rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5 text-[12.5px] leading-[1.55] text-orange-900">
                  {result.message}
                </p>
              )}

              {/* Both halves. A rejection can only be read against what was actually sent. */}
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-n-500">What we sent</div>
              <pre className="max-h-[200px] overflow-auto rounded-md border border-n-200 bg-n-25 p-3 text-[11.5px] leading-[1.5] text-n-700">
                {JSON.stringify(result.request, null, 2)}
              </pre>

              <div className="mb-2 mt-3 text-[12px] font-semibold uppercase tracking-wide text-n-500">What FedEx replied</div>
              <pre className="max-h-[320px] overflow-auto rounded-md border border-n-200 bg-n-25 p-3 text-[11.5px] leading-[1.5] text-n-700">
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
            onClick={() => quote.mutate()}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Asking FedEx…' : 'Get a quote'}
          </button>
        </div>
      </div>
    </div>
  );
}

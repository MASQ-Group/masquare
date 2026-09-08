import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Plug, Plus, Truck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { carriersApi, type CarrierAccount } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { CarrierAccountModal } from '../components/carriers/CarrierAccountModal';
import { RateQuoteModal } from '../components/carriers/RateQuoteModal';

const CARRIER_LABEL: Record<string, string> = { fedex: 'FedEx' };

/**
 * Carrier accounts — FedEx today, whatever follows later.
 *
 * A page of its own rather than a tab on Marketplace integrations, for the same reason the model is
 * separate: a courier has an account number that gets billed and an address shipments leave from,
 * and none of the marketplace furniture — sync cursors, mapping verification, listing previews —
 * means anything here.
 */
export function CarriersPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<CarrierAccount | null | undefined>(undefined);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [quoteFor, setQuoteFor] = useState<CarrierAccount | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['carrier-accounts'],
    queryFn: () => carriersApi.list(),
  });

  const test = useMutation({
    mutationFn: (id: string) => carriersApi.test(id),
    onMutate: (id) => setTestingId(id),
    onSettled: () => setTestingId(null),
    onSuccess: (r) => {
      // The message is the finding, not a generic outcome — a rejected key and a throttle need
      // opposite responses from whoever pressed the button.
      if (r.ok) toast.success(r.message);
      else toast.error(r.message, { duration: 10_000 });
      qc.invalidateQueries({ queryKey: ['carrier-accounts'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not reach FedEx'),
  });

  const active = accounts.filter((a) => a.isActive).length;

  return (
    <div className="w-full">
      <PageHeader
        module="Setup"
        title="Carrier accounts"
        info="Courier accounts used to quote rates and, once certified, to produce labels. API keys are encrypted and never leave the platform."
        summary={`${accounts.length} account${accounts.length === 1 ? '' : 's'}${accounts.length ? ` · ${active} connected` : ''}`}
        primary={<button className="hbtn-primary" onClick={() => setModal(null)}><Plus size={16} /> Add<span className="max-[767px]:hidden"> account</span></button>}
      />

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading…</div>}

      {!isLoading && accounts.length === 0 && (
        <div className="card mt-6 flex flex-col items-center gap-3 py-14 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-n-100 text-n-400"><Truck size={22} /></div>
          <div className="text-[14px] font-medium text-n-700">No carrier accounts yet</div>
          <p className="max-w-sm text-[12.5px] text-n-500">
            Add the FedEx account and its API key. Start on sandbox — production credentials only
            produce labels after FedEx has certified our printed output.
          </p>
          <button className="btn btn-ghost" onClick={() => setModal(null)}><Plus size={16} /> Add account</button>
        </div>
      )}

      {!isLoading && accounts.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {accounts.map((a) => (
            <div key={a.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14.5px] font-semibold text-n-900">{a.name}</span>
                    <span className="tag border border-n-200 bg-n-50 text-n-600">{CARRIER_LABEL[a.carrier] ?? a.carrier}</span>
                    {/* Sandbox is called out rather than only production, because the dangerous
                        mistake is believing a sandbox account is live. */}
                    <span className={`tag border ${a.environment === 'production' ? 'border-teal-100 bg-teal-50 text-teal-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                      {a.environment === 'production' ? 'Production' : 'Sandbox'}
                    </span>
                    {a.isActive
                      ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-700"><CheckCircle2 size={13} /> Connected</span>
                      : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-n-400"><XCircle size={13} /> Not connected</span>}
                  </div>
                  <div className="mt-1 text-[12.5px] text-n-500">
                    Account <span className="mono text-n-700">{a.accountNumber}</span>
                    {a.companyName ? <> · {a.companyName}</> : null}
                  </div>
                  {/* Which keys are stored, by their last four. Never the values. */}
                  {a.secrets.length > 0 && (
                    <div className="mt-1 text-[12px] text-n-400">
                      {a.secrets.map((s) => `${s.fieldKey === 'apiKey' ? 'API key' : 'Secret key'} ••••${s.last4}`).join(' · ')}
                    </div>
                  )}
                  {a.lastTestedAt && (
                    /* The last test, kept on screen. A credential that stopped working three weeks
                       ago should be visible now, not at the moment somebody needs a label. */
                    <p className={`mt-2 max-w-2xl text-[12px] ${a.lastTestOk ? 'text-n-500' : 'text-danger'}`}>
                      {a.lastTestOk ? 'Last tested' : 'Failed'} {new Date(a.lastTestedAt).toLocaleString()}
                      {a.lastTestNote ? ` — ${a.lastTestNote}` : ''}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
                    disabled={testingId === a.id || a.secrets.length < 2}
                    title={a.secrets.length < 2 ? 'Enter both the API key and the secret key first' : 'Authenticate with FedEx using the stored keys'}
                    onClick={() => test.mutate(a.id)}
                  >
                    {testingId === a.id ? <><Loader2 size={14} className="animate-spin" /> Testing…</> : <><Plug size={14} /> Test connection</>}
                  </button>
                  {/* Only once the account authenticates. A quote needs a token, and offering it
                      before the connection works produces a confusing failure. */}
                  {a.isActive && (
                    <button
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700"
                      title="Ask FedEx what a shipment would cost — the first call that actually uses the account number"
                      onClick={() => setQuoteFor(a)}
                    >
                      Test a rate quote
                    </button>
                  )}
                  <button className="btn btn-ghost h-9" onClick={() => setModal(a)}>Edit</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {accounts.length > 0 && (
        <p className="mt-4 max-w-3xl text-[12px] text-n-400">
          Testing authenticates with FedEx and nothing more. It confirms the key, the secret and the
          environment agree — it cannot confirm the account number, which only a rate request will.
          FedEx throttles the token endpoint hard and blocks repeat offenders for ten minutes, so
          please do not press it repeatedly if it fails.
        </p>
      )}

      {quoteFor && <RateQuoteModal account={quoteFor} onClose={() => setQuoteFor(null)} />}

      {modal !== undefined && (
        <CarrierAccountModal
          account={modal}
          onClose={() => setModal(undefined)}
          onSaved={() => { setModal(undefined); qc.invalidateQueries({ queryKey: ['carrier-accounts'] }); }}
        />
      )}
    </div>
  );
}

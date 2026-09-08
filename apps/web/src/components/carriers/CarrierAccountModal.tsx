import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { carriersApi, companiesApi, type CarrierAccount } from '../../lib/api';

interface Props {
  /** An existing account to edit, or null to add one. */
  account: CarrierAccount | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Add or edit a carrier account.
 *
 * Secrets are write-only: what is stored never comes back to the browser, so the key boxes start
 * empty on an edit and an empty box means "leave it as it was" rather than "erase it". The card
 * behind this modal shows the last four characters, which is enough to tell which key is in there.
 */
export function CarrierAccountModal({ account, onClose, onSaved }: Props) {
  const editing = !!account;
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() });

  const [name, setName] = useState(account?.name ?? '');
  const [companyId, setCompanyId] = useState(account?.companyId ?? '');
  const [accountNumber, setAccountNumber] = useState(account?.accountNumber ?? '');
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>(account?.environment ?? 'sandbox');
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');

  const o = account?.origin;
  const [line1, setLine1] = useState(o?.line1 ?? '');
  const [line2, setLine2] = useState(o?.line2 ?? '');
  const [city, setCity] = useState(o?.city ?? '');
  const [region, setRegion] = useState(o?.region ?? '');
  const [postalCode, setPostalCode] = useState(o?.postalCode ?? '');
  const [countryIso, setCountryIso] = useState(o?.countryIso ?? '');
  const [phone, setPhone] = useState(o?.phone ?? '');

  const save = useMutation({
    mutationFn: (body: any) => (editing ? carriersApi.update(account!.id, body) : carriersApi.create(body)),
    onSuccess: () => {
      toast.success(editing ? 'Carrier account updated' : 'Carrier account added — test the connection next');
      onSaved();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const busy = save.isPending;
  /** Changing either invalidates the stored test result, so the modal says so before it happens. */
  const credentialsChanged = apiKey.trim() !== '' || secretKey.trim() !== '' || (editing && environment !== account!.environment);

  const submit = () => {
    if (!name.trim()) { toast.error('Give the account a name'); return; }
    if (!companyId) { toast.error('Choose the company this account belongs to'); return; }
    if (!accountNumber.trim()) { toast.error('Enter the FedEx account number'); return; }
    if (!editing && (!apiKey.trim() || !secretKey.trim())) {
      toast.error('Both the API key and the secret key are needed to connect');
      return;
    }
    save.mutate({
      name, companyId, accountNumber, environment,
      carrier: 'fedex',
      originLine1: line1, originLine2: line2, originCity: city, originRegion: region,
      originPostalCode: postalCode, originCountryIso: countryIso, originPhone: phone,
      // Blank means unchanged. Only what was typed is sent.
      secrets: { ...(apiKey.trim() ? { apiKey } : {}), ...(secretKey.trim() ? { secretKey } : {}) },
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-[620px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">{editing ? 'Edit carrier account' : 'Add carrier account'}</h2>
          <p className="mt-0.5 text-[12.5px] text-n-500">
            FedEx. The keys are encrypted before they are stored and are never sent back to this screen.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="FedEx CY main" />
            </div>
            <div>
              <label className="label">Company</label>
              {/* Which company gets billed. A shipment on the wrong account is a real invoice to
                  unpick afterwards, so this is required rather than defaulted. */}
              <Select
                value={companyId}
                onChange={setCompanyId}
                placeholder="— choose —"
                options={companies.map((c) => ({ value: c.id, label: c.officialName }))}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">FedEx account number</label>
              <input className="input mono" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="000000000" />
            </div>
            <div>
              <label className="label">Environment</label>
              <Select
                value={environment}
                onChange={(v) => setEnvironment(v as 'sandbox' | 'production')}
                options={[{ value: 'sandbox', label: 'Sandbox' }, { value: 'production', label: 'Production' }]}
              />
            </div>
          </div>
          <p className="mt-1.5 text-[12px] text-n-500">
            Sandbox and production have different hosts <em>and</em> different credentials — a sandbox
            key sent to production is rejected exactly like a wrong key. Keep them as separate accounts.
          </p>

          <div className="mt-4 border-t border-n-100 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">API key</label>
                <input
                  className="input mono" type="password" autoComplete="off"
                  value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder={editing ? 'Leave blank to keep the stored key' : ''}
                />
              </div>
              <div>
                <label className="label">Secret key</label>
                <input
                  className="input mono" type="password" autoComplete="off"
                  value={secretKey} onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={editing ? 'Leave blank to keep the stored key' : ''}
                />
              </div>
            </div>
            {editing && (
              <p className="mt-1.5 text-[12px] text-n-400">
                Blank leaves the stored key untouched. There is no way to read one back — replace it
                if it is wrong.
              </p>
            )}
          </div>

          <div className="mt-4 border-t border-n-100 pt-4">
            <div className="mb-2 text-[12.5px] font-semibold text-n-700">Ship-from address</div>
            <p className="mb-3 text-[12px] text-n-500">
              Optional. Left blank, shipments quote and ship from the company's own address. Fill it
              in only if this account ships from somewhere else — a rate cannot be quoted without an
              origin, so this is asked once here rather than on every shipment.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Address line 1</label><input className="input" value={line1} onChange={(e) => setLine1(e.target.value)} /></div>
              <div><label className="label">Address line 2</label><input className="input" value={line2} onChange={(e) => setLine2(e.target.value)} /></div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-3">
              <div><label className="label">City</label><input className="input" value={city} onChange={(e) => setCity(e.target.value)} /></div>
              <div><label className="label">Region</label><input className="input" value={region} onChange={(e) => setRegion(e.target.value)} /></div>
              <div><label className="label">Postcode</label><input className="input mono" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} /></div>
              <div>
                <label className="label">Country</label>
                <input className="input mono uppercase" maxLength={2} value={countryIso} onChange={(e) => setCountryIso(e.target.value.toUpperCase())} placeholder="CY" />
              </div>
            </div>
            <div className="mt-3 w-1/2 pr-1.5">
              <label className="label">Phone</label>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+357…" />
            </div>
          </div>

          {editing && credentialsChanged && (
            /* Said before saving, not discovered after. The stored "connected" describes the
               credentials that were tested; changing either makes it a claim about nothing. */
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              Changing the keys or the environment clears the connection test and switches the
              account off until it has been tested again — the green tick describes credentials
              somebody watched work, and these will not be those.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-n-200 px-5 py-3.5">
          <button className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50" onClick={() => !busy && onClose()}>Cancel</button>
          <button
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            disabled={busy}
            onClick={submit}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add account'}
          </button>
        </div>
      </div>
    </div>
  );
}

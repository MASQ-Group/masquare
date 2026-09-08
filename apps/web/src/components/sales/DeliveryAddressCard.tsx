import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin, Pencil, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { salesTransactionsApi, type DeliveryAddress, type DeliveryAddressView } from '../../lib/api';

/** Field labels, so a gap is named in the words on the form rather than in a property name. */
const LABELS: Record<string, string> = {
  fullName: 'Name',
  addressLine1: 'Address',
  city: 'City',
  postalCode: 'Postcode',
  countryIso: 'Country',
};

/**
 * Said before erasing, because the one-way part is the part people get wrong.
 *
 * Somebody who has watched a sync repopulate a field reasonably assumes this one will too. It will
 * not: a purged row is barred to the automatic route permanently, and only typing brings it back.
 */
const ERASE_WARNING = [
  'Erase this delivery address now?',
  '',
  'The name, address and contact details are emptied immediately rather than at the end of the retention period.',
  'Syncing the order again will not bring them back — only typing them in will.',
].join('\n');

type Form = Partial<Omit<DeliveryAddress, 'source' | 'channelSyncedAt' | 'editedAt' | 'editedBy'>>;

const blank: Form = {
  fullName: '', companyName: '', addressLine1: '', addressLine2: '', city: '',
  stateOrRegion: '', postalCode: '', countryIso: '', phone: '', email: '',
  eori: '', vatNumber: '', isBusiness: null,
};

/**
 * The delivery address on an order.
 *
 * Nothing reads this yet — it exists because a carrier label cannot be produced without it, and the
 * addresses have to start accumulating before the carrier work begins rather than after. eBay and
 * OnBuy fill it in on their own; Amazon orders are typed here from Seller Central, because buyer
 * addresses there are restricted data we hold no approval to pull.
 */
export function DeliveryAddressCard({ transactionId }: { transactionId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const q = useQuery({
    queryKey: ['delivery-address', transactionId],
    queryFn: () => salesTransactionsApi.deliveryAddress(transactionId),
    enabled: !!transactionId,
  });

  const erase = useMutation({
    mutationFn: () => salesTransactionsApi.eraseDeliveryAddress(transactionId),
    onSuccess: (r) => {
      toast.success(r.alreadyErased ? 'Already erased' : 'Delivery address erased');
      qc.invalidateQueries({ queryKey: ['delivery-address', transactionId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not erase'),
  });

  if (q.isLoading) {
    return (
      <div className="card overflow-hidden p-0">
        <div className="border-b border-n-100 px-5 py-4 text-[12px] font-bold uppercase tracking-wide text-n-500">Delivery address</div>
        <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-n-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      </div>
    );
  }
  if (!q.data) return null;

  const view = q.data;
  const a = view.address;
  const missing = view.missing;
  const purged = !!view.purgedAt;

  return (
    <>
      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-n-100 px-5 py-4">
          <span className="text-[12px] font-bold uppercase tracking-wide text-n-500">Delivery address</span>
          <div className="flex items-center gap-3">
            {/* Erasing is offered only where there is something to erase. It is not reversible by
                any sync afterwards, so it asks first. */}
            {a && !purged && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-n-500 hover:text-danger disabled:opacity-50"
                disabled={erase.isPending}
                onClick={() => { if (confirm(ERASE_WARNING)) erase.mutate(); }}
              >
                <Trash2 size={13} /> Erase
              </button>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-teal-700 hover:underline"
              onClick={() => setEditing(true)}
            >
              <Pencil size={13} /> {a ? 'Edit' : purged ? 'Re-enter' : 'Add'}
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {purged && (
            /* Erased is a different fact from never held, and the card says which. Without this the
               row would read as an order nobody ever filled in. */
            <p className="flex items-start gap-1.5 text-[12.5px] text-n-500">
              <ShieldCheck size={13} className="mt-[2px] shrink-0 text-teal-600" />
              <span>
                Erased on {new Date(view.purgedAt!).toLocaleDateString()} under the {Math.round(view.retentionDays / 30)}-month
                retention policy. Re-enter it by hand if a late return or a carrier claim needs one —
                syncing the order will not bring it back.
              </span>
            </p>
          )}

          {!a && !purged && (
            <p className="text-[12.5px] text-n-500">
              {view.canPullFromChannel
                ? `Nothing held yet. ${view.channel === 'ebay' ? 'eBay' : 'OnBuy'} supplies this on the next sync of the order, or add it by hand.`
                : 'Nothing held yet. Amazon does not release buyer addresses to us, so this one is copied from Seller Central by hand.'}
            </p>
          )}

          {a && (
            <>
              <address className="not-italic text-[13px] leading-[1.55] text-n-800">
                {a.fullName && <div className="font-semibold">{a.fullName}</div>}
                {a.companyName && <div>{a.companyName}</div>}
                {a.addressLine1 && <div>{a.addressLine1}</div>}
                {a.addressLine2 && <div>{a.addressLine2}</div>}
                <div>{[a.postalCode, a.city].filter(Boolean).join(' ')}{a.stateOrRegion ? `, ${a.stateOrRegion}` : ''}</div>
                {a.countryIso && <div className="mono">{a.countryIso}</div>}
              </address>
              {(a.phone || a.email) && (
                <div className="mt-2 text-[12.5px] text-n-500">
                  {a.phone && <div>{a.phone}</div>}
                  {a.email && <div className="truncate">{a.email}</div>}
                </div>
              )}
              {(a.eori || a.vatNumber) && (
                <div className="mt-2 text-[12px] text-n-500">
                  {a.eori && <div>EORI <span className="mono text-n-700">{a.eori}</span></div>}
                  {a.vatNumber && <div>VAT <span className="mono text-n-700">{a.vatNumber}</span></div>}
                </div>
              )}
            </>
          )}

          {/* What is still missing, named. "Incomplete" on its own sends somebody hunting. */}
          {missing.length > 0 && a && (
            <p className="mt-3 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
              <TriangleAlert size={13} className="mt-[2px] shrink-0" />
              <span>A carrier would refuse this — still needed: {missing.map((m) => LABELS[m] ?? m).join(', ')}.</span>
            </p>
          )}

          {a && (
            /* Where these words came from. A channel-supplied address and one somebody typed carry
               different weight when the parcel goes missing. */
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-n-400">
              <MapPin size={12} className="shrink-0" />
              {a.source === 'channel'
                ? `From ${view.channel === 'ebay' ? 'eBay' : view.channel === 'onbuy' ? 'OnBuy' : 'the channel'}${a.channelSyncedAt ? `, ${new Date(a.channelSyncedAt).toLocaleDateString()}` : ''}`
                : `Entered by hand${a.editedBy ? ` by ${a.editedBy}` : ''}${a.editedAt ? `, ${new Date(a.editedAt).toLocaleDateString()}` : ''}`}
            </p>
          )}
        </div>
      </div>

      {editing && (
        <AddressModal
          view={view}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); qc.invalidateQueries({ queryKey: ['delivery-address', transactionId] }); }}
        />
      )}
    </>
  );
}

function AddressModal({ view, onClose, onSaved }: { view: DeliveryAddressView; onClose: () => void; onSaved: () => void }) {
  const a = view.address;
  const [form, setForm] = useState<Form>(blank);

  useEffect(() => {
    setForm(
      a
        ? {
            fullName: a.fullName ?? '', companyName: a.companyName ?? '',
            addressLine1: a.addressLine1 ?? '', addressLine2: a.addressLine2 ?? '',
            city: a.city ?? '', stateOrRegion: a.stateOrRegion ?? '',
            postalCode: a.postalCode ?? '', countryIso: a.countryIso ?? '',
            phone: a.phone ?? '', email: a.email ?? '',
            eori: a.eori ?? '', vatNumber: a.vatNumber ?? '', isBusiness: a.isBusiness,
          }
        // A new address starts on the order's own destination country — the one field we already
        // know, and the one most easily got wrong by hand.
        : { ...blank, countryIso: view.destinationCountryIso ?? '' },
    );
  }, [a, view.destinationCountryIso]);

  const save = useMutation({
    mutationFn: (body: Form) => salesTransactionsApi.saveDeliveryAddress(view.transactionId, body),
    onSuccess: (r) => {
      toast.success(r.missing.length === 0 ? 'Delivery address saved' : `Saved — still needed: ${r.missing.map((m) => LABELS[m] ?? m).join(', ')}`);
      onSaved();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const busy = save.isPending;
  const set = (k: keyof Form, v: string | boolean | null) => setForm((f) => ({ ...f, [k]: v }));

  const F = ({ label, k, placeholder, mono }: { label: string; k: keyof Form; placeholder?: string; mono?: boolean }) => (
    <div>
      <label className="label">{label}</label>
      <input
        className={`input${mono ? ' mono' : ''}`}
        value={(form[k] as string) ?? ''}
        onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-[560px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">Delivery address</h2>
          <p className="mt-0.5 text-[12.5px] text-n-500">
            {view.canPullFromChannel
              ? 'Saving marks this as entered by hand, and later syncs will leave it alone rather than putting the marketplace version back.'
              : 'Amazon does not release buyer addresses to us — copy this from Seller Central.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <F label="Name" k="fullName" placeholder="Recipient name" />
            <F label="Company" k="companyName" placeholder="If a business" />
          </div>
          <div className="mt-3">
            <F label="Address line 1" k="addressLine1" />
          </div>
          <div className="mt-3">
            <F label="Address line 2" k="addressLine2" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <F label="City" k="city" />
            <F label="State / region" k="stateOrRegion" />
            <F label="Postcode" k="postalCode" mono />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <label className="label">Country <span className="font-normal text-n-400">(ISO-2)</span></label>
              <input
                className="input mono uppercase"
                maxLength={2}
                value={(form.countryIso as string) ?? ''}
                onChange={(e) => set('countryIso', e.target.value.toUpperCase())}
                placeholder="GB"
              />
            </div>
            <F label="Phone" k="phone" placeholder="+357…" />
            <F label="Email" k="email" />
          </div>

          <div className="mt-4 border-t border-n-100 pt-4">
            <p className="mb-3 text-[12px] text-n-500">
              For shipments leaving the EU. A missing recipient EORI on a business shipment is the
              commonest cause of a customs hold.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <F label="EORI" k="eori" mono />
              <F label="VAT number" k="vatNumber" mono />
              <div>
                <label className="label">Address type</label>
                <select
                  className="input"
                  value={form.isBusiness === true ? 'business' : form.isBusiness === false ? 'residential' : ''}
                  onChange={(e) => set('isBusiness', e.target.value === '' ? null : e.target.value === 'business')}
                >
                  {/* Blank stays available: carriers rate the two differently, so a guess here is a
                      wrong shipping cost rather than a missing one. */}
                  <option value="">— not stated —</option>
                  <option value="residential">Residential</option>
                  <option value="business">Business</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-n-200 px-5 py-3.5">
          <button className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50" onClick={() => !busy && onClose()}>Cancel</button>
          <button
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            disabled={busy}
            onClick={() => save.mutate(form)}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Saving…' : 'Save address'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { ModalShell, Select } from '@masquare/ui';
import { companiesApi, countriesApi, customersApi, type LogisticsCustomer } from '../../lib/api';
import { CustomerPortalUsers } from './CustomerPortalUsers';

/**
 * One logistics customer.
 *
 * The prefix is the field to be careful with: it is the first two letters of every shipment
 * reference they will ever quote, so it can be corrected while they have none and is refused once
 * the first has been issued. The screen says which state it is in rather than letting somebody find
 * out by being refused.
 */
export function CustomerModal({ customer, onClose }: { customer: LogisticsCustomer | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!customer;

  const [name, setName] = useState(customer?.name ?? '');
  const [legalName, setLegalName] = useState(customer?.legalName ?? '');
  const [vatNumber, setVatNumber] = useState(customer?.vatNumber ?? '');
  const [eori, setEori] = useState(customer?.eori ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [website, setWebsite] = useState(customer?.website ?? '');
  const [prefix, setPrefix] = useState(customer?.referencePrefix ?? '');
  const [companyId, setCompanyId] = useState(customer?.companyId ?? '');
  const [line1, setLine1] = useState(customer?.addressLine1 ?? '');
  const [line2, setLine2] = useState(customer?.addressLine2 ?? '');
  const [city, setCity] = useState(customer?.addressCity ?? '');
  const [region, setRegion] = useState(customer?.addressRegion ?? '');
  const [postal, setPostal] = useState(customer?.addressPostalCode ?? '');
  const [country, setCountry] = useState(customer?.addressCountryIso ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [active, setActive] = useState(customer?.active ?? true);
  const [dirty, setDirty] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };

  const [contactName, setContactName] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: companiesApi.list });
  const { data: countries = [] } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });

  const done = (message: string) => {
    toast.success(message);
    qc.invalidateQueries({ queryKey: ['customers'] });
  };
  const failed = (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save', { duration: 9000 });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name, legalName, vatNumber, eori, email, phone, website,
        referencePrefix: prefix,
        companyId: companyId || null,
        addressLine1: line1, addressLine2: line2, addressCity: city, addressRegion: region,
        addressPostalCode: postal, addressCountryIso: country || null,
        notes, active,
      };
      return editing ? customersApi.update(customer!.id, body) : customersApi.create(body);
    },
    onSuccess: () => { done(editing ? 'Customer saved' : 'Customer created'); onClose(); },
    onError: failed,
  });

  const addContact = useMutation({
    mutationFn: () => customersApi.addContact(customer!.id, { name: contactName, role: contactRole, email: contactEmail, phone: contactPhone }),
    onSuccess: () => {
      setContactName(''); setContactRole(''); setContactEmail(''); setContactPhone('');
      done('Contact added');
    },
    onError: failed,
  });
  const removeContact = useMutation({
    mutationFn: (contactId: string) => customersApi.removeContact(customer!.id, contactId),
    onSuccess: () => done('Contact removed'),
    onError: failed,
  });

  const field = 'h-9 w-full rounded-md border border-n-200 px-2.5 text-[13px] outline-none focus:border-teal-400';
  const label = 'mb-1 block text-[12px] font-medium text-n-700';
  // Issued references carry the prefix, so it stops being editable the moment one exists.
  const prefixLocked = editing && (customer?.referenceSeq ?? 0) > 0;

  return (
    <ModalShell
      open
      title={editing ? customer!.name : 'New logistics customer'}
      subtitle={editing ? `Reference ${customer!.referencePrefix}-… · next ${customer!.nextReference}` : 'A company we ship for. Their people sign in to file their own shipments.'}
      dirty={dirty}
      primaryLabel={save.isPending ? 'Saving…' : 'Save'}
      primaryDisabled={save.isPending || !name.trim() || prefix.trim().length !== 2}
      onPrimary={() => save.mutate()}
      onClose={onClose}
      initialSize={{ w: 860, h: 640 }}
    >
      <div className="space-y-5 p-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Name</span>
            <input className={field} value={name} onChange={(e) => touch(setName)(e.target.value)} placeholder="What everybody calls them" />
          </label>
          <label className="block">
            <span className={label}>Registered name <span className="font-normal text-n-500">(if different)</span></span>
            <input className={field} value={legalName} onChange={(e) => touch(setLegalName)(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Reference prefix</span>
            <input
              className={`${field} mono uppercase ${prefixLocked ? 'bg-n-25 text-n-500' : ''}`}
              maxLength={2}
              disabled={prefixLocked}
              value={prefix}
              onChange={(e) => touch(setPrefix)(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase())}
              placeholder="AB"
            />
            <span className="mt-1 block text-[11.5px] text-n-500">
              {prefixLocked
                ? `Fixed: ${customer!.referenceSeq} reference${customer!.referenceSeq === 1 ? '' : 's'} already issued as ${customer!.referencePrefix}-…`
                : 'Two letters. Every shipment they file is numbered from it — AB-0001, AB-0002.'}
            </span>
          </label>
          <label className="block">
            <span className={label}>Served by</span>
            <Select
              value={companyId}
              onChange={touch(setCompanyId)}
              options={[{ value: '', label: '— choose a company —' }, ...companies.map((c) => ({ value: c.id, label: c.officialName }))]}
            />
            <span className="mt-1 block text-[11.5px] text-n-500">Which of our companies invoices them.</span>
          </label>
          <label className="block">
            <span className={label}>VAT number</span>
            <input className={`${field} mono`} value={vatNumber} onChange={(e) => touch(setVatNumber)(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>EORI <span className="font-normal text-n-500">(for their international shipments)</span></span>
            <input className={`${field} mono`} value={eori} onChange={(e) => touch(setEori)(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Email</span>
            <input className={field} value={email} onChange={(e) => touch(setEmail)(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Phone</span>
            <input className={field} value={phone} onChange={(e) => touch(setPhone)(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className={label}>Website</span>
            <input className={field} value={website} onChange={(e) => touch(setWebsite)(e.target.value)} />
          </label>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-semibold text-n-800">Address</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className={label}>Street</span>
              <input className={field} value={line1} onChange={(e) => touch(setLine1)(e.target.value)} />
            </label>
            <label className="block sm:col-span-2">
              <span className={label}>Street (second line)</span>
              <input className={field} value={line2} onChange={(e) => touch(setLine2)(e.target.value)} />
            </label>
            <label className="block">
              <span className={label}>City</span>
              <input className={field} value={city} onChange={(e) => touch(setCity)(e.target.value)} />
            </label>
            <label className="block">
              <span className={label}>Region</span>
              <input className={field} value={region} onChange={(e) => touch(setRegion)(e.target.value)} />
            </label>
            <label className="block">
              <span className={label}>Postcode</span>
              <input className={field} value={postal} onChange={(e) => touch(setPostal)(e.target.value)} />
            </label>
            <label className="block">
              <span className={label}>Country</span>
              <Select
                searchable
                value={country}
                onChange={touch(setCountry)}
                options={[{ value: '', label: '—' }, ...countries.map((c) => ({ value: c.isoCode, label: `${c.name} (${c.isoCode})` }))]}
              />
            </label>
          </div>
        </div>

        <label className="block">
          <span className={label}>Notes</span>
          <textarea className="h-20 w-full rounded-md border border-n-200 p-2.5 text-[13px] outline-none focus:border-teal-400" value={notes} onChange={(e) => touch(setNotes)(e.target.value)} />
        </label>

        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" className="mt-0.5" checked={active} onChange={(e) => touch(setActive)(e.target.checked)} />
          <span>
            <span className="block text-[13px] font-medium text-n-800">Active</span>
            <span className="block text-[12px] text-n-500">An inactive customer cannot file new shipments. Everything they have filed stays.</span>
          </span>
        </label>

        {/* Logins and contacts both need a customer to belong to, so they appear once there is one. */}
        {editing && <CustomerPortalUsers customerId={customer!.id} customerName={customer!.name} />}

        {editing && (
          <div>
            <div className="mb-2 text-[13px] font-semibold text-n-800">People to speak to</div>
            {customer!.contactPersons.length === 0 ? (
              <p className="mb-3 text-[12.5px] text-n-500">Nobody recorded yet.</p>
            ) : (
              <div className="mb-3 divide-y divide-n-100 rounded-md border border-n-100">
                {customer!.contactPersons.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                    <span className="font-medium text-n-800">{[c.name, c.surname].filter(Boolean).join(' ')}</span>
                    {c.role && <span className="text-n-500">{c.role}</span>}
                    <span className="flex-1" />
                    {c.email && <span className="text-n-600">{c.email}</span>}
                    {c.phone && <span className="mono text-n-600">{c.phone}</span>}
                    <button type="button" className="text-n-400 hover:text-danger" title="Remove" onClick={() => removeContact.mutate(c.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <input className={`${field} max-w-[170px]`} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Name" />
              <input className={`${field} max-w-[150px]`} value={contactRole} onChange={(e) => setContactRole(e.target.value)} placeholder="Role" />
              <input className={`${field} max-w-[200px]`} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Email" />
              <input className={`${field} max-w-[150px]`} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Phone" />
              <button type="button" className="hbtn" disabled={!contactName.trim() || addContact.isPending} onClick={() => addContact.mutate()}>
                {addContact.isPending && <Loader2 size={13} className="mr-1 inline animate-spin" />}Add
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

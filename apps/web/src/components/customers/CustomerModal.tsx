import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { ModalShell, Select } from '@masquare/ui';
import { LOGISTICS_TYPE, companiesApi, customersApi, type Customer, type CustomerType } from '../../lib/api';
import { CountrySelect } from '../common/CountrySelect';
import { CustomerPortalUsers } from './CustomerPortalUsers';

/**
 * One customer: who they are, what they take from us, and who to speak to.
 *
 * Laid out like the Company modal, because it is the same kind of record. The services a customer
 * takes decide what else the modal asks for — a logistics customer needs a reference prefix and can
 * be given portal logins; a customer who takes nothing yet needs neither, and is not asked.
 */

const BASE_TABS = [
  { key: 'details', label: 'Details' },
  { key: 'services', label: 'Services' },
  { key: 'contacts', label: 'Contacts' },
];

export function CustomerModal({ customer, types, onClose }: { customer: Customer | null; types: CustomerType[]; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!customer;
  const [tab, setTab] = useState('details');
  const [dirty, setDirty] = useState(false);

  const [form, setForm] = useState({
    name: customer?.name ?? '',
    legalName: customer?.legalName ?? '',
    vatNumber: customer?.vatNumber ?? '',
    eori: customer?.eori ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    website: customer?.website ?? '',
    addressLine1: customer?.addressLine1 ?? '',
    addressLine2: customer?.addressLine2 ?? '',
    addressCity: customer?.addressCity ?? '',
    addressRegion: customer?.addressRegion ?? '',
    addressPostalCode: customer?.addressPostalCode ?? '',
    addressCountryIso: customer?.addressCountryIso ?? '',
    companyId: customer?.companyId ?? '',
    notes: customer?.notes ?? '',
    active: customer?.active ?? true,
    types: customer?.types ?? [],
    referencePrefix: customer?.referencePrefix ?? '',
  });
  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  const isLogistics = form.types.includes(LOGISTICS_TYPE);
  // References already issued fix the prefix, and fix the logistics service with it.
  const issued = customer?.referenceSeq ?? 0;
  const savedAsLogistics = !!customer?.types.includes(LOGISTICS_TYPE);

  // Portal logins belong to a saved logistics customer: there is nothing to attach them to before.
  const tabs = savedAsLogistics ? [...BASE_TABS, { key: 'logins', label: 'Portal logins' }] : BASE_TABS;

  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: companiesApi.list });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        companyId: form.companyId || null,
        addressCountryIso: form.addressCountryIso || null,
        referencePrefix: isLogistics ? form.referencePrefix : null,
      };
      return editing ? customersApi.update(customer!.id, body) : customersApi.create(body);
    },
    onSuccess: () => {
      toast.success(editing ? 'Customer saved' : 'Customer created');
      qc.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the customer', { duration: 9000 }),
  });

  const toggleType = (key: string, on: boolean) =>
    set({ types: on ? [...new Set([...form.types, key])] : form.types.filter((t) => t !== key) });

  const canSave = form.name.trim().length > 0 && (!isLogistics || form.referencePrefix.trim().length === 2) && !save.isPending;

  return (
    <ModalShell
      open
      title={editing ? 'Edit customer' : 'New customer'}
      subtitle={customer?.name}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      dirty={dirty}
      primaryLabel={editing ? 'Save changes' : 'Create customer'}
      onPrimary={() => save.mutate()}
      primaryDisabled={!canSave}
      busy={save.isPending}
      onClose={onClose}
    >
      {tab === 'details' && (
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <Field label="Name *">
            <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="What everybody calls them" />
          </Field>
          <Field label="Registered name">
            <input className="input" value={form.legalName} onChange={(e) => set({ legalName: e.target.value })} placeholder="If different" />
          </Field>
          <Field label="VAT number">
            <input className="input mono" value={form.vatNumber} onChange={(e) => set({ vatNumber: e.target.value })} />
          </Field>
          <Field label="EORI">
            <input className="input mono" value={form.eori} onChange={(e) => set({ eori: e.target.value })} />
          </Field>
          <Field label="Email">
            <input className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input className="input mono" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <Field label="Website" className="col-span-2 max-[560px]:col-span-1">
            <input className="input" value={form.website} onChange={(e) => set({ website: e.target.value })} />
          </Field>
          <Field label="Address line 1" className="col-span-2 max-[560px]:col-span-1">
            <input className="input" value={form.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} />
          </Field>
          <Field label="Address line 2" className="col-span-2 max-[560px]:col-span-1">
            <input className="input" value={form.addressLine2} onChange={(e) => set({ addressLine2: e.target.value })} />
          </Field>
          <Field label="City">
            <input className="input" value={form.addressCity} onChange={(e) => set({ addressCity: e.target.value })} />
          </Field>
          <Field label="Region">
            <input className="input" value={form.addressRegion} onChange={(e) => set({ addressRegion: e.target.value })} />
          </Field>
          <Field label="Postcode">
            <input className="input mono" value={form.addressPostalCode} onChange={(e) => set({ addressPostalCode: e.target.value })} />
          </Field>
          <Field label="Country">
            <CountrySelect value={form.addressCountryIso || null} valueKind="code" onChange={(v) => set({ addressCountryIso: v ?? '' })} />
          </Field>
          <Field label="Served by">
            <Select
              value={form.companyId}
              onChange={(v) => set({ companyId: v })}
              options={[{ value: '', label: 'Choose one of our companies' }, ...companies.map((c) => ({ value: c.id, label: c.officialName }))]}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.active ? 'active' : 'inactive'}
              onChange={(v) => set({ active: v === 'active' })}
              options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive — keeps their history, takes no new work' }]}
            />
          </Field>
          <Field label="Notes" className="col-span-2 max-[560px]:col-span-1">
            <textarea className="input h-20 py-2" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      )}

      {tab === 'services' && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-n-600">What this customer takes from us. Each service switches on the part of the platform that serves it.</p>
          {types.map((t) => {
            const on = form.types.includes(t.key);
            // Logistics cannot be switched off once shipments are numbered under it.
            const locked = t.key === LOGISTICS_TYPE && savedAsLogistics && issued > 0;
            return (
              <div key={t.key} className={`rounded-lg border p-4 ${on ? 'border-teal-200 bg-teal-50/40' : 'border-n-200'}`}>
                <label className={`flex items-start gap-3 ${locked ? '' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]"
                    checked={on}
                    disabled={locked}
                    onChange={(e) => toggleType(t.key, e.target.checked)}
                  />
                  <span>
                    <span className="block text-[13.5px] font-semibold text-n-800">{t.label}</span>
                    <span className="block text-[12.5px] text-n-600">{t.description}</span>
                    {locked && (
                      <span className="mt-1 block text-[12px] text-n-500">
                        Fixed — {issued} shipment{issued === 1 ? ' is' : 's are'} numbered under it. Mark the customer inactive to stop new work.
                      </span>
                    )}
                  </span>
                </label>

                {t.key === LOGISTICS_TYPE && on && (
                  <div className="ml-7 mt-4 max-w-[280px]">
                    <label className="label">Reference prefix *</label>
                    <input
                      className="input mono uppercase"
                      maxLength={2}
                      disabled={issued > 0}
                      value={form.referencePrefix}
                      onChange={(e) => set({ referencePrefix: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase() })}
                      placeholder="AB"
                    />
                    <p className="mt-1.5 text-[12px] text-n-500">
                      {issued > 0
                        ? `Fixed: ${issued} reference${issued === 1 ? '' : 's'} already issued as ${customer!.referencePrefix}-…`
                        : 'Two letters. Every shipment they file is numbered from it — AB-0001, AB-0002.'}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          {isLogistics && !savedAsLogistics && (
            <p className="text-[12.5px] text-n-500">Save the customer, then add their portal logins from the tab that appears.</p>
          )}
        </div>
      )}

      {tab === 'contacts' && (
        editing
          ? <CustomerContacts customer={customer!} />
          : <p className="text-[13px] text-n-500">Save the customer first, then add the people to speak to.</p>
      )}

      {tab === 'logins' && savedAsLogistics && <CustomerPortalUsers customerId={customer!.id} customerName={customer!.name} />}
    </ModalShell>
  );
}

/** The people to speak to at a customer. Saved as they are added, like any other list of records. */
function CustomerContacts({ customer }: { customer: Customer }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ name: '', role: '', email: '', phone: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['customers'] });
  const failed = (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the contact');

  const { data: current = customer } = useQuery({
    queryKey: ['customers', customer.id],
    queryFn: () => customersApi.get(customer.id),
    initialData: customer,
  });

  const add = useMutation({
    mutationFn: () => customersApi.addContact(customer.id, draft),
    onSuccess: () => { setDraft({ name: '', role: '', email: '', phone: '' }); toast.success('Contact added'); refresh(); },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (contactId: string) => customersApi.removeContact(customer.id, contactId),
    onSuccess: () => { toast.success('Contact removed'); refresh(); },
    onError: failed,
  });

  return (
    <div className="flex flex-col gap-3">
      {current.contactPersons.length === 0 && <p className="text-[13px] text-n-500">No contact people yet.</p>}
      {current.contactPersons.map((c) => (
        <div key={c.id} className="flex items-center gap-2 rounded-md border border-n-200 px-3 py-2">
          <div className="min-w-0 flex-1 text-[13px]">
            <span className="font-semibold text-n-800">{[c.name, c.surname].filter(Boolean).join(' ')}</span>
            {c.role && <span className="ml-2 text-n-500">{c.role}</span>}
            <div className="text-[12px] text-n-600">
              {[c.email, c.phone].filter(Boolean).join(' · ') || 'No email or phone'}
            </div>
          </div>
          <button
            className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger"
            onClick={() => remove.mutate(c.id)}
            title="Remove"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
        <input className="input" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="input" placeholder="Role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
        <input className="input" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        <input className="input mono" placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
      </div>
      <div>
        <button className="btn btn-ghost" disabled={!draft.name.trim() || add.isPending} onClick={() => add.mutate()}>
          <Plus size={16} /> Add contact
        </button>
      </div>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

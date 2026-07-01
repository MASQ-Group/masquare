import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { companiesApi, type Company } from '../lib/api';
import { CountrySelect } from './common/CountrySelect';

interface Props {
  company: Company | null; // null = create
  onClose: () => void;
  onSaved: () => void;
}

type VatRow = { country: string; vatNumber: string };
type ContactRow = { name: string; surname?: string; email?: string; phone?: string; role?: string };

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'vat', label: 'VAT registrations' },
  { key: 'contacts', label: 'Contacts' },
];

export function CompanyModal({ company, onClose, onSaved }: Props) {
  const [tab, setTab] = useState('details');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    officialName: company?.officialName ?? '',
    registrationNumber: company?.registrationNumber ?? '',
    addressLine1: company?.addressLine1 ?? '',
    addressCity: company?.addressCity ?? '',
    addressCountry: company?.addressCountry ?? '',
    email: company?.email ?? '',
    website: company?.website ?? '',
    phoneLandline: company?.phoneLandline ?? '',
  });
  const [vats, setVats] = useState<VatRow[]>(
    company?.vatRegistrations.map((v) => ({ country: v.country, vatNumber: v.vatNumber })) ?? [],
  );
  const [contacts, setContacts] = useState<ContactRow[]>(
    company?.contactPersons.map((c) => ({
      name: c.name,
      surname: c.surname ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      role: c.role ?? '',
    })) ?? [],
  );

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const canSave = useMemo(() => form.officialName.trim().length > 0, [form.officialName]);

  const save = async () => {
    if (!canSave) {
      setTab('details');
      toast.error('Official name is required');
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...form,
        vatRegistrations: vats.filter((v) => v.country && v.vatNumber),
        contactPersons: contacts.filter((c) => c.name),
      };
      if (company) await companiesApi.update(company.id, body as any);
      else await companiesApi.create(body as any);
      toast.success(company ? 'Company updated' : 'Company created');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title={company ? 'Edit company' : 'New company'}
      subtitle={company?.officialName}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      dirty={dirty}
      primaryLabel={company ? 'Save changes' : 'Create company'}
      onPrimary={save}
      primaryDisabled={!canSave}
      busy={busy}
      onClose={onClose}
    >
      {tab === 'details' && (
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <Field label="Official name *" className="col-span-2">
            <input className="input" value={form.officialName} onChange={(e) => set({ officialName: e.target.value })} />
          </Field>
          <Field label="Registration number">
            <input className="input mono" value={form.registrationNumber} onChange={(e) => set({ registrationNumber: e.target.value })} />
          </Field>
          <Field label="Country">
            <CountrySelect value={form.addressCountry || null} valueKind="code" onChange={(v) => set({ addressCountry: v ?? '' })} />
          </Field>
          <Field label="Address line 1" className="col-span-2">
            <input className="input" value={form.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} />
          </Field>
          <Field label="City">
            <input className="input" value={form.addressCity} onChange={(e) => set({ addressCity: e.target.value })} />
          </Field>
          <Field label="Email">
            <input className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Website">
            <input className="input" value={form.website} onChange={(e) => set({ website: e.target.value })} />
          </Field>
          <Field label="Phone (landline)">
            <input className="input mono" value={form.phoneLandline} onChange={(e) => set({ phoneLandline: e.target.value })} />
          </Field>
        </div>
      )}

      {tab === 'vat' && (
        <RepeatableList
          rows={vats}
          empty="No VAT registrations. A company can hold several (e.g. CY and IT)."
          addLabel="Add VAT registration"
          onAdd={() => { setVats((r) => [...r, { country: '', vatNumber: '' }]); setDirty(true); }}
          onRemove={(i) => { setVats((r) => r.filter((_, idx) => idx !== i)); setDirty(true); }}
          render={(row, i) => (
            <div className="grid grid-cols-[120px_1fr] gap-3">
              <input className="input mono" placeholder="CY" value={row.country}
                onChange={(e) => { setVats((r) => r.map((x, idx) => idx === i ? { ...x, country: e.target.value } : x)); setDirty(true); }} />
              <input className="input mono" placeholder="CY10156304C" value={row.vatNumber}
                onChange={(e) => { setVats((r) => r.map((x, idx) => idx === i ? { ...x, vatNumber: e.target.value } : x)); setDirty(true); }} />
            </div>
          )}
        />
      )}

      {tab === 'contacts' && (
        <RepeatableList
          rows={contacts}
          empty="No contact people yet."
          addLabel="Add contact"
          onAdd={() => { setContacts((r) => [...r, { name: '' }]); setDirty(true); }}
          onRemove={(i) => { setContacts((r) => r.filter((_, idx) => idx !== i)); setDirty(true); }}
          render={(row, i) => (
            <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
              <input className="input" placeholder="Name" value={row.name}
                onChange={(e) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x)); setDirty(true); }} />
              <input className="input" placeholder="Role" value={row.role ?? ''}
                onChange={(e) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, role: e.target.value } : x)); setDirty(true); }} />
              <input className="input" placeholder="Email" value={row.email ?? ''}
                onChange={(e) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, email: e.target.value } : x)); setDirty(true); }} />
              <input className="input mono" placeholder="Phone" value={row.phone ?? ''}
                onChange={(e) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, phone: e.target.value } : x)); setDirty(true); }} />
            </div>
          )}
        />
      )}
    </ModalShell>
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

function RepeatableList<T>({
  rows, empty, addLabel, onAdd, onRemove, render,
}: {
  rows: T[];
  empty: string;
  addLabel: string;
  onAdd: () => void;
  onRemove: (i: number) => void;
  render: (row: T, i: number) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && <p className="text-[13px] text-n-500">{empty}</p>}
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">{render(row, i)}</div>
          <button
            className="mt-1 grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger"
            onClick={() => onRemove(i)}
            title="Remove"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <div>
        <button className="btn btn-ghost" onClick={onAdd}>
          <Plus size={16} /> {addLabel}
        </button>
      </div>
    </div>
  );
}

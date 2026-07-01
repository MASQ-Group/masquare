import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { vendorsApi, type Vendor, type VendorContact } from '../../lib/api';
import { CountrySelect } from '../common/CountrySelect';
import { AddButton, ImportButton, RefTable, SectionHeader } from './shared';

export function VendorsSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Vendor | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['vendors'] });
  const del = useMutation({ mutationFn: (id: string) => vendorsApi.remove(id), onSuccess: () => { toast.success('Removed'); invalidate(); } });

  return (
    <div>
      <SectionHeader title="Vendors" description="Suppliers products can be purchased from.">
        <ImportButton
          title="Import vendors"
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'vatNumber', label: 'VAT number' },
            { key: 'addressCountry', label: 'Country' },
            { key: 'email', label: 'Email' },
          ]}
          onCommit={async (rows) => { for (const r of rows) await vendorsApi.create(r as any); invalidate(); }}
        />
        <AddButton label="Add vendor" onClick={() => setEditing(null)} />
      </SectionHeader>
      <RefTable<Vendor>
        loading={isLoading}
        empty="No vendors yet. Add your first vendor."
        rows={data}
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-n-800">{r.name}</span> },
          { key: 'vat', header: 'VAT', className: 'mono', render: (r) => r.vatNumber ?? '—' },
          { key: 'country', header: 'Country', className: 'mono', render: (r) => r.addressCountry ?? '—' },
          { key: 'contacts', header: 'Contacts', render: (r) => r.contacts.length },
        ]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove ${r.name}?`) && del.mutate(r.id)}
      />
      {editing !== undefined && (
        <VendorModal vendor={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); invalidate(); }} />
      )}
    </div>
  );
}

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'contacts', label: 'Contacts' },
];

function VendorModal({ vendor, onClose, onSaved }: { vendor: Vendor | null; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState('details');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: vendor?.name ?? '',
    vatNumber: vendor?.vatNumber ?? '',
    addressCity: vendor?.addressCity ?? '',
    addressCountry: vendor?.addressCountry ?? '',
    phone: vendor?.phone ?? '',
    email: vendor?.email ?? '',
    website: vendor?.website ?? '',
  });
  const [contacts, setContacts] = useState<VendorContact[]>(vendor?.contacts ?? []);

  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const canSave = form.name.trim().length > 0;

  const save = async () => {
    if (!canSave) { setTab('details'); toast.error('Name is required'); return; }
    setBusy(true);
    try {
      const body = { ...form, contacts: contacts.filter((c) => c.contactName || c.contactEmail || c.contactPhone) };
      if (vendor) await vendorsApi.update(vendor.id, body as any); else await vendorsApi.create(body as any);
      toast.success(vendor ? 'Vendor updated' : 'Vendor created');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open title={vendor ? 'Edit vendor' : 'New vendor'} subtitle={vendor?.name}
      tabs={TABS} activeTab={tab} onTabChange={setTab} dirty={dirty}
      primaryLabel={vendor ? 'Save changes' : 'Create vendor'} onPrimary={save} primaryDisabled={!canSave} busy={busy} onClose={onClose}
    >
      {tab === 'details' && (
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <div className="col-span-2"><label className="label">Name *</label><input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} /></div>
          <div><label className="label">VAT number</label><input className="input mono" value={form.vatNumber} onChange={(e) => set({ vatNumber: e.target.value })} /></div>
          <div><label className="label">Country</label><CountrySelect value={form.addressCountry || null} valueKind="code" onChange={(v) => set({ addressCountry: v ?? '' })} /></div>
          <div><label className="label">City</label><input className="input" value={form.addressCity} onChange={(e) => set({ addressCity: e.target.value })} /></div>
          <div><label className="label">Phone</label><input className="input mono" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
          <div><label className="label">Email</label><input className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} /></div>
          <div><label className="label">Website</label><input className="input" value={form.website} onChange={(e) => set({ website: e.target.value })} /></div>
        </div>
      )}
      {tab === 'contacts' && (
        <div className="flex flex-col gap-3">
          {contacts.length === 0 && <p className="text-[13px] text-n-500">No contacts yet.</p>}
          {contacts.map((c, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="grid flex-1 grid-cols-2 gap-3 max-[560px]:grid-cols-1">
                <input className="input" placeholder="Name" value={c.contactName ?? ''} onChange={(e) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, contactName: e.target.value } : x)); setDirty(true); }} />
                <select className="input" value={c.contactType ?? ''} onChange={(e) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, contactType: (e.target.value || null) as any } : x)); setDirty(true); }}>
                  <option value="">Type…</option>
                  <option value="person">Person</option>
                  <option value="department">Department</option>
                </select>
                <input className="input" placeholder="Role (e.g. Sales)" value={c.contactRole ?? ''} onChange={(e) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, contactRole: e.target.value } : x)); setDirty(true); }} />
                <input className="input" placeholder="Email" value={c.contactEmail ?? ''} onChange={(e) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, contactEmail: e.target.value } : x)); setDirty(true); }} />
                <input className="input mono" placeholder="Phone" value={c.contactPhone ?? ''} onChange={(e) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, contactPhone: e.target.value } : x)); setDirty(true); }} />
              </div>
              <button className="mt-1 grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setContacts((r) => r.filter((_, idx) => idx !== i)); setDirty(true); }}><Trash2 size={15} /></button>
            </div>
          ))}
          <div><button className="btn btn-ghost" onClick={() => { setContacts((r) => [...r, {}]); setDirty(true); }}><Plus size={16} /> Add contact</button></div>
        </div>
      )}
    </ModalShell>
  );
}

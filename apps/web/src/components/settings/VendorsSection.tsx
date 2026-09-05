import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { vendorsApi, type Vendor, type VendorContact } from '../../lib/api';
import { CountrySelect } from '../common/CountrySelect';
import { CurrencySelect } from '../common/CurrencySelect';
import { AddButton, ImportButton, RefTable, SectionHeader, SectionSearch } from './shared';

export function VendorsSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Vendor | null | undefined>(undefined);
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });

  // Filtered client-side: the whole vendor list is already loaded, so this stays instant.
  const needle = q.trim().toLowerCase();
  const rows = needle
    ? data.filter((v) =>
        [v.name, v.vatNumber, v.addressCountry, v.addressCity, v.email, ...v.contacts.map((c) => c.contactName)]
          .some((f) => (f ?? '').toLowerCase().includes(needle)),
      )
    : data;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['vendors'] });
  const del = useMutation({ mutationFn: (id: string) => vendorsApi.remove(id), onSuccess: () => { toast.success('Removed'); invalidate(); } });

  return (
    <div>
      <SectionHeader title="Vendors" description="Suppliers products can be purchased from.">
        <ImportButton
          title="Import Vendors"
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
      <SectionSearch value={q} onChange={setQ} placeholder="Search name, VAT, country, contact…" matched={rows.length} total={data.length} />

      <RefTable<Vendor>
        loading={isLoading}
        empty={needle ? `No vendors match "${q.trim()}".` : 'No vendors yet. Add your first vendor.'}
        rows={rows}
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-n-800">{r.name}</span> },
          { key: 'vat', header: 'VAT', className: 'mono', render: (r) => r.vatNumber ?? '—' },
          { key: 'country', header: 'Country', className: 'mono', render: (r) => r.addressCountry ?? '—' },
          { key: 'currency', header: 'Currency', className: 'mono', render: (r) => r.currency ?? 'EUR' },
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
  { key: 'vat', label: 'Purchasing VAT' },
  { key: 'contacts', label: 'Contacts' },
];

const VAT_TREATMENTS = [
  { value: 'standard' as const, label: 'Standard — charge VAT', hint: 'Local vendor. Each line uses its product VAT class rate.' },
  { value: 'reverse_charge' as const, label: 'EU reverse charge — 0%', hint: 'EU vendor with a valid VAT number. VAT accounted for by us (Art. 196).' },
  { value: 'outside_scope' as const, label: 'Outside EU — 0%', hint: 'Non-EU vendor. Import VAT and duties handled at customs.' },
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
    vatTreatment: vendor?.vatTreatment ?? 'standard',
    currency: vendor?.currency ?? 'EUR',
    mapIncludesVat: vendor?.mapIncludesVat ?? false,
  });
  const [vies, setVies] = useState<{ valid: boolean | null; name?: string | null; checkedAt: string; message: string } | null>(
    vendor?.vatNumberCheckedAt
      ? { valid: vendor.vatNumberValid ?? null, name: vendor.vatNumberCheckedName, checkedAt: vendor.vatNumberCheckedAt, message: '' }
      : null,
  );
  const [checking, setChecking] = useState(false);
  const [contacts, setContacts] = useState<VendorContact[]>(vendor?.contacts ?? []);

  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const canSave = form.name.trim().length > 0;

  const verify = async () => {
    if (!vendor) return;
    setChecking(true);
    try {
      const res = await vendorsApi.verifyVat(vendor.id);
      setVies(res);
      // VIES is advisory — an unreachable service is reported, never treated as invalid.
      if (res.valid === true) toast.success(res.message);
      else if (res.valid === false) toast.error(res.message);
      else toast.warning(res.message);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'VIES check failed');
    } finally {
      setChecking(false);
    }
  };

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
          <div>
            <label className="label">VAT number</label>
            <input className="input code" value={form.vatNumber} onChange={(e) => set({ vatNumber: e.target.value })} />
            {/* Sits below the input so the fields on this grid row stay top-aligned. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
              <button
                type="button"
                className="font-medium text-teal-700 hover:text-teal-800 disabled:cursor-not-allowed disabled:text-n-300"
                disabled={!vendor || !form.vatNumber.trim() || checking}
                onClick={verify}
              >
                {checking ? 'Checking VIES…' : 'Verify with VIES'}
              </button>
              {!vendor && <span className="text-n-400">— save the vendor first</span>}
              {vies && (
                <span className={vies.valid === true ? 'text-success' : vies.valid === false ? 'text-danger' : 'text-warning'}>
                  {vies.valid === true ? 'Valid' : vies.valid === false ? 'Not recognised' : 'Unconfirmed'}
                  {vies.name ? ` — ${vies.name}` : ''}
                  <span className="text-n-400"> · {new Date(vies.checkedAt).toLocaleDateString('en-GB')}</span>
                </span>
              )}
            </div>
          </div>
          <div><label className="label">Country</label><CountrySelect value={form.addressCountry || null} valueKind="code" onChange={(v) => set({ addressCountry: v ?? '' })} /></div>
          <div>
            <label className="label">Currency</label>
            <CurrencySelect value={form.currency || 'EUR'} onChange={(v) => set({ currency: v ?? 'EUR' })} />
            <div className="mt-1.5 text-[11.5px] text-n-400">Purchase orders for this vendor are priced in it.</div>
          </div>
          <div><label className="label">City</label><input className="input" value={form.addressCity} onChange={(e) => set({ addressCity: e.target.value })} /></div>
          <div><label className="label">Phone</label><input className="input mono" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
          <div><label className="label">Email</label><input className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} /></div>
          <div><label className="label">Website</label><input className="input" value={form.website} onChange={(e) => set({ website: e.target.value })} /></div>
        </div>
      )}
      {tab === 'vat' && (
        <div className="flex flex-col gap-5">
          <div>
            <div className="label">VAT treatment on purchase orders</div>
            <p className="text-xs text-n-500 mb-2">
              Decides how VAT is calculated on this vendor's purchase orders. Standard uses each product's VAT class.
            </p>
            <div className="flex flex-col gap-2">
              {VAT_TREATMENTS.map((t) => (
                <label key={t.value} className="flex items-start gap-2.5 rounded-md border border-n-200 p-3 cursor-pointer hover:bg-n-25">
                  <input
                    type="radio" className="mt-0.5" name="vatTreatment"
                    checked={form.vatTreatment === t.value}
                    onChange={() => set({ vatTreatment: t.value })}
                  />
                  <span>
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span className="block text-xs text-n-500">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="label">MAP / suggested retail price basis</div>
            <p className="text-xs text-n-500 mb-2">
              How to read the suggested retail price this vendor quotes, in their price list and when one is
              uploaded. Vendors are not consistent — the same file often heads the dealer price
              &ldquo;EXC&rdquo; and the retail price &ldquo;INC&rdquo; — and reading it the wrong way shifts every
              MAP by the VAT rate.
            </p>
            <div className="flex flex-col gap-2">
              {([
                { value: false, label: 'Excludes VAT', hint: 'The quoted price is net. VAT is added on top to reach the shelf price.' },
                { value: true, label: 'Includes VAT', hint: 'The quoted price is what the customer pays, VAT already inside it.' },
              ] as const).map((o) => (
                <label key={String(o.value)} className="flex items-start gap-2.5 rounded-md border border-n-200 p-3 cursor-pointer hover:bg-n-25">
                  <input
                    type="radio" className="mt-0.5" name="mapIncludesVat"
                    checked={form.mapIncludesVat === o.value}
                    onChange={() => set({ mapIncludesVat: o.value })}
                  />
                  <span>
                    <span className="block text-sm font-medium">{o.label}</span>
                    <span className="block text-xs text-n-500">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

        </div>
      )}

      {tab === 'contacts' && (
        <div className="flex flex-col gap-3">
          {contacts.length === 0 && <p className="text-[13px] text-n-500">No contacts yet.</p>}
          {contacts.map((c, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="grid flex-1 grid-cols-2 gap-3 max-[560px]:grid-cols-1">
                <input className="input" placeholder="Name" value={c.contactName ?? ''} onChange={(e) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, contactName: e.target.value } : x)); setDirty(true); }} />
                <Select
                  value={c.contactType ?? ''}
                  placeholder="Type…"
                  onChange={(v) => { setContacts((r) => r.map((x, idx) => idx === i ? { ...x, contactType: (v || null) as any } : x)); setDirty(true); }}
                  options={[{ value: 'person', label: 'Person' }, { value: 'department', label: 'Department' }]}
                />
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

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { ModalShell, downloadSheet } from '@masquare/ui';
import { countriesApi, salesChannelsApi, type SalesChannel } from '../../lib/api';
import { CountrySelect } from '../common/CountrySelect';
import { CurrencySelect } from '../common/CurrencySelect';
import { AddButton, ImportButton, RefTable, SectionHeader } from './shared';

export function SalesChannelsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SalesChannel | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const { data: countries = [] } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['sales-channels'] });
  const del = useMutation({ mutationFn: (id: string) => salesChannelsApi.remove(id), onSuccess: () => { toast.success('Removed'); invalidate(); } });

  // Resolve a country cell (ISO code or official name) to its id for import.
  const resolveCountryId = (token?: string) => {
    const t = (token ?? '').trim();
    if (!t) return null;
    const c = countries.find((x) => x.isoCode.toLowerCase() === t.toLowerCase() || x.name.toLowerCase() === t.toLowerCase());
    return c?.id ?? null;
  };

  const downloadTemplate = () =>
    downloadSheet('sales-channels-template', [
      ['Name', 'Description', 'Native Country', 'Native Currency', 'Email', 'Website', 'Contact Name'],
      ['Amazon UK', 'Amazon United Kingdom', 'United Kingdom', 'GBP', 'seller@example.com', 'https://amazon.co.uk', 'Marketplace Team'],
      ['eBay DE', 'eBay Germany', 'Germany', 'EUR', 'seller@example.de', 'https://ebay.de', 'Sales'],
    ], 'xlsx');

  return (
    <div>
      <SectionHeader title="Sales Channels" description="Marketplaces and channels the companies sell on, with their native country and currency.">
        <button className="btn btn-ghost" onClick={downloadTemplate}><Download size={16} /> Template</button>
        <ImportButton title="Import sales channels"
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'description', label: 'Description' },
            { key: 'nativeCountry', label: 'Native Country' },
            { key: 'nativeCurrency', label: 'Native Currency' },
            { key: 'email', label: 'Email' },
            { key: 'website', label: 'Website' },
            { key: 'contactName', label: 'Contact Name' },
          ]}
          onCommit={async (rows) => {
            for (const r of rows) {
              const { nativeCountry, ...rest } = r;
              await salesChannelsApi.create({ ...rest, nativeCountryId: resolveCountryId(nativeCountry) } as any);
            }
            invalidate();
          }} />
        <AddButton label="Add sales channel" onClick={() => setEditing(null)} />
      </SectionHeader>
      <RefTable<SalesChannel>
        loading={isLoading}
        empty="No sales channels yet."
        rows={data}
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-n-800">{r.name}</span> },
          { key: 'description', header: 'Description', render: (r) => r.description ?? '—' },
          { key: 'country', header: 'Native country', render: (r) => r.nativeCountry?.name ?? '—' },
          { key: 'currency', header: 'Currency', className: 'mono', render: (r) => r.nativeCurrency ?? '—' },
          { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
        ]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove ${r.name}?`) && del.mutate(r.id)}
      />
      {editing !== undefined && (
        <SalesChannelModal channel={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); invalidate(); }} />
      )}
    </div>
  );
}

function SalesChannelModal({ channel, onClose, onSaved }: { channel: SalesChannel | null; onClose: () => void; onSaved: () => void }) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);
  const [form, setForm] = useState({
    name: channel?.name ?? '',
    description: channel?.description ?? '',
    nativeCountryId: channel?.nativeCountryId ?? null as string | null,
    nativeCurrency: channel?.nativeCurrency ?? null as string | null,
    email: channel?.email ?? '',
    website: channel?.website ?? '',
    contactName: channel?.contactName ?? '',
  });
  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); touch(); };
  const canSave = form.name.trim().length > 0;

  const save = async () => {
    if (!canSave) { toast.error('Name is required'); return; }
    setBusy(true);
    try {
      const body = { ...form, description: form.description || undefined, email: form.email || undefined, website: form.website || undefined, contactName: form.contactName || undefined };
      if (channel) await salesChannelsApi.update(channel.id, body as any); else await salesChannelsApi.create(body as any);
      toast.success('Saved');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell open title={channel ? 'Edit sales channel' : 'New sales channel'} subtitle={channel?.name} dirty={dirty}
      primaryLabel={channel ? 'Save changes' : 'Create channel'} onPrimary={save} primaryDisabled={!canSave} busy={busy} onClose={onClose}>
      <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
        <div><label className="label">Name *</label><input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Amazon UK" /></div>
        <div><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Amazon United Kingdom" /></div>
        <div><label className="label">Native country</label><CountrySelect value={form.nativeCountryId} onChange={(v) => set({ nativeCountryId: v })} /></div>
        <div><label className="label">Native currency</label><CurrencySelect value={form.nativeCurrency} onChange={(v) => set({ nativeCurrency: v })} /></div>
        <div><label className="label">Email</label><input className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} /></div>
        <div><label className="label">Website</label><input className="input" value={form.website} onChange={(e) => set({ website: e.target.value })} /></div>
        <div className="col-span-2"><label className="label">Contact name</label><input className="input" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} /></div>
      </div>
    </ModalShell>
  );
}

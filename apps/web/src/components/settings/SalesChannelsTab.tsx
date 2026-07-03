import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Trash2, Upload } from 'lucide-react';
import { ModalShell, downloadSheet } from '@masquare/ui';
import { countriesApi, salesChannelsApi, type SalesChannel } from '../../lib/api';
import { CountrySelect } from '../common/CountrySelect';
import { CurrencySelect } from '../common/CurrencySelect';
import { AddButton, RefTable, SectionHeader } from './shared';
import { SalesChannelImportModal } from './SalesChannelImportModal';

const EXPORT_HEADERS = ['Name', 'Description', 'Native Country', 'Native Currency', 'Email', 'Website', 'Contact Name'];

export function SalesChannelsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SalesChannel | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const { data: countries = [] } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['sales-channels'] });
  const del = useMutation({ mutationFn: (id: string) => salesChannelsApi.remove(id), onSuccess: () => { toast.success('Removed'); invalidate(); } });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);

  const allSelected = data.length > 0 && data.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected((prev) => { const n = new Set(prev); if (data.every((c) => n.has(c.id))) data.forEach((c) => n.delete(c.id)); else data.forEach((c) => n.add(c.id)); return n; });
  const toggleOne = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportSelected = () => {
    const chosen = data.filter((c) => selected.has(c.id));
    if (chosen.length === 0) return;
    const rows = chosen.map((c) => [c.name, c.description ?? '', c.nativeCountry?.name ?? '', c.nativeCurrency ?? '', c.email ?? '', c.website ?? '', c.contactName ?? '']);
    downloadSheet(`sales-channels-${chosen.length}`, [EXPORT_HEADERS, ...rows], 'xlsx');
    toast.success(`Exported ${chosen.length} sales channels`);
  };

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
        <button className="btn btn-ghost" onClick={() => setImportOpen(true)}><Upload size={16} /> Import</button>
        <AddButton label="Add sales channel" onClick={() => setEditing(null)} />
      </SectionHeader>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2">
          <span className="text-[13px] font-semibold text-teal-800">{selected.size} selected</span>
          <div className="mx-1 h-5 w-px bg-teal-200" />
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-medium text-n-700 hover:bg-n-50" onClick={exportSelected}><Download size={14} /> Export selected</button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-danger-bd bg-n-0 px-2.5 text-[12.5px] font-medium text-danger hover:bg-danger-bg" onClick={() => { if (confirm(`Remove ${selected.size} sales channels?`)) { [...selected].forEach((id) => del.mutate(id)); setSelected(new Set()); } }}><Trash2 size={14} /> Delete</button>
          <button className="ml-auto text-[12.5px] font-medium text-teal-700 hover:underline" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <RefTable<SalesChannel>
        loading={isLoading}
        empty="No sales channels yet."
        rows={data}
        selection={{ selected, toggleOne, toggleAll, allSelected }}
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
      {importOpen && (
        <SalesChannelImportModal channels={data} resolveCountryId={resolveCountryId} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); setSelected(new Set()); invalidate(); }} />
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

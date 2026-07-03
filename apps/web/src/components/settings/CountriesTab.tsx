import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, downloadSheet } from '@masquare/ui';
import { countriesApi, shippingServicesApi, type Country, type ShippingService } from '../../lib/api';
import { AddButton, SectionHeader } from './shared';
import { CountryImportModal } from './CountryImportModal';

const EXPORT_HEADERS = ['Country Name', 'ISO Code', 'Continent', 'EU VAT Zone', 'VAT Rate', 'Default Shipping Service'];

export function CountriesTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Country | null | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);

  const { data: countries = [], isLoading } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  const patchCountry = (updated: Country) =>
    qc.setQueryData<Country[]>(['countries'], (old) => (old ?? []).map((c) => (c.id === updated.id ? updated : c)));

  const setDefault = useMutation({
    mutationFn: ({ id, serviceId }: { id: string; serviceId: string | null }) => countriesApi.update(id, { defaultShippingServiceId: serviceId }),
    onSuccess: patchCountry,
  });
  const del = useMutation({
    mutationFn: (id: string) => countriesApi.remove(id),
    onSuccess: () => { toast.success('Country removed'); qc.invalidateQueries({ queryKey: ['countries'] }); },
  });

  const filtered = useMemo(
    () => countries.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.isoCode.toLowerCase().includes(q.toLowerCase())),
    [countries, q],
  );
  // Zone for a country's selected (default) shipping service — auto-correlated server-side.
  const defaultZoneName = (c: Country) =>
    c.defaultShippingServiceId ? c.shippingZones.find((z) => z.shippingServiceId === c.defaultShippingServiceId)?.zoneName ?? null : null;

  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected((prev) => { const n = new Set(prev); if (filtered.every((c) => n.has(c.id))) filtered.forEach((c) => n.delete(c.id)); else filtered.forEach((c) => n.add(c.id)); return n; });
  const toggleOne = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exportSelected = () => {
    const chosen = countries.filter((c) => selected.has(c.id));
    if (!chosen.length) return;
    const rows = chosen.map((c) => [c.name, c.isoCode, c.continent, c.euVatZone ? 'Yes' : 'No', c.vatRate, c.defaultShippingService?.name ?? '']);
    downloadSheet(`countries-${chosen.length}`, [EXPORT_HEADERS, ...rows], 'xlsx');
    toast.success(`Exported ${chosen.length} countries`);
  };
  const downloadTemplate = () =>
    downloadSheet('countries-template', [EXPORT_HEADERS, ['Example Country', 'XX', 'Europe', 'Yes', '20', 'Cyprus Postal Service'], ['Another Country', 'YY', 'Asia', 'No', '0', '']], 'xlsx');

  return (
    <div>
      <SectionHeader title="Countries" description="All world countries with EU VAT status, VAT rate, and default shipping service. Add shipping-service columns to map each country to a zone.">
        <button className="btn btn-ghost" onClick={downloadTemplate}><Download size={16} /> Template</button>
        <button className="btn btn-ghost" onClick={() => setImportOpen(true)}><Upload size={16} /> Import</button>
        <AddButton label="Add country" onClick={() => setEditing(null)} />
      </SectionHeader>

      <div className="mb-3 flex h-[38px] w-72 items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3">
        <Search size={16} className="text-n-400" />
        <input className="h-full flex-1 text-[13px] outline-none" placeholder="Search country or ISO code…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2">
          <span className="text-[13px] font-semibold text-teal-800">{selected.size} selected</span>
          <div className="mx-1 h-5 w-px bg-teal-200" />
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-medium text-n-700 hover:bg-n-50" onClick={exportSelected}><Download size={14} /> Export selected</button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-danger-bd bg-n-0 px-2.5 text-[12.5px] font-medium text-danger hover:bg-danger-bg" onClick={() => { if (confirm(`Remove ${selected.size} countries?`)) { [...selected].forEach((id) => del.mutate(id)); setSelected(new Set()); } }}><Trash2 size={14} /> Delete</button>
          <button className="ml-auto text-[12.5px] font-medium text-teal-700 hover:underline" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="border-b border-n-200 bg-n-25 px-3 py-3">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={allSelected} onChange={toggleAll} title="Select all" />
                </th>
                {['Country', 'ISO', 'Continent', 'EU VAT', 'VAT %', 'Default shipping', 'Shipping Zone'].map((h) => (
                  <th key={h} className="border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap">{h}</th>
                ))}
                <th className="border-b border-n-200 bg-n-25 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
              {filtered.map((c) => (
                <tr key={c.id} className={`hover:bg-teal-50 ${selected.has(c.id) ? 'bg-teal-50/60' : ''}`}>
                  <td className="border-b border-n-100 px-3 py-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} />
                  </td>
                  <td className="border-b border-n-100 px-4 py-2 text-[13.5px] font-medium text-n-800">{c.name}</td>
                  <td className="mono border-b border-n-100 px-4 py-2 text-[13px] text-n-700">{c.isoCode}</td>
                  <td className="border-b border-n-100 px-4 py-2 text-[13px] text-n-600">{c.continent}</td>
                  <td className="border-b border-n-100 px-4 py-2">
                    {c.euVatZone
                      ? <span className="tag border border-success-bd bg-success-bg text-success">Yes</span>
                      : <span className="tag border border-danger-bd bg-danger-bg text-danger">No</span>}
                  </td>
                  <td className="mono border-b border-n-100 px-4 py-2 text-[13px] text-n-700">{c.vatRate}%</td>
                  <td className="border-b border-n-100 px-3 py-2">
                    <select className="h-8 w-44 rounded border border-n-200 bg-n-0 px-1.5 text-[12.5px]" value={c.defaultShippingServiceId ?? ''} onChange={(e) => setDefault.mutate({ id: c.id, serviceId: e.target.value || null })}>
                      <option value="">—</option>
                      {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td className="border-b border-n-100 px-4 py-2">
                    {defaultZoneName(c)
                      ? <span className="inline-flex items-center rounded-pill bg-teal-50 px-2.5 py-0.5 text-[12px] font-medium text-teal-800">{defaultZoneName(c)}</span>
                      : <span className="text-[13px] text-n-400">—</span>}
                  </td>
                  <td className="border-b border-n-100 px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" onClick={() => setEditing(c)}><Pencil size={15} /></button>
                      <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => confirm(`Remove ${c.name}?`) && del.mutate(c.id)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-n-400">Showing <span className="mono">{filtered.length}</span> of <span className="mono">{countries.length}</span> countries.</p>

      {editing !== undefined && (
        <CountryModal country={editing} services={services} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); qc.invalidateQueries({ queryKey: ['countries'] }); }} />
      )}
      {importOpen && (
        <CountryImportModal countries={countries} services={services} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['countries'] }); }} />
      )}
    </div>
  );
}

function CountryModal({ country, services, onClose, onSaved }: { country: Country | null; services: ShippingService[]; onClose: () => void; onSaved: () => void }) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);
  const [form, setForm] = useState({
    name: country?.name ?? '',
    isoCode: country?.isoCode ?? '',
    continent: country?.continent ?? '',
    euVatZone: country?.euVatZone ?? false,
    vatRate: country?.vatRate?.toString() ?? '0',
    defaultShippingServiceId: country?.defaultShippingServiceId ?? '',
  });
  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); touch(); };
  const canSave = form.name.trim() && form.isoCode.trim() && form.continent.trim();

  const save = async () => {
    if (!canSave) { toast.error('Name, ISO code, and continent are required'); return; }
    setBusy(true);
    try {
      const body = { name: form.name, isoCode: form.isoCode, continent: form.continent, euVatZone: form.euVatZone, vatRate: Number(form.vatRate || 0), defaultShippingServiceId: form.defaultShippingServiceId || null };
      if (country) await countriesApi.update(country.id, body); else await countriesApi.create(body);
      toast.success('Saved');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell open title={country ? 'Edit country' : 'New country'} subtitle={country?.name} dirty={dirty}
      primaryLabel={country ? 'Save changes' : 'Create country'} onPrimary={save} primaryDisabled={!canSave} busy={busy} onClose={onClose}>
      <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
        <div className="col-span-2"><label className="label">Country name *</label><input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div><label className="label">ISO code *</label><input className="input mono" value={form.isoCode} onChange={(e) => set({ isoCode: e.target.value.toUpperCase() })} maxLength={3} placeholder="GB" /></div>
        <div><label className="label">Continent *</label><input className="input" value={form.continent} onChange={(e) => set({ continent: e.target.value })} placeholder="Europe" /></div>
        <div><label className="label">VAT rate %</label><input className="input mono" inputMode="decimal" value={form.vatRate} onChange={(e) => set({ vatRate: e.target.value })} /></div>
        <div className="flex items-end"><label className="flex cursor-pointer items-center gap-2.5 pb-2.5"><input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={form.euVatZone} onChange={(e) => set({ euVatZone: e.target.checked })} /><span className="text-[13.5px] text-n-700">In EU VAT zone</span></label></div>
        <div className="col-span-2"><label className="label">Default shipping service</label>
          <select className="input" value={form.defaultShippingServiceId} onChange={(e) => set({ defaultShippingServiceId: e.target.value })}>
            <option value="">—</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
    </ModalShell>
  );
}

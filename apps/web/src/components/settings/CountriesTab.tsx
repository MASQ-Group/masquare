import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { countriesApi, shippingServicesApi, type Country, type ShippingService } from '../../lib/api';
import { AddButton, SectionHeader } from './shared';

export function CountriesTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Country | null | undefined>(undefined);
  const [serviceCols, setServiceCols] = useState<string[]>([]);
  const [addColOpen, setAddColOpen] = useState(false);

  const { data: countries = [], isLoading } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  // Seed the visible shipping-service columns from existing per-country mappings.
  useEffect(() => {
    if (countries.length && serviceCols.length === 0) {
      const used = new Set<string>();
      countries.forEach((c) => c.shippingZones.forEach((z) => used.add(z.shippingServiceId)));
      if (used.size) setServiceCols([...used]);
    }
  }, [countries]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchCountry = (updated: Country) =>
    qc.setQueryData<Country[]>(['countries'], (old) => (old ?? []).map((c) => (c.id === updated.id ? updated : c)));

  const setDefault = useMutation({
    mutationFn: ({ id, serviceId }: { id: string; serviceId: string | null }) => countriesApi.update(id, { defaultShippingServiceId: serviceId }),
    onSuccess: patchCountry,
  });
  const setZone = useMutation({
    mutationFn: ({ id, serviceId, zoneId }: { id: string; serviceId: string; zoneId: string | null }) => countriesApi.setZone(id, serviceId, zoneId),
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
  const serviceById = (id: string) => services.find((s) => s.id === id);
  const availableToAdd = services.filter((s) => !serviceCols.includes(s.id));

  return (
    <div>
      <SectionHeader title="Countries" description="All world countries with EU VAT status, VAT rate, and default shipping service. Add shipping-service columns to map each country to a zone.">
        <AddButton label="Add country" onClick={() => setEditing(null)} />
      </SectionHeader>

      <div className="mb-3 flex h-[38px] w-72 items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3">
        <Search size={16} className="text-n-400" />
        <input className="h-full flex-1 text-[13px] outline-none" placeholder="Search country or ISO code…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                {['Country', 'ISO', 'Continent', 'EU VAT', 'VAT %', 'Default shipping'].map((h) => (
                  <th key={h} className="border-b border-n-200 bg-n-25 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap">{h}</th>
                ))}
                {serviceCols.map((sid) => (
                  <th key={sid} className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <select className="h-7 rounded border border-n-200 bg-n-0 px-1 text-[11px] font-semibold text-n-700" value={sid} onChange={(e) => setServiceCols((cols) => cols.map((c) => (c === sid ? e.target.value : c)))}>
                        {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <button className="grid h-5 w-5 place-items-center rounded text-n-400 hover:bg-n-100 hover:text-danger" title="Hide column" onClick={() => setServiceCols((cols) => cols.filter((c) => c !== sid))}><X size={12} /></button>
                    </div>
                  </th>
                ))}
                <th className="border-b border-n-200 bg-n-25 px-3 py-2">
                  <div className="relative">
                    <button className="inline-flex items-center gap-1 rounded border border-dashed border-n-300 px-2 py-1 text-[11px] font-medium text-n-500 hover:border-teal-400 hover:text-teal-600" onClick={() => setAddColOpen((v) => !v)} disabled={availableToAdd.length === 0}>
                      <Plus size={12} /> Column
                    </button>
                    {addColOpen && availableToAdd.length > 0 && (
                      <div className="absolute right-0 top-8 z-20 w-52 rounded-lg border border-n-200 bg-n-0 p-1 shadow-lg" onMouseLeave={() => setAddColOpen(false)}>
                        <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-n-500">Shipping service</div>
                        {availableToAdd.map((s) => (
                          <button key={s.id} className="flex w-full items-center rounded px-2 py-1.5 text-left text-[13px] text-n-700 hover:bg-teal-50" onClick={() => { setServiceCols((c) => [...c, s.id]); setAddColOpen(false); }}>{s.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7 + serviceCols.length} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-teal-50">
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
                    <select className="h-8 w-40 rounded border border-n-200 bg-n-0 px-1.5 text-[12.5px]" value={c.defaultShippingServiceId ?? ''} onChange={(e) => setDefault.mutate({ id: c.id, serviceId: e.target.value || null })}>
                      <option value="">—</option>
                      {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  {serviceCols.map((sid) => {
                    const svc = serviceById(sid);
                    const mapping = c.shippingZones.find((z) => z.shippingServiceId === sid);
                    return (
                      <td key={sid} className="border-b border-n-100 px-3 py-2">
                        <select className="h-8 w-32 rounded border border-n-200 bg-n-0 px-1.5 text-[12.5px]" value={mapping?.zoneId ?? ''} onChange={(e) => setZone.mutate({ id: c.id, serviceId: sid, zoneId: e.target.value || null })}>
                          <option value="">—</option>
                          {(svc?.zones ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                        </select>
                      </td>
                    );
                  })}
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

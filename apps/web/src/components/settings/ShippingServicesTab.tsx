import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { countriesApi, shippingServicesApi, type ShippingService } from '../../lib/api';
import { CountrySelect } from '../common/CountrySelect';
import { AddButton, RefTable, SectionHeader } from './shared';

const METHOD_LABEL: Record<string, string> = { actual_weight: 'Actual weight', volumetric_weight: 'Volumetric weight' };

export function ShippingServicesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ShippingService | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['shipping-services'] });
  const del = useMutation({ mutationFn: (id: string) => shippingServicesApi.remove(id), onSuccess: () => { toast.success('Removed'); invalidate(); } });

  return (
    <div>
      <SectionHeader title="Shipping Services" description="Couriers/services used to ship products, with zones, weight ranges, and charges.">
        <AddButton label="Add shipping service" onClick={() => setEditing(null)} />
      </SectionHeader>
      <RefTable<ShippingService>
        loading={isLoading}
        empty="No shipping services yet."
        rows={data}
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-n-800">{r.name}</span> },
          { key: 'alias', header: 'Alias', className: 'mono', render: (r) => r.alias ?? '—' },
          { key: 'method', header: 'Cost basis', render: (r) => <span className="tag border border-n-200 bg-n-100 text-n-600">{METHOD_LABEL[r.calcMethod]}</span> },
          { key: 'zones', header: 'Zones', render: (r) => r.zones.length },
          { key: 'rates', header: 'Weight ranges', render: (r) => r.zones.reduce((n, z) => n + (z.rates?.length ?? 0), 0) },
        ]}
        onEdit={setEditing}
        onDelete={(r) => confirm(`Remove ${r.name}?`) && del.mutate(r.id)}
      />
      {editing !== undefined && (
        <ShippingServiceModal service={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); invalidate(); }} />
      )}
    </div>
  );
}

type ZoneForm = { name: string; countryIds: string[] };
type RateForm = { zoneName: string; fromWeightKg: string; toWeightKg: string; chargeEur: string };

const TABS = [
  { key: 'service', label: 'Service' },
  { key: 'zones', label: 'Zones' },
  { key: 'rates', label: 'Weight ranges' },
];

function ShippingServiceModal({ service, onClose, onSaved }: { service: ShippingService | null; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState('service');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);
  const { data: countries = [] } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });
  const countryName = (id: string) => countries.find((c) => c.id === id)?.name ?? id;

  const [name, setName] = useState(service?.name ?? '');
  const [alias, setAlias] = useState(service?.alias ?? '');
  const [calcMethod, setCalcMethod] = useState<'actual_weight' | 'volumetric_weight'>(service?.calcMethod ?? 'actual_weight');
  const [zones, setZones] = useState<ZoneForm[]>(service?.zones.map((z) => ({ name: z.name, countryIds: z.countryIds })) ?? [{ name: 'Zone 1', countryIds: [] }]);
  const [rates, setRates] = useState<RateForm[]>(
    service?.zones.flatMap((z) => (z.rates ?? []).map((r) => ({ zoneName: z.name, fromWeightKg: String(r.fromWeightKg), toWeightKg: String(r.toWeightKg), chargeEur: String(r.chargeEur) }))) ?? [],
  );

  const zoneNames = useMemo(() => zones.map((z) => z.name).filter(Boolean), [zones]);
  const canSave = name.trim().length > 0;

  const save = async () => {
    if (!canSave) { setTab('service'); toast.error('Name is required'); return; }
    setBusy(true);
    try {
      const body = {
        name, alias: alias || undefined, calcMethod,
        zones: zones.filter((z) => z.name.trim()).map((z) => ({ name: z.name.trim(), countryIds: z.countryIds })),
        rates: rates.filter((r) => r.zoneName && r.fromWeightKg && r.toWeightKg).map((r) => ({
          zoneName: r.zoneName, fromWeightKg: Number(r.fromWeightKg), toWeightKg: Number(r.toWeightKg), chargeEur: Number(r.chargeEur || 0),
        })),
      };
      if (service) await shippingServicesApi.update(service.id, body); else await shippingServicesApi.create(body);
      toast.success('Saved');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell open title={service ? 'Edit shipping service' : 'New shipping service'} subtitle={service?.name}
      tabs={TABS} activeTab={tab} onTabChange={setTab} dirty={dirty}
      primaryLabel={service ? 'Save changes' : 'Create service'} onPrimary={save} primaryDisabled={!canSave} busy={busy} onClose={onClose}>
      {tab === 'service' && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="label">Cost calculation method</label>
            <div className="flex gap-2">
              {(['actual_weight', 'volumetric_weight'] as const).map((m) => (
                <button key={m} onClick={() => { setCalcMethod(m); touch(); }}
                  className={`h-10 flex-1 rounded-md border text-[13px] font-medium ${calcMethod === m ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:bg-n-50'}`}>
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <div><label className="label">Shipping service name *</label><input className="input" value={name} onChange={(e) => { setName(e.target.value); touch(); }} placeholder="Cyprus Postal Service" /></div>
          <div><label className="label">Alias</label><input className="input mono" value={alias} onChange={(e) => { setAlias(e.target.value); touch(); }} placeholder="CPS" /></div>
        </div>
      )}

      {tab === 'zones' && (
        <div className="flex flex-col gap-4">
          {zones.map((z, i) => (
            <div key={i} className="rounded-lg border border-n-200 p-3">
              <div className="mb-2 flex items-center gap-2">
                <input className="input flex-1" placeholder="Zone name (e.g. Zone 1)" value={z.name} onChange={(e) => { setZones((r) => r.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x)); touch(); }} />
                <button className="grid h-9 w-9 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setZones((r) => r.filter((_, idx) => idx !== i)); touch(); }}><Trash2 size={15} /></button>
              </div>
              <label className="label">Countries in this zone</label>
              <CountrySelect value={null} placeholder="Add a country…" onChange={(id) => { if (id) { setZones((r) => r.map((x, idx) => idx === i && !x.countryIds.includes(id) ? { ...x, countryIds: [...x.countryIds, id] } : x)); touch(); } }} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {z.countryIds.map((cid) => (
                  <span key={cid} className="inline-flex items-center gap-1 rounded-pill border border-teal-100 bg-teal-50 px-2.5 py-0.5 text-[12px] text-teal-800">
                    {countryName(cid)}
                    <button onClick={() => { setZones((r) => r.map((x, idx) => idx === i ? { ...x, countryIds: x.countryIds.filter((c) => c !== cid) } : x)); touch(); }} className="grid h-4 w-4 place-items-center rounded-full text-teal-600 hover:bg-teal-100"><X size={11} /></button>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div><button className="btn btn-ghost" onClick={() => { setZones((r) => [...r, { name: `Zone ${r.length + 1}`, countryIds: [] }]); touch(); }}><Plus size={16} /> Add zone</button></div>
        </div>
      )}

      {tab === 'rates' && (
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-n-400">Define weight ranges (kg) and their charge (€) per zone.</p>
          <div className="grid grid-cols-[1fr_100px_100px_110px_36px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-n-500 max-[560px]:hidden">
            <span>Zone</span><span>From (kg)</span><span>To (kg)</span><span>Charge (€)</span><span />
          </div>
          {rates.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_100px_100px_110px_36px] items-center gap-2 max-[560px]:grid-cols-1">
              <select className="input" value={r.zoneName} onChange={(e) => { setRates((x) => x.map((y, idx) => idx === i ? { ...y, zoneName: e.target.value } : y)); touch(); }}>
                <option value="">Zone…</option>
                {zoneNames.map((zn) => <option key={zn} value={zn}>{zn}</option>)}
              </select>
              <input className="input mono" inputMode="decimal" value={r.fromWeightKg} onChange={(e) => { setRates((x) => x.map((y, idx) => idx === i ? { ...y, fromWeightKg: e.target.value } : y)); touch(); }} />
              <input className="input mono" inputMode="decimal" value={r.toWeightKg} onChange={(e) => { setRates((x) => x.map((y, idx) => idx === i ? { ...y, toWeightKg: e.target.value } : y)); touch(); }} />
              <input className="input mono" inputMode="decimal" value={r.chargeEur} onChange={(e) => { setRates((x) => x.map((y, idx) => idx === i ? { ...y, chargeEur: e.target.value } : y)); touch(); }} />
              <button className="grid h-9 w-9 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" onClick={() => { setRates((x) => x.filter((_, idx) => idx !== i)); touch(); }}><Trash2 size={15} /></button>
            </div>
          ))}
          <div><button className="btn btn-ghost" onClick={() => { setRates((r) => [...r, { zoneName: zoneNames[0] ?? '', fromWeightKg: '', toWeightKg: '', chargeEur: '' }]); touch(); }}><Plus size={16} /> Add weight range</button></div>
        </div>
      )}
    </ModalShell>
  );
}

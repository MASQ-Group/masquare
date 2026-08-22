import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Ban, Eye, Gauge } from 'lucide-react';
import { Select } from '@masquare/ui';
import { brandsApi, integrationsApi, productTypesApi, repricingApi, vendorsApi, type RepricingStrategyPreset, type StrategyAssignResult } from '../../lib/api';

/**
 * Put SKUs on a named strategy.
 *
 * Two steps, never one: a strategy changes the margin every floor is solved against, so applying
 * one to a marketplace moves hundreds of prices at once. The preview names how many would change
 * and which are refused, before anything is written.
 */
export function StrategiesCard() {
  const qc = useQueryClient();
  const [presetId, setPresetId] = useState('');
  // Scope narrows by any combination: a marketplace, a brand, a vendor, a product type, or a
  // SKU. They compose, so "Beurer on UK" is one selection rather than a choice between two.
  const [scope, setScope] = useState('');
  const [brandId, setBrandId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [productTypeId, setProductTypeId] = useState('');
  const [q, setQ] = useState('');
  const [result, setResult] = useState<StrategyAssignResult | null>(null);

  const { data: presets = [] } = useQuery({ queryKey: ['repricing-strategies'], queryFn: repricingApi.strategies });
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list });
  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const { data: types = [] } = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });
  const markets = [...new Set(
    integrations.filter((i: any) => i.channelType === 'amazon' && i.marketplace).map((i: any) => i.marketplace as string),
  )].sort();

  const chosen = presets.find((p) => p.id === presetId);
  const pct = (v: string | number | null | undefined) => (v == null ? null : Number(v));

  const run = useMutation({
    mutationFn: (apply: boolean) =>
      repricingApi.assignStrategy({
        presetId,
        marketplace: scope || undefined,
        brandId: brandId || undefined,
        vendorId: vendorId || undefined,
        productTypeId: productTypeId || undefined,
        q: q.trim() || undefined,
        apply,
      }),
    onSuccess: (r) => {
      setResult(r);
      if (r.applied != null) {
        qc.invalidateQueries({ queryKey: ['repricing-sku-pricing'] });
        qc.invalidateQueries({ queryKey: ['repricing-quarantine'] });
      }
    },
  });

  // A preview is only about the scope it was run for; changing either makes it a stale answer.
  const reset = () => setResult(null);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
        <Gauge size={15} className="text-n-500" />
        <span className="text-[13px] font-semibold text-n-800">Pricing strategies</span>
        <span className="text-[11.5px] text-n-400">
          A strategy sets the margin every floor is solved against. Changing it makes stored floors stale.
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 px-4 py-3 max-[900px]:grid-cols-1">
        {presets.map((p) => (
          <PresetTile
            key={p.id}
            preset={p}
            selected={p.id === presetId}
            onSelect={() => { setPresetId(p.id); reset(); }}
            marginPct={pct(p.minMarginPct)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-n-100 bg-n-25 px-4 py-2.5">
        <span className="text-[12px] text-n-600">Apply to</span>
        <select
          value={scope}
          onChange={(e) => { setScope(e.target.value); reset(); }}
          className="h-8 rounded-lg border border-n-200 bg-n-0 px-2 text-[12.5px] text-n-700 outline-none focus:border-teal-400"
        >
          <option value="">All marketplaces</option>
          {markets.map((m) => <option key={m} value={m}>{m} only</option>)}
        </select>
        <div className="w-[170px]">
          <Select value={brandId} onChange={(v) => { setBrandId(v); reset(); }} placeholder="Any brand" searchable dense
            options={[{ value: '', label: 'Any brand' }, ...brands.map((b: any) => ({ value: b.id, label: b.name }))]} />
        </div>
        <div className="w-[170px]">
          <Select value={vendorId} onChange={(v) => { setVendorId(v); reset(); }} placeholder="Any vendor" searchable dense
            options={[{ value: '', label: 'Any vendor' }, ...vendors.map((v: any) => ({ value: v.id, label: v.name }))]} />
        </div>
        <div className="w-[170px]">
          <Select value={productTypeId} onChange={(v) => { setProductTypeId(v); reset(); }} placeholder="Any type" searchable dense
            options={[{ value: '', label: 'Any type' }, ...types.map((t: any) => ({ value: t.id, label: t.name }))]} />
        </div>
        <input
          className="input mono h-8 w-[160px] text-[12.5px]"
          placeholder="SKU or ASIN"
          value={q}
          onChange={(e) => { setQ(e.target.value); reset(); }}
        />

        <button
          onClick={() => run.mutate(false)}
          disabled={!presetId || run.isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          <Eye size={14} /> {run.isPending ? 'Checking…' : 'Preview'}
        </button>

        <button
          onClick={() => run.mutate(true)}
          disabled={!result?.preview || !result.wouldApply || run.isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
          title={result?.preview ? undefined : 'Preview first'}
        >
          <Check size={14} /> Apply to {result?.wouldApply ?? 0} SKUs
        </button>

        {!presetId && <span className="text-[11.5px] text-n-400">Choose a strategy above.</span>}
      </div>

      {result && (
        <div className="border-t border-n-100 px-4 py-3 text-[12.5px]">
          {result.error ? (
            <span className="text-danger">{result.error}</span>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                {result.applied != null ? (
                  <span className="font-semibold text-teal-700">
                    {result.applied} SKU{result.applied === 1 ? '' : 's'} moved to {chosen?.name}
                  </span>
                ) : (
                  <span className="font-semibold text-n-800">
                    {result.wouldApply} SKU{result.wouldApply === 1 ? '' : 's'} would move to {result.strategy}
                  </span>
                )}
                {result.refused.length > 0 && (
                  <span className="text-amber-700">{result.refused.length} refused</span>
                )}
              </div>

              {result.recomputeNeeded && (
                <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
                  Their floors were solved against the old margin and are now stale. Run Recompute for this scope.
                </div>
              )}

              {result.refused.length > 0 && (
                <div className="mt-2">
                  {/* Refused, not warned: at these margins the omitted costs exceed the margin, so the
                      SKU would sell at a loss the engine reports as a profit. */}
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">
                    Refused — floor not fully loaded
                  </div>
                  <div className="mt-1 max-h-[180px] overflow-auto">
                    {result.refused.slice(0, 100).map((r, i) => (
                      <div key={`${r.sku}-${r.marketplaceId}-${i}`} className="flex flex-wrap items-baseline gap-2 py-0.5">
                        <Ban size={12} className="shrink-0 text-amber-600" />
                        <span className="mono text-[11.5px] text-n-800">{r.sku}</span>
                        <span className="text-[11px] text-n-400">{r.marketplaceId}</span>
                        <span className="text-[11px] text-n-500">{r.reason}</span>
                      </div>
                    ))}
                  </div>
                  {result.refused.length > 100 && (
                    <div className="mt-1 text-[11.5px] text-n-400">Showing the first 100 of {result.refused.length}.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PresetTile({
  preset, selected, onSelect, marginPct,
}: { preset: RepricingStrategyPreset; selected: boolean; onSelect: () => void; marginPct: number | null }) {
  return (
    <button
      onClick={onSelect}
      className={`rounded-lg border px-3 py-2.5 text-left transition ${
        selected ? 'border-teal-400 bg-teal-50 shadow-sm' : 'border-n-200 bg-n-0 hover:border-n-300'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-n-800">{preset.name}</span>
        <span className="mono text-[12px] font-semibold text-n-700">
          {preset.strategy === 'MANUAL_ONLY' ? '—' : `${marginPct}%`}
        </span>
      </div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-n-500">{preset.description}</div>
      {preset.requiresLoadedFloor && (
        <div className="mt-1 text-[11px] font-medium text-amber-700">Needs a fully loaded floor</div>
      )}
    </button>
  );
}

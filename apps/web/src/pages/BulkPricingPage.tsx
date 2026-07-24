import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Boxes, Check, FileSpreadsheet, ListChecks, Store, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import {
  pricingApi, productsApi, salesChannelsApi, shippingServicesApi,
  type BulkPricingResult, type PricingGroup,
} from '../lib/api';
import { Flag } from '../components/common/Flag';

type Mode = 'specific' | 'vendor' | 'brand' | 'type';

const MODES: { key: Mode; label: string; desc: string; icon: typeof ListChecks }[] = [
  { key: 'specific', label: 'Specific products', desc: 'Hand-pick items from a list', icon: ListChecks },
  { key: 'vendor', label: 'By vendor', desc: 'All products of a vendor', icon: Store },
  { key: 'brand', label: 'By brand', desc: 'All products of a brand', icon: Tag },
  { key: 'type', label: 'By product type', desc: 'All of a product type', icon: Boxes },
];

const STEPS = ['Products', 'Channels', 'Profit Target', 'Results'];
const PRESETS = [10, 15, 18, 25];

const native = (v: number | null, ccy: string) =>
  v == null ? '—' : `${ccy} ${v.toLocaleString(undefined, { minimumFractionDigits: ccy === 'JPY' ? 0 : 2, maximumFractionDigits: ccy === 'JPY' ? 0 : 2 })}`;

export function BulkPricingPage() {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<Mode>('specific');
  const [productIds, setProductIds] = useState<Set<string>>(new Set());
  const [groupId, setGroupId] = useState('');
  const [channelIds, setChannelIds] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('18');
  /** Per-channel shipping service overrides. Absent = use that channel's country default. */
  const [serviceByChannel, setServiceByChannel] = useState<Record<string, string>>({});
  const [importPct, setImportPct] = useState('');
  const [q, setQ] = useState('');
  const [groupQ, setGroupQ] = useState('');
  const [result, setResult] = useState<BulkPricingResult | null>(null);

  const { data: productPage } = useQuery({
    queryKey: ['products', 'bulk-pricing', q],
    queryFn: () => productsApi.list({ q: q || undefined, pageSize: 100 }),
    enabled: mode === 'specific',
  });
  const products = productPage?.items ?? [];
  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });
  const { data: groups = [] } = useQuery({
    queryKey: ['pricing-groups', mode],
    queryFn: () => pricingApi.groups(mode as 'vendor' | 'brand' | 'type'),
    enabled: mode !== 'specific',
  });

  // What each chosen channel will ship with unless the user says otherwise.
  const chosenChannelIds = [...channelIds];
  const { data: shippingDefaults = [] } = useQuery({
    queryKey: ['pricing-channel-shipping-defaults', chosenChannelIds.slice().sort().join(',')],
    queryFn: () => pricingApi.channelShippingDefaults(chosenChannelIds),
    enabled: step >= 3 && chosenChannelIds.length > 0,
  });

  const groupNeedle = groupQ.trim().toLowerCase();
  const filteredGroups = groupNeedle
    ? groups.filter((g: PricingGroup) => g.name.toLowerCase().includes(groupNeedle))
    : groups;

  const selectedCount = mode === 'specific' ? productIds.size : groups.find((g: PricingGroup) => g.id === groupId)?.productCount ?? 0;

  const run = useMutation({
    mutationFn: () =>
      pricingApi.bulk({
        mode,
        productIds: mode === 'specific' ? [...productIds] : undefined,
        groupId: mode === 'specific' ? undefined : groupId,
        salesChannelIds: [...channelIds],
        targetMarginPct: Number(target),
        shippingServiceByChannel: Object.keys(serviceByChannel).length ? serviceByChannel : undefined,
        importPct: importPct.trim() === '' ? undefined : Number(importPct),
      }),
    onSuccess: (r) => { setResult(r); setStep(4); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not calculate prices'),
  });

  const stepValid = useMemo(() => {
    if (step === 1) return selectedCount > 0;
    if (step === 2) return channelIds.size > 0;
    if (step === 3) return Number(target) > 0;
    return true;
  }, [step, selectedCount, channelIds.size, target]);

  const footerHint =
    step === 1 ? `${selectedCount} product${selectedCount === 1 ? '' : 's'} selected`
    : step === 2 ? `${channelIds.size} channel${channelIds.size === 1 ? '' : 's'} selected`
    : step === 3 ? `Ready to calculate ${selectedCount * channelIds.size} prices`
    : 'Review and export the calculated prices';

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    apply(next);
  };

  const exportCsv = () => {
    if (!result) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = [
      'SKU', 'Product', 'Cost (EUR)',
      ...result.columns.map((c) => `${c.channelName} (${c.currency}${c.shippingServiceName ? `, ${c.shippingServiceName}` : ''})`),
    ];
    const body = result.rows.map((r) => [
      r.sku, r.title, r.costEur.toFixed(2),
      ...r.cells.map((c) => (c.priceNative == null ? '' : c.priceNative.toFixed(2))),
    ]);
    const csv = [head, ...body].map((row) => row.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulk-pricing-${result.targetMarginPct}pct.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Exported');
  };

  return (
    <div className="w-full">
      <div className="mb-4 flex items-start gap-4">
        <div className="flex-1">
          <div className="text-eyebrow text-n-500">PRICING</div>
          <h1 className="text-[22px] font-bold tracking-tight text-n-900">Bulk Pricing</h1>
          <p className="mt-1 text-[13px] text-n-500">
            Work out what to list a whole set of products at, on every channel, to hit a target margin.
          </p>
        </div>
        <div className="shrink-0 text-[13px] text-n-500">
          Step <strong className="text-n-900">{step}</strong> of 4
        </div>
      </div>

      {/* stepper */}
      <div className="card mb-5 px-2">
        <div className="flex">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const done = step > n;
            const current = step === n;
            return (
              <button
                key={label}
                onClick={() => n <= step && setStep(n)}
                disabled={n > step}
                className={`flex flex-1 items-center gap-2.5 border-b-2 px-2 py-3.5 text-left transition ${
                  current ? 'border-teal-500' : 'border-transparent'
                } ${n > step ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span
                  className={`mono grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[12px] font-bold ${
                    current || done ? 'border-teal-500 bg-teal-500 text-white' : 'border-n-300 bg-n-0 text-n-400'
                  }`}
                >
                  {done ? <Check size={13} /> : n}
                </span>
                <span className={`truncate text-[13px] font-semibold ${current ? 'text-n-900' : done ? 'text-n-600' : 'text-n-400'}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------- step 1 ---------------- */}
      {step === 1 && (
        <div className="card p-5">
          <h2 className="text-[15px] font-bold text-n-800">Which Products?</h2>
          <p className="mb-4 mt-0.5 text-[12.5px] text-n-500">Choose how to build the product set for this calculation.</p>

          <div className="grid grid-cols-4 gap-3 max-[860px]:grid-cols-2">
            {MODES.map((m) => {
              const on = mode === m.key;
              const Icon = m.icon;
              return (
                <button
                  key={m.key}
                  onClick={() => { setMode(m.key); setGroupId(''); setGroupQ(''); }}
                  className={`rounded-lg border p-3.5 text-left transition ${on ? 'border-teal-500 bg-teal-50/60' : 'border-n-200 bg-n-0 hover:border-n-300'}`}
                >
                  <span className={`mb-2.5 grid h-8 w-8 place-items-center rounded-md ${on ? 'bg-teal-500 text-white' : 'bg-n-100 text-n-500'}`}>
                    <Icon size={16} />
                  </span>
                  <div className="text-[13.5px] font-semibold text-n-900">{m.label}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-n-500">{m.desc}</div>
                </button>
              );
            })}
          </div>

          {mode === 'specific' ? (
            <div className="mt-5">
              <input
                className="input mb-3 w-72" placeholder="Search SKU or title…"
                value={q} onChange={(e) => setQ(e.target.value)}
              />
              <div className="overflow-hidden rounded-lg border border-n-200">
                <div className="flex items-center gap-3 border-b border-n-200 bg-n-25 px-4 py-2.5">
                  <input
                    type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]"
                    checked={products.length > 0 && products.every((p) => productIds.has(p.id))}
                    onChange={(e) => {
                      const next = new Set(productIds);
                      products.forEach((p) => (e.target.checked ? next.add(p.id) : next.delete(p.id)));
                      setProductIds(next);
                    }}
                  />
                  <span className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-n-500">Product</span>
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-n-500">Cost</span>
                </div>
                <div className="max-h-[380px] overflow-y-auto scrollbar-slim">
                  {products.map((p) => {
                    const on = productIds.has(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer items-center gap-3 border-b border-n-100 px-4 py-2.5 ${on ? 'bg-teal-50/50' : 'hover:bg-n-25'}`}
                      >
                        <input
                          type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]"
                          checked={on} onChange={() => toggle(productIds, p.id, setProductIds)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="code text-[12px] text-teal-700">{p.mainSku}</div>
                          <div className="truncate text-[13px] text-n-800">{p.title}</div>
                        </div>
                        <div className="shrink-0 text-[12.5px] text-n-500">{p.brand?.name ?? '—'}</div>
                        <div className="mono w-20 shrink-0 text-right text-[13px] font-semibold text-n-800">
                          {p.purchaseCost.amount != null ? `€${p.purchaseCost.amount.toFixed(2)}` : '—'}
                        </div>
                      </label>
                    );
                  })}
                  {!products.length && <div className="px-4 py-8 text-center text-[13px] text-n-400">No products match.</div>}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <label className="mb-2 block text-[12px] font-semibold text-n-600">
                {mode === 'vendor' ? 'Choose a vendor' : mode === 'brand' ? 'Choose a brand' : 'Choose a product type'}
              </label>
              <input
                className="input mb-3 w-72"
                placeholder={`Search ${mode === 'type' ? 'product types' : mode + 's'}…`}
                value={groupQ}
                onChange={(e) => setGroupQ(e.target.value)}
              />
              <div className="overflow-hidden rounded-lg border border-n-200">
                <div className="flex items-center gap-3 border-b border-n-200 bg-n-25 px-4 py-2.5">
                  <span className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-n-500">
                    {mode === 'vendor' ? 'Vendor' : mode === 'brand' ? 'Brand' : 'Product type'}
                  </span>
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-n-500">Products</span>
                </div>
                <div className="scrollbar-slim max-h-[380px] overflow-y-auto">
                  {filteredGroups.map((g: PricingGroup) => {
                    const on = groupId === g.id;
                    return (
                      <label
                        key={g.id}
                        className={`flex cursor-pointer items-center gap-3 border-b border-n-100 px-4 py-2.5 ${on ? 'bg-teal-50/50' : 'hover:bg-n-25'}`}
                      >
                        <input
                          type="radio"
                          name="pricing-group"
                          className="h-4 w-4 accent-[var(--teal-500)]"
                          checked={on}
                          onChange={() => setGroupId(g.id)}
                        />
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-n-800">{g.name}</span>
                        <span className="mono w-20 shrink-0 text-right text-[13px] text-n-500">{g.productCount}</span>
                      </label>
                    );
                  })}
                  {!filteredGroups.length && (
                    <div className="px-4 py-8 text-center text-[13px] text-n-400">
                      {groupQ.trim() ? `Nothing matches "${groupQ.trim()}".` : 'Nothing to choose from yet.'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- step 2 ---------------- */}
      {step === 2 && (
        <div className="card p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-[15px] font-bold text-n-800">Which Sales Channels?</h2>
              <p className="mt-0.5 text-[12.5px] text-n-500">Each selected channel becomes a column in the results.</p>
            </div>
            <button
              onClick={() => setChannelIds(channelIds.size === channels.length ? new Set() : new Set(channels.map((c) => c.id)))}
              className="h-8 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-600 hover:bg-n-25"
            >
              {channelIds.size === channels.length ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2.5 max-[1000px]:grid-cols-3 max-[720px]:grid-cols-2">
            {channels.map((c) => {
              const on = channelIds.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition ${on ? 'border-teal-500 bg-teal-50/60' : 'border-n-200 bg-n-0 hover:border-n-300'}`}
                >
                  <input
                    type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]"
                    checked={on} onChange={() => toggle(channelIds, c.id, setChannelIds)}
                  />
                  <Flag code={c.nativeCountry?.isoCode} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-n-900">{c.name}</div>
                    <div className="code text-[11px] text-n-500">{c.nativeCurrency ?? 'EUR'}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------------- step 3 ---------------- */}
      {step === 3 && (
        <div className="card p-6">
          <h2 className="text-[15px] font-bold text-n-800">Requested Profit Percentage</h2>
          <p className="mb-5 mt-0.5 text-[12.5px] text-n-500">
            The system solves the listing price on each channel so net profit reaches this margin, after that channel's
            tax, fee, shipping and import tax.
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative w-[190px]">
              <input
                className="input mono h-[58px] pr-11 text-right text-[28px] font-bold"
                inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)}
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[20px] font-bold text-n-400">%</span>
            </div>
            <div className="flex gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setTarget(String(p))}
                  className={`h-10 rounded-md border px-4 text-[13.5px] font-semibold transition ${
                    Number(target) === p ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:border-n-300'
                  }`}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 max-w-[320px]">
            <label className="mb-1.5 block text-[12px] font-semibold text-n-600">Import tax (%)</label>
            <input className="input mono text-right" inputMode="decimal" placeholder="0" value={importPct} onChange={(e) => setImportPct(e.target.value)} />
          </div>

          {/* Shipping service per channel — defaulted from each channel's own country */}
          <div className="mt-6">
            <div className="mb-1.5 flex items-baseline justify-between">
              <label className="text-[12px] font-semibold text-n-600">Shipping service per channel</label>
              {Object.keys(serviceByChannel).length > 0 && (
                <button className="text-[12px] font-semibold text-teal-700 hover:text-teal-800" onClick={() => setServiceByChannel({})}>
                  Reset to defaults
                </button>
              )}
            </div>
            <p className="mb-2.5 text-[11.5px] text-n-400">
              Each channel uses the default service set on its own country. Change one only if this run should price it differently.
            </p>
            <div className="overflow-hidden rounded-lg border border-n-200">
              <div className="flex items-center gap-3 border-b border-n-200 bg-n-25 px-4 py-2.5">
                <span className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-n-500">Sales channel</span>
                <span className="w-[240px] text-[12px] font-semibold uppercase tracking-wide text-n-500">Shipping service</span>
              </div>
              <div className="scrollbar-slim max-h-[300px] overflow-y-auto">
                {shippingDefaults.map((d) => {
                  const overridden = !!serviceByChannel[d.channelId];
                  return (
                    <div key={d.channelId} className="flex items-center gap-3 border-b border-n-100 px-4 py-2">
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <Flag code={d.countryIso} />
                        <span className="truncate text-[13.5px] font-medium text-n-800">{d.channelName}</span>
                        <span className="code shrink-0 text-[11px] text-n-400">{d.currency}</span>
                      </span>
                      <span className="w-[240px] shrink-0">
                        <Select
                          value={serviceByChannel[d.channelId] ?? d.defaultServiceId ?? ''}
                          onChange={(v) =>
                            setServiceByChannel((prev) => {
                              const next = { ...prev };
                              // Choosing the country default again is a reset, not an override.
                              if (!v || v === d.defaultServiceId) delete next[d.channelId];
                              else next[d.channelId] = v;
                              return next;
                            })
                          }
                          placeholder={d.defaultServiceId ? '— none' : '— no default for ' + (d.countryName ?? 'this country')}
                          options={services.map((sv) => ({ value: sv.id, label: sv.name }))}
                        />
                        <span className="mt-0.5 block text-[11px] text-n-400">
                          {overridden ? 'Overridden for this run' : d.defaultServiceName ? 'Country default' : 'No default set — shipping not priced'}
                        </span>
                      </span>
                    </div>
                  );
                })}
                {!shippingDefaults.length && (
                  <div className="px-4 py-6 text-center text-[13px] text-n-400">Loading channels…</div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Stat label="Products in set" value={selectedCount} />
            <Stat label="Channels" value={channelIds.size} />
            <Stat label="Prices to calculate" value={selectedCount * channelIds.size} accent />
          </div>
        </div>
      )}

      {/* ---------------- step 4 ---------------- */}
      {step === 4 && result && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-4 border-b border-n-100 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-bold text-n-800">Calculated Selling Prices</h2>
              <p className="mt-0.5 text-[12.5px] text-n-500">
                {result.productCount} products × {result.channelCount} channels · target margin {result.targetMarginPct}% ·
                prices in each channel currency.
              </p>
            </div>
            <button
              onClick={exportCsv}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-teal-500 px-3.5 text-[13px] font-semibold text-white hover:bg-teal-600"
            >
              <FileSpreadsheet size={15} /> Export
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} sticky left-0 z-10 bg-n-25 text-left`}>Product</th>
                  {result.columns.map((c) => (
                    <th key={c.channelId} className={`${TH} whitespace-nowrap text-right`}>
                      <span className="flex items-center justify-end gap-1.5">
                        <Flag code={c.countryIso} />
                        {c.channelName}
                      </span>
                      <span className="code block text-[10px] font-normal normal-case text-n-400">{c.currency}</span>
                      {/* Naming the service here is what makes a price reproducible elsewhere. */}
                      <span className="block text-[10px] font-normal normal-case text-n-400">{c.shippingServiceName ?? 'no shipping'}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.productId} className="hover:bg-n-25">
                    <td className={`${TD} sticky left-0 z-10 border-r border-n-100 bg-n-0`}>
                      <div className="code text-[11.5px] text-teal-700">{r.sku}</div>
                      <div className="max-w-[230px] truncate text-[13px] text-n-800">{r.title}</div>
                    </td>
                    {r.cells.map((cell, i) => (
                      <td
                        key={i}
                        className={`${TD} mono whitespace-nowrap text-right font-semibold ${cell.priceNative == null ? 'text-n-300' : 'text-n-900'}`}
                        title={cell.reason ?? undefined}
                      >
                        {cell.priceNative == null ? '—' : native(cell.priceNative, result.columns[i].currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-n-100 bg-n-25 px-5 py-3 text-[11.5px] text-n-500">
            A dash means the target margin is not reachable on that channel after tax and fees, or the product is missing
            the weight the shipping service charges on. Hover a dash for the reason. The channel fee is the standard rate
            from the channel's settings.
          </div>
        </div>
      )}

      {/* ---------------- footer ---------------- */}
      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          className="h-10 rounded-md border border-n-200 bg-n-0 px-4 text-[13px] font-semibold text-n-700 hover:bg-n-25 disabled:opacity-40"
        >
          ‹ Back
        </button>
        <div className="flex-1 text-[12.5px] text-n-500">{footerHint}</div>
        {step < 4 && (
          <button
            onClick={() => (step === 3 ? run.mutate() : setStep((s) => s + 1))}
            disabled={!stepValid || run.isPending}
            className="h-10 rounded-md bg-teal-500 px-5 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {run.isPending ? 'Calculating…' : step === 3 ? 'Calculate prices' : 'Continue'}
          </button>
        )}
        {step === 4 && (
          <button
            onClick={() => { setStep(1); setResult(null); }}
            className="h-10 rounded-md border border-n-200 bg-n-0 px-4 text-[13px] font-semibold text-n-700 hover:bg-n-25"
          >
            Start over
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="min-w-[170px] flex-1 rounded-lg border border-n-100 bg-n-25 px-4 py-3">
      <div className="text-[12px] font-semibold text-n-500">{label}</div>
      <div className={`mono mt-0.5 text-[22px] font-bold ${accent ? 'text-teal-600' : 'text-n-900'}`}>{value}</div>
    </div>
  );
}

const TH = 'border-b border-n-200 bg-n-25 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500';
const TD = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';

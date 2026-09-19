import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, ExternalLink, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { onbuyListingApi } from '../../lib/api';

/**
 * The OnBuy pieces of a product's channel plan: find the product in OnBuy's catalogue, suggest a
 * price, choose a delivery template, and check and list. The plan editor arranges them into its
 * steps; each piece only reads and writes what it is about.
 */

/** Step 1: OnBuy catalogue products carrying this product's barcode. */
export function OnbuyCandidates({ productId, integrationId, selectedOpc, onSelect }: {
  productId: string;
  integrationId: string;
  selectedOpc: string | null;
  onSelect: (opc: string, name: string) => void;
}) {
  const search = useMutation({
    mutationFn: () => onbuyListingApi.candidates(productId, integrationId),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not search OnBuy'),
  });
  const data = search.data;

  return (
    <div className="rounded-md border border-n-200 bg-n-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-n-600">OnBuy lists against its own catalogue product, found by this product’s barcode.</span>
        <div className="flex-1" />
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
          disabled={search.isPending}
          onClick={() => search.mutate()}
        >
          {search.isPending ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          {data ? 'Search again' : 'Search OnBuy'}
        </button>
      </div>

      {data && (
        <div className="mt-2 flex flex-col gap-1.5">
          <span className="text-[11.5px] text-n-500">
            Searched {data.codes.length ? data.codes.join(', ') : 'no barcode'}{data.mode === 'test' ? ' · OnBuy TEST account' : ''}
          </span>
          {data.message && <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">{data.message}</p>}
          {data.candidates.map((c) => {
            const picked = c.opc === selectedOpc;
            return (
              <div key={c.opc} className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 ${picked ? 'border-teal-300 bg-teal-50' : 'border-n-100'}`}>
                {c.thumbnailUrl && <img src={c.thumbnailUrl} alt="" className="h-10 w-10 shrink-0 rounded object-contain" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-n-800">{c.name || c.opc}</div>
                  <div className="text-[11.5px] text-n-500">
                    <span className="mono">{c.opc}</span> · barcode <span className="mono">{c.matchedCode}</span>
                    {c.url && (
                      <a href={c.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-teal-700 hover:underline">
                        view on OnBuy <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
                {picked ? (
                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-700"><Check size={13} /> Chosen</span>
                ) : (
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-semibold text-teal-700 hover:border-teal-300"
                    onClick={() => onSelect(c.opc, c.name)}
                  >
                    List on this
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Step 2: the price at the platform's launch margin, from the same cost model as everywhere else. */
export function OnbuyPriceSuggestion({ productId, integrationId, onUse }: {
  productId: string;
  integrationId: string;
  onUse: (price: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['onbuy', 'pricing', productId, integrationId],
    queryFn: () => onbuyListingApi.pricing(productId, integrationId),
  });
  if (isLoading) return <p className="text-[12px] text-n-500">Working out a price…</p>;
  if (!data) return null;
  const s = data.suggestion;

  return (
    <div className="rounded-md border border-n-200 bg-n-25 px-3 py-2.5 text-[12px]">
      {s?.priceNative != null ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-n-700">
            Suggested <span className="mono font-semibold text-n-900">{s.currency} {s.priceNative.toFixed(2)}</span> for a {s.targetMarginPct}% margin
            {s.profitEur != null && <> · profit €{s.profitEur.toFixed(2)}</>}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-teal-700 hover:border-teal-300"
            onClick={() => onUse(s.priceNative!.toFixed(2))}
          >
            Use this price
          </button>
        </div>
      ) : (
        <span className="text-n-600">No price could be suggested.</span>
      )}
      {s && (
        <div className="mt-1 text-[11.5px] text-n-500">
          Cost €{s.inputs.costEur.toFixed(2)} · shipping €{s.inputs.shippingEur.toFixed(2)}{s.inputs.shippingServiceName ? ` (${s.inputs.shippingServiceName})` : ''} · OnBuy fee {s.inputs.feePct}% · VAT {s.inputs.vatPct}%
        </div>
      )}
      {data.problems.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-[11.5px] text-amber-800">
          {data.problems.map((p) => <li key={p} className="flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {p}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Step 3: a delivery template from the seller account, chosen rather than typed. */
export function OnbuyDeliveryTemplateSelect({ integrationId, value, onChange }: {
  integrationId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['onbuy', 'delivery-templates', integrationId],
    queryFn: () => onbuyListingApi.deliveryTemplates(integrationId),
    staleTime: 5 * 60_000,
  });
  const templates = data?.templates ?? [];
  const chosen = templates.find((t) => t.id === value);
  // A plan from before templates were chosen here holds free text, which OnBuy cannot use.
  const stale = !!value && !isLoading && !chosen;

  return (
    <div className="flex flex-col gap-1">
      <Select
        dense
        value={chosen ? value : ''}
        onChange={onChange}
        options={[
          { value: '', label: isLoading ? 'Loading…' : templates.length ? 'Choose a template' : 'No templates on the account' },
          ...templates.map((t) => ({ value: t.id, label: `${t.name}${t.isDefault ? ' (default)' : ''}` })),
        ]}
      />
      <span className="text-[11px] text-n-400">
        {error
          ? 'Could not load the templates from OnBuy.'
          : stale
            ? `“${value}” is not a template on this account — choose one.`
            : chosen?.summary.slice(0, 2).join(' · ') || 'From the OnBuy seller account'}
      </span>
    </div>
  );
}

/** Step 4: what would be sent, what is missing, and the button that lists it. */
export function OnbuyListingPreview({ productId, integrationId, savePlan, onListed }: {
  productId: string;
  integrationId: string;
  /** Saves the form first, so the listing is built from what is on screen. */
  savePlan: () => Promise<unknown>;
  onListed: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const preview = useMutation({
    mutationFn: async () => { await savePlan(); return onbuyListingApi.preview(productId, integrationId); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not check the listing'),
  });
  const publish = useMutation({
    mutationFn: () => onbuyListingApi.publish(productId, integrationId),
    onSuccess: (r) => {
      setConfirming(false);
      if (r.ok) {
        toast.success(`Listed on OnBuy — ${r.sku} on ${r.opc}`);
        if (r.message) toast.warning(r.message, { duration: 12000 });
        onListed();
      } else {
        toast.error(r.message, { duration: 12000 });
      }
    },
    onError: (e: any) => { setConfirming(false); toast.error(e?.response?.data?.message ?? 'Could not list on OnBuy', { duration: 12000 }); },
  });

  const p = preview.data;
  const canList = !!p && p.missing.length === 0 && p.action === 'create' && p.liveWritesEnabled && !publish.isPending;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-n-200 bg-n-0 px-3 py-2.5 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-n-600">Checks the plan against OnBuy — the SKU, the product, and what would be sent. Nothing is listed until you confirm.</span>
        <div className="flex-1" />
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
          disabled={preview.isPending}
          onClick={() => { setConfirming(false); preview.mutate(); }}
        >
          {preview.isPending && <Loader2 size={13} className="animate-spin" />}
          {p ? 'Check again' : 'Check'}
        </button>
      </div>

      {p && (
        <>
          {p.listed && <p className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-teal-900">{p.listed}</p>}
          {p.refusal && <p className="rounded-md border border-danger-bd bg-danger-bg px-2.5 py-1.5 text-danger">{p.refusal}</p>}
          {p.identityNote && <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">{p.identityNote}</p>}
          {p.missing.length > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">Still needed: {p.missing.join(', ')}.</p>
          )}
          {!p.liveWritesEnabled && (
            <p className="rounded-md border border-n-200 bg-n-25 px-2.5 py-1.5 text-n-600">Live listing is switched off on this platform (Settings → General), so this can be checked but not sent.</p>
          )}
          <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-0.5 text-[12px]">
            <dt className="text-n-500">OnBuy product</dt><dd className="mono text-n-800">{p.input.opc ?? '—'}</dd>
            <dt className="text-n-500">SKU</dt><dd className="mono text-n-800">{p.input.sku ?? '—'}</dd>
            <dt className="text-n-500">Price</dt><dd className="mono text-n-800">{p.input.price != null ? `GBP ${p.input.price.toFixed(2)}` : '—'}</dd>
            <dt className="text-n-500">Stock</dt><dd className="mono text-n-800">{p.input.stock ?? 0}</dd>
            <dt className="text-n-500">Delivery template</dt><dd className="mono text-n-800">{p.input.deliveryTemplateId ?? '—'}</dd>
            <dt className="text-n-500">Handling · boost</dt><dd className="text-n-800">{p.input.handlingTimeDays ?? '—'} day(s) · {p.input.boostPct}%</dd>
          </dl>

          {canList && (
            confirming ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-2">
                <span className="flex-1 text-orange-900">This creates a live, buyable listing on OnBuy UK at GBP {p.input.price?.toFixed(2)} with {p.input.stock} in stock.</span>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={publish.isPending} onClick={() => publish.mutate()}>
                  {publish.isPending ? 'Listing…' : 'List it'}
                </button>
              </div>
            ) : (
              <div>
                <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>List on OnBuy</button>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

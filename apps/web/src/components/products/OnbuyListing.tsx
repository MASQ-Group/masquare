import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, ExternalLink, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { onbuyListingApi, type OnbuyCompetition } from '../../lib/api';
import { useConfirm } from '../ConfirmProvider';
import { ProductImage } from './ProductImage';

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
                {c.thumbnailUrl && <ProductImage src={c.thumbnailUrl} className="w-10 rounded border border-n-100" />}
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

/**
 * Step 1, when OnBuy does not have the product: choose the OnBuy category to create it in.
 *
 * Search, then remember: once a category is chosen for one product, it is suggested for the others
 * in the same internal category, so the rest are one click.
 */
export function OnbuyCreateCategory({ productId, integrationId, chosen, onChoose }: {
  productId: string;
  integrationId: string;
  chosen: { id: string | null; tree: string | null };
  onChoose: (id: string, tree: string) => void;
}) {
  const [q, setQ] = useState('');
  const { data: suggestion } = useQuery({
    queryKey: ['onbuy', 'category-suggestion', productId, integrationId],
    queryFn: () => onbuyListingApi.categorySuggestion(productId, integrationId),
  });
  const search = useMutation({
    mutationFn: () => onbuyListingApi.categories(integrationId, q),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not search OnBuy categories'),
  });
  const s = suggestion?.suggestion;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-n-200 bg-n-25 px-3 py-2.5 text-[12.5px]">
      <div className="font-semibold text-n-800">Create it on OnBuy</div>
      <p className="text-[12px] text-n-600">
        OnBuy has no product with this barcode, so it can be created from our marketplace content. Choose the OnBuy category it belongs in.
      </p>
      {chosen.id && (
        <div className="flex items-center gap-1.5 text-[12px] text-teal-800">
          <Check size={13} /> <span className="mono">{chosen.id}</span> · {chosen.tree}
        </div>
      )}
      {s && s.id !== chosen.id && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-[12px] text-teal-900">
          <span className="flex-1">Suggested — used for {s.uses} product{s.uses === 1 ? '' : 's'} in the same category: {s.tree}</span>
          <button type="button" className="inline-flex h-7 items-center rounded-md border border-teal-300 bg-n-0 px-2.5 font-semibold text-teal-700" onClick={() => onChoose(s.id, s.tree)}>
            Use it
          </button>
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) search.mutate(); }}>
        <input className="input h-8 flex-1 text-[12.5px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search OnBuy categories, e.g. massager" />
        <button type="submit" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 font-semibold text-n-700 hover:border-teal-300 disabled:opacity-50" disabled={search.isPending || q.trim().length < 2}>
          {search.isPending ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Search
        </button>
      </form>
      {search.data && (
        <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
          {search.data.categories.length === 0 && <span className="text-[12px] text-n-500">No OnBuy category that takes products matches that.</span>}
          {search.data.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`rounded-md border px-2.5 py-1.5 text-left text-[12px] ${c.id === chosen.id ? 'border-teal-300 bg-teal-50' : 'border-n-100 bg-n-0 hover:bg-n-50'}`}
              onClick={() => onChoose(c.id, c.tree || c.name)}
            >
              <span className="font-medium text-n-800">{c.name}</span>
              {c.tree && c.tree !== c.name && <span className="block text-[11px] text-n-500">{c.tree}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Step 4 for a new product: what would be created, the send, and its progress through OnBuy's queue. */
export function OnbuyCreatePreview({ productId, integrationId, savePlan, onChanged }: {
  productId: string;
  integrationId: string;
  savePlan: () => Promise<unknown>;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const preview = useQuery({
    queryKey: ['onbuy', 'create-preview', productId, integrationId],
    queryFn: () => onbuyListingApi.createPreview(productId, integrationId),
  });
  const recheck = async () => { await savePlan(); await preview.refetch(); };
  const create = useMutation({
    mutationFn: () => onbuyListingApi.create(productId, integrationId),
    onSuccess: (r) => {
      setConfirming(false);
      if (r.ok) toast.success('Sent to OnBuy — it usually takes under 30 minutes');
      else toast.error(r.message, { duration: 12000 });
      for (const p of r.imageProblems) toast.warning(p, { duration: 10000 });
      preview.refetch();
      onChanged();
    },
    onError: (e: any) => { setConfirming(false); toast.error(e?.response?.data?.message ?? 'Could not send to OnBuy', { duration: 12000 }); },
  });
  const progress = useMutation({
    mutationFn: () => onbuyListingApi.checkProgress(productId, integrationId),
    onSuccess: (r) => {
      if (r.status === 'LISTED') toast.success(r.message ?? 'Listed on OnBuy');
      else if (r.status === 'READY') toast.error(r.message ?? 'OnBuy could not create it', { duration: 12000 });
      else toast.info(r.message ?? 'Still waiting');
      preview.refetch();
      onChanged();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not ask OnBuy'),
  });

  const p = preview.data;
  if (preview.isLoading) return <p className="text-[12px] text-n-500">Loading…</p>;
  if (!p) return null;
  const waiting = p.queue.status === 'SUBMITTED';
  const canCreate = !waiting && !p.existing && p.missing.length === 0 && p.liveWritesEnabled && !create.isPending;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-n-200 bg-n-0 px-3 py-2.5 text-[12.5px]">
      {waiting ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-info-bd bg-info-bg px-2.5 py-2 text-info">
          <span className="flex-1">
            In OnBuy’s queue since {p.queue.submittedAt ? new Date(p.queue.submittedAt).toLocaleString() : '—'}. Checked automatically every 15 minutes.
            {p.queue.activationError && <span className="block text-orange-800">Created, but its price and stock have not been set yet: {p.queue.activationError}</span>}
          </span>
          <button type="button" className="btn btn-ghost" disabled={progress.isPending} onClick={() => progress.mutate()}>
            {progress.isPending ? 'Asking…' : 'Check progress'}
          </button>
        </div>
      ) : p.queue.status === 'LISTED' ? (
        <p className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-teal-900">
          Created and listed on OnBuy.{p.queue.productUrl && <> <a className="underline" href={p.queue.productUrl} target="_blank" rel="noreferrer">View it</a></>}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-n-600">Creates a new OnBuy product from our marketplace content, with our listing on it. Nothing is sent until you confirm.</span>
          <div className="flex-1" />
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 font-semibold text-n-700 hover:border-teal-300 disabled:opacity-50" disabled={preview.isFetching} onClick={recheck}>
            {preview.isFetching && <Loader2 size={13} className="animate-spin" />} Check again
          </button>
        </div>
      )}

      {p.queue.error && !waiting && <p className="rounded-md border border-danger-bd bg-danger-bg px-2.5 py-1.5 text-danger">Last attempt refused by OnBuy: {p.queue.error}</p>}
      {p.existing && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">
          OnBuy now has this product ({p.existing.opc}). Choose it in step 1 and list against it instead.
        </p>
      )}
      {p.note && <p className="text-[12px] text-amber-800">{p.note}</p>}
      {p.missing.length > 0 && !waiting && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">Still needed: {p.missing.join(', ')}.</p>
      )}
      {!p.liveWritesEnabled && <p className="text-[12px] text-n-500">Live listing is switched off on this platform, so this can be checked but not sent.</p>}

      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-0.5 text-[12px]">
        <dt className="text-n-500">Name</dt><dd className="text-n-800">{p.product.name ?? '—'}</dd>
        <dt className="text-n-500">Brand · barcode</dt><dd className="text-n-800">{p.product.brandName ?? '—'} · <span className="mono">{p.product.productCode ?? '—'}</span>{p.product.mpn ? <> · MPN <span className="mono">{p.product.mpn}</span></> : null}</dd>
        <dt className="text-n-500">Category</dt><dd className="mono text-n-800">{p.product.categoryId ?? '—'}</dd>
        <dt className="text-n-500">Description</dt><dd className="text-n-800">{p.product.description ? `${p.product.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)}…` : '—'}</dd>
        <dt className="text-n-500">Key features</dt><dd className="text-n-800">{p.product.summaryPoints.length ? `${Math.min(5, p.product.summaryPoints.length)} sent` : '—'}</dd>
        <dt className="text-n-500">Images</dt><dd className="text-n-800">{p.product.imageCount ? `${p.product.imageCount}, converted to OnBuy-sized JPEGs when sent` : '—'}</dd>
        <dt className="text-n-500">Listing</dt><dd className="text-n-800"><span className="mono">{p.listing.sku ?? '—'}</span> · GBP {p.listing.price?.toFixed(2) ?? '—'} · stock {p.listing.stock ?? 0} · template <span className="mono">{p.listing.deliveryTemplateId ?? '—'}</span></dd>
      </dl>

      {canCreate && (
        confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-2">
            <span className="flex-1 text-orange-900">
              This creates a public OnBuy product page from our content — the first seller’s content is what OnBuy shows, and it locks once others list on it — with our listing at GBP {p.listing.price?.toFixed(2)}.
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Sending…' : 'Create it'}
            </button>
          </div>
        ) : (
          <div><button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>Create on OnBuy</button></div>
        )
      )}
    </div>
  );
}

const gbp = (n: number | null | undefined) => (n == null ? '—' : `£${n.toFixed(2)}`);
const earn = (e: { profitEur: number | null; marginPct: number | null } | null) =>
  e && e.profitEur != null ? `profit €${e.profitEur.toFixed(2)} · ${e.marginPct?.toFixed(1)}%` : null;

/**
 * The price to beat on OnBuy, for our listings of this product.
 *
 * `live`: the listing is on sale, and choosing a price sends it to OnBuy after a confirmation.
 * `plan`: the listing is held at stock 0 for a price check, and choosing a price only fills the
 * plan's price — it is sent with the stock when the product is listed.
 */
export function OnbuyCompetitionView({ productId, integrationId, data, mode, onUse, onChanged }: {
  productId: string;
  integrationId: string;
  data: OnbuyCompetition;
  mode: 'live' | 'plan';
  onUse?: (price: string) => void;
  onChanged?: () => void;
}) {
  const confirm = useConfirm();
  const setPrice = useMutation({
    mutationFn: (v: { sku: string; price: number }) => onbuyListingApi.setPrice(productId, integrationId, v.sku, v.price),
    onSuccess: (r) => {
      if (r.ok) { toast.success(`OnBuy price set to £${r.price.toFixed(2)}`); onChanged?.(); } else toast.error(r.message, { duration: 12000 });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not set the price'),
  });
  const choose = async (sku: string, price: number, what: string, economics: string | null) => {
    if (mode === 'plan') { onUse?.(price.toFixed(2)); toast.success(`Price set to £${price.toFixed(2)} — sent when you list`); return; }
    const ok = await confirm({
      title: `Set ${sku} to £${price.toFixed(2)} on OnBuy?`,
      message: `${what}.${economics ? ` At this price: ${economics}.` : ''} The listing is live, so buyers see the new price straight away.`,
      confirmLabel: 'Set the price',
    });
    if (ok) setPrice.mutate({ sku, price });
  };

  if (!data.rows.length) return <p className="text-[12px] text-n-500">{data.message}</p>;

  return (
    <div className="flex flex-col gap-2">
      {data.rows.map((r) => (
        <div key={r.sku} className="rounded-md border border-n-100 px-2.5 py-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono font-semibold text-n-800">{r.sku}</span>
            {r.winning === true && <span className="tag bg-teal-50 text-teal-700">Winning</span>}
            {r.winning === false && <span className="tag bg-orange-50 text-orange-800">Not winning</span>}
            <span className="text-n-600">
              ours {gbp(r.price)}{r.deliveryPrice ? ` + ${gbp(r.deliveryPrice)} delivery` : ''}
              {earn(r.economics.price) && <span className="text-n-500"> · {earn(r.economics.price)}</span>}
            </span>
          </div>
          <div className="mt-1 text-n-700">
            {r.leadPrice != null
              ? <>Winning price <span className="mono font-semibold">{gbp(r.leadPrice)}</span> including delivery{r.leadDeliveryPrice ? ` (item ${gbp(r.leadItemPrice)} + delivery ${gbp(r.leadDeliveryPrice)})` : ''}.</>
              : <span className="text-n-500">{r.reason}</span>}
          </div>
          {(r.beat != null || r.match != null) && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {r.beat != null && (
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-teal-300 bg-teal-50 px-2.5 font-semibold text-teal-800 disabled:opacity-50"
                  disabled={setPrice.isPending || (mode === 'live' && !data.liveWritesEnabled)}
                  onClick={() => choose(r.sku, r.beat!, `A penny under the winning £${r.leadPrice!.toFixed(2)}`, earn(r.economics.beat))}
                >
                  Beat it: {gbp(r.beat)}
                  {earn(r.economics.beat) && <span className="font-normal text-teal-700"> · {earn(r.economics.beat)}</span>}
                </button>
              )}
              {r.match != null && (
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-n-200 bg-n-0 px-2.5 font-semibold text-n-700 disabled:opacity-50"
                  disabled={setPrice.isPending || (mode === 'live' && !data.liveWritesEnabled)}
                  onClick={() => choose(r.sku, r.match!, `The same as the winning £${r.leadPrice!.toFixed(2)}`, earn(r.economics.match))}
                >
                  Match it: {gbp(r.match)}
                  {earn(r.economics.match) && <span className="font-normal text-n-500"> · {earn(r.economics.match)}</span>}
                </button>
              )}
            </div>
          )}
          {r.economics.beat?.profitEur != null && r.economics.beat.profitEur < 0 && (
            <p className="mt-1 text-[11.5px] text-danger">Beating it loses money on this product.</p>
          )}
        </div>
      ))}
      {data.noEconomics && <p className="text-[11.5px] text-n-500">No margin shown: this OnBuy connection is not linked to a sales channel.</p>}
    </div>
  );
}

/** For a product already on sale on OnBuy: check the price to beat, and change ours. */
export function OnbuyCompetition({ productId, integrationId, onChanged }: { productId: string; integrationId: string; onChanged?: () => void }) {
  const check = useMutation({
    mutationFn: () => onbuyListingApi.competition(productId, integrationId),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not check OnBuy'),
  });
  return (
    <div className="flex flex-col gap-2 rounded-md border border-n-200 bg-n-0 px-3 py-2.5 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-n-600">The price to beat on OnBuy, and what we would earn at it.</span>
        <div className="flex-1" />
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 font-semibold text-n-700 hover:border-teal-300 disabled:opacity-50"
          disabled={check.isPending}
          onClick={() => check.mutate()}
        >
          {check.isPending && <Loader2 size={13} className="animate-spin" />}
          {check.data ? 'Check again' : 'Check the winning price'}
        </button>
      </div>
      {check.data && (
        <OnbuyCompetitionView productId={productId} integrationId={integrationId} data={check.data} mode="live" onChanged={() => { check.mutate(); onChanged?.(); }} />
      )}
    </div>
  );
}

/**
 * Before going live: place the listing on OnBuy at stock 0 — nobody can buy it — so OnBuy will say
 * the price to beat. The chosen price fills the plan and is sent with the stock when it is listed.
 */
export function OnbuyPriceCheck({ productId, integrationId, savePlan, onUse, onChanged }: {
  productId: string;
  integrationId: string;
  savePlan: () => Promise<unknown>;
  onUse: (price: string) => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [data, setData] = useState<OnbuyCompetition | null>(null);
  const stage = useMutation({
    mutationFn: async () => { await savePlan(); return onbuyListingApi.priceCheck(productId, integrationId); },
    onSuccess: (r) => {
      if (r.ok) { setData(r.competition); onChanged(); } else toast.error(r.message, { duration: 12000 });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not check the price on OnBuy', { duration: 12000 }),
  });
  const recheck = useMutation({
    mutationFn: () => onbuyListingApi.competition(productId, integrationId),
    onSuccess: setData,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not check OnBuy'),
  });

  const start = async () => {
    const ok = await confirm({
      title: 'Place the listing on OnBuy at stock 0?',
      message: 'OnBuy only says the price to beat for a listing we have. This places ours with the price saved here and ZERO stock, so nobody can buy it — on your default OnBuy delivery template until you choose one in step 3. Every stock push leaves it alone; it goes on sale only when you list it in step 4.',
      confirmLabel: 'Place it at stock 0',
    });
    if (ok) stage.mutate();
  };

  return (
    <div className="rounded-md border border-n-200 bg-n-25 px-3 py-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-n-600">See OnBuy’s winning price before going live. Needs a provisional price; until you choose a delivery template in step 3, OnBuy uses your account’s default.</span>
        {data ? (
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border border-n-200 bg-n-0 px-2.5 font-semibold text-n-700 disabled:opacity-50" disabled={recheck.isPending} onClick={() => recheck.mutate()}>
            {recheck.isPending && <Loader2 size={12} className="animate-spin" />} Check again
          </button>
        ) : (
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border border-teal-300 bg-n-0 px-2.5 font-semibold text-teal-700 disabled:opacity-50" disabled={stage.isPending} onClick={start}>
            {stage.isPending && <Loader2 size={12} className="animate-spin" />} Check OnBuy’s winning price
          </button>
        )}
      </div>
      {data && (
        <div className="mt-2">
          <OnbuyCompetitionView productId={productId} integrationId={integrationId} data={data} mode="plan" onUse={onUse} />
          <p className="mt-1 text-[11.5px] text-n-500">Held on OnBuy at stock 0. A new listing can take a few minutes before OnBuy reports on it — check again if nothing shows.</p>
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
  const canList = !!p && p.missing.length === 0 && (p.action === 'create' || p.action === 'activate') && p.liveWritesEnabled && !publish.isPending;

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
          {p.listed && <OnbuyCompetition productId={productId} integrationId={integrationId} onChanged={onListed} />}
          {p.action === 'activate' && (
            <p className="rounded-md border border-info-bd bg-info-bg px-2.5 py-1.5 text-info">Held on OnBuy at stock 0 from the price check. Listing it sends the price and stock below.</p>
          )}
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
                <span className="flex-1 text-orange-900">This {p.action === 'activate' ? 'puts the held listing on sale' : 'creates a live, buyable listing'} on OnBuy UK at GBP {p.input.price?.toFixed(2)} with {p.input.stock} in stock.</span>
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

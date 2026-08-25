import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Edit3, ExternalLink, Package, RefreshCw, Search } from 'lucide-react';
import { amazonListingApi, listingApi, salesTransactionsApi, type AmazonSweep, channelListingsApi } from '../lib/api';
import { DateRangePicker, ProgressButton, type DateRangeValue } from '@masquare/ui';
import { formatAmount } from '../lib/format';
import { Flag } from '../components/common/Flag';
import { useJobProgress } from '../lib/useJobProgress';
import { ListOnChannelModal } from '../components/channel-listings/ListOnChannelModal';
import { NotListedPanel } from '../components/channel-listings/NotListedPanel';
import { PageHeader } from '../components/common/PageHeader';

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  live: { label: 'Live', color: '#0E7A73', bg: '#E1F3F1' },
  low: { label: 'Low stock', color: '#B4791E', bg: '#FBF1DE' },
  oos: { label: 'Out of stock', color: '#C63B1B', bg: '#FBE7E1' },
  paused: { label: 'Paused', color: '#5A665F', bg: '#EEF1F0' },
  error: { label: 'Error', color: '#C63B1B', bg: '#FBE7E1' },
};
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} d ago`;
};
const money = (v: number | null, ccy: string | null) => (v == null ? '—' : formatAmount(v, ccy || 'GBP'));
const eur = (v: number | null) => (v == null ? '—' : formatAmount(v, 'EUR'));
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);

export function ChannelListingDetailPage() {
  const { productId = '' } = useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['channel-listing-detail', productId], queryFn: () => channelListingsApi.detail(productId) });

  // Whether a channel CAN be listed on is a different question from what it currently sells, so it
  // comes from the listing module rather than the listings snapshot this page is built on.
  const { data: plans } = useQuery({
    queryKey: ['listing', 'product-channels', productId],
    queryFn: () => listingApi.productChannels(productId as string),
    enabled: !!productId,
  });
  const planByIntegration = new Map((plans?.channels ?? []).map((c) => [c.integrationId, c]));

  // The competitive read costs two live calls per candidate marketplace, so it is asked for.
  const analysis = useJobProgress(`listing.amazon.sweep.${productId}`);
  const sweepResult = analysis.result as AmazonSweep | null;
  const sweepByIntegration = new Map((sweepResult?.results ?? []).map((r) => [r.integrationId, r]));

  const [listing, setListing] = useState<{ integrationId: string; name: string } | null>(null);

  // Real performance, from booked sales. Keyed by SKU because that is what a sale records.
  // Empty means the default twelve months, which is what makes a stale import legible rather than
  // showing eight blank weeks. The presets and custom range come from the platform's own picker.
  const [range, setRange] = useState<DateRangeValue>({ from: '', to: '' });
  const metrics = useQuery({
    queryKey: ['product-sales-metrics', data?.sku, range.from, range.to],
    queryFn: () => salesTransactionsApi.productMetrics(data!.sku, range),
    enabled: !!data?.sku,
    placeholderData: (prev) => prev,
  });

  if (isLoading) return <div className="card p-10 text-center text-[13px] text-n-500">Loading…</div>;
  if (!data) return <div className="card p-10 text-center text-[13px] text-n-500">Product not found.</div>;

  const listedChannels = data.channels.filter((c) => c.listed);
  const maxPrice = Math.max(1, ...listedChannels.map((c) => c.price ?? 0));

  // Placeholder KPIs (real metrics wire up later).
  // Real figures from booked sales. Buy Box win rate is deliberately absent: nothing in the
  // platform records whether we held the Buy Box, so it could only ever have been invented.
  const m = metrics.data;
  /** Whole euros, for the headline figures. The module-level `eur` handles nullable amounts. */
  const eurWhole = (v: number) => `€${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
  const soldAgo = m?.lastSoldAt
    ? Math.floor((Date.now() - new Date(m.lastSoldAt).getTime()) / 86_400_000)
    : null;

  const kpis = [
    { label: 'Units live', value: String(data.unitsLive), sub: `across ${data.listedCount} channels` },
    {
      label: 'Units sold',
      value: m ? String(m.unitsSold) : '—',
      // The window is stated rather than assumed: "148" means nothing without it.
      sub: m ? `last 12 months · ${m.orders} order${m.orders === 1 ? '' : 's'}` : 'loading',
    },
    {
      label: 'Revenue',
      value: m ? eurWhole(m.revenueEur) : '—',
      sub: 'net of channel fees',
    },
    {
      label: 'Profit',
      value: m ? eurWhole(m.profitEur) : '—',
      sub: m && m.revenueEur > 0 ? `${Math.round((m.profitEur / m.revenueEur) * 1000) / 10}% margin` : 'after all costs',
    },
    {
      label: 'Avg. sell price',
      value: m?.avgSellPriceEur != null ? `€${m.avgSellPriceEur.toFixed(2)}` : '—',
      sub: 'weighted by units',
    },
    {
      label: 'Return rate',
      value: m?.returnRatePct != null ? `${m.returnRatePct}%` : '—',
      sub: m ? `${m.returnedUnits} of ${m.unitsSold} units` : 'no sales yet',
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <PageHeader
        module="Sales channels"
        moduleHref="/channel-listings"
        title={data.title}
        actions={
          <>
            {/* Two live calls per candidate marketplace, so it is a job with progress rather than
                something that happens on page load. */}
            <ProgressButton
              running={analysis.running}
              value={analysis.value}
              detail={analysis.detail}
              onClick={() => analysis.start(() => amazonListingApi.sweep(productId as string, true))}
              runningLabel={<><Search size={15} /> Checking</>}
              className="!h-8 !text-[13px]"
              title="Searches every Amazon marketplace and works out whether we could win the Buy Box at a profit. Read-only."
            >
              <Search size={15} /> Check all Amazon channels
            </ProgressButton>
            <button
              onClick={() => { qc.invalidateQueries({ queryKey: ['channel-listing-detail', productId] }); toast.success('Refreshed'); }}
              className="hbtn"
            >
              <RefreshCw size={15} /> Refresh
            </button>
          </>
        }
        primary={<Link to={`/products?edit=${productId}`} className="hbtn-primary"><Edit3 size={15} /> Edit product</Link>}
      />

      {/* Identity and stock at a glance. The title used to repeat here under the breadcrumb; it
          now lives in the header alone, so this card carries only what the header cannot. */}
      <div className="card flex flex-wrap items-start gap-5 p-5">
        <div className="grid h-[84px] w-[84px] flex-none place-items-center rounded-xl border border-n-100 bg-n-50 text-n-300"><Package size={38} /></div>
        <div className="min-w-[280px] flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="code rounded-md px-2 py-0.5 text-[12.5px] text-teal-700" style={{ background: '#E8F4F2' }}>{data.sku}</span>
            {data.brand && <span className="text-[12.5px] text-n-500">{data.brand}</span>}
            <span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ color: '#B4791E', background: '#FBF1DE' }}>Listed on {data.listedCount}/{data.channelCount} channels</span>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-4 text-[13px] text-n-500">
            <span>Master stock <strong className="font-semibold text-n-900">{data.masterStock ?? '—'}</strong></span>
            <span>Units live <strong className="font-semibold text-n-900">{data.unitsLive}</strong></span>
            <span>Last synced <strong className="font-semibold text-n-900">{ago(data.lastSyncedAt)}</strong></span>
          </div>
        </div>
      </div>

      {analysis.error && (
        <div className="mt-4 rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger">{analysis.error}</div>
      )}
      {sweepResult && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-n-200 bg-n-25 px-3.5 py-2.5 text-[12.5px]">
          <span className="font-semibold text-n-800">Checked {sweepResult.summary.searched} Amazon marketplaces</span>
          <span className="text-teal-700"><b>{sweepResult.summary.alreadyListed}</b> already listed</span>
          <span className="text-green-700"><b>{sweepResult.summary.competitive}</b> worth listing on</span>
          {sweepResult.summary.uncompetitive > 0 && (
            <span className="text-danger"><b>{sweepResult.summary.uncompetitive}</b> can't compete</span>
          )}
          {sweepResult.summary.restricted > 0 && (
            <span className="text-danger"><b>{sweepResult.summary.restricted}</b> need approval</span>
          )}
          {sweepResult.summary.notFound > 0 && (
            <span className="text-n-500"><b>{sweepResult.summary.notFound}</b> not in the catalogue</span>
          )}
        </div>
      )}

      {listing && (
        <ListOnChannelModal
          productId={productId as string}
          integrationId={listing.integrationId}
          channelName={listing.name}
          onClose={() => {
            setListing(null);
            qc.invalidateQueries({ queryKey: ['channel-listing-detail', productId] });
          }}
        />
      )}

      {/* KPI row (placeholder) */}
      <div className="mt-3 mb-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-n-400">
        <span className="text-[13px] font-semibold text-n-800">Performance</span>
        <div className="w-[240px]">
          <DateRangePicker
            value={range}
            onChange={setRange}
            clearable
            placeholder="Last 12 months"
          />
        </div>
        <span>from booked sales across every channel</span>
        {/* A zero is ambiguous without this: "nobody wants it" and "nothing imported lately" look
            the same, and they call for opposite responses. */}
        {metrics.isFetching && <span className="text-n-400">updating…</span>}
        {m && (m.lastSoldAt
          ? <span className="text-n-500">Last sold {new Date(m.lastSoldAt).toLocaleDateString('en-GB')}{soldAgo != null && soldAgo > 45 ? ` · ${soldAgo} days ago` : ''}</span>
          : <span className="text-amber-700">Never sold</span>)}
      </div>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        {kpis.map((k) => (
          <div key={k.label} className="card p-4">
            <div className="flex items-center justify-between"><span className="text-[12px] font-semibold text-n-500">{k.label}</span></div>
            <div className="mono mt-2 text-[22px] font-bold text-n-900">{k.value}</div>
            <div className="mt-1 text-[11px] text-n-400">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* per-channel breakdown (real) */}
      <div className="mt-6">
        <div className="flex items-baseline gap-2.5">
          <div className="text-[16px] font-bold text-n-900">Listing by channel</div>
          <div className="text-[12.5px] text-n-400">Price, stock and status on each connected channel</div>
        </div>
        <div className="mt-3 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
          {data.channels.map((c) => {
            const st = c.status ? STATUS[c.status] ?? STATUS.live : null;
            return (
              <div key={c.integrationId} className="card overflow-hidden p-0" style={c.loss ? { borderColor: '#F0B3A2' } : undefined}>
                <div className="flex items-center gap-2.5 border-b border-n-100 px-4 py-3.5">
                  <Flag code={c.countryIso} />
                  <span className="flex-1 text-[14.5px] font-bold text-n-900">{c.name}</span>
                  {c.listed && st
                    ? <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ color: st.color, background: st.bg }}>{st.label}</span>
                    : <span className="rounded-full px-2.5 py-1 text-[11px] font-bold text-n-500" style={{ background: '#EEF1F0' }}>Not listed</span>}
                </div>
                {c.listed ? (
                  <div className="p-4">
                    {/* Quantity leads — it's the number that syncs across channels — with price beside it. */}
                    <div className="flex items-end justify-between gap-2.5">
                      <div>
                        <div className="text-[11px] font-semibold text-n-400">Quantity</div>
                        <div className="mono text-[28px] font-bold leading-none" style={{ color: c.status === 'oos' || c.status === 'low' ? '#B4791E' : '#16211F' }}>{c.quantity ?? '—'}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-semibold text-n-400">Live price</div>
                        <div className="mono text-[18px] font-bold text-n-700">{money(c.price, c.priceCurrency ?? c.currency)}</div>
                      </div>
                    </div>
                    {c.profitEur != null && (
                      <div className={`mt-3 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-bold ${c.loss ? 'bg-[#FBE7E1] text-[#C63B1B]' : 'bg-[#E1F3F1] text-[#0E7A73]'}`}>
                        {c.loss && <AlertTriangle size={14} />}
                        <span>{c.loss ? 'Loss at this price' : 'Est. profit'}</span>
                        <span className="mono">{eur(c.profitEur)}</span>
                        <span className="opacity-40">·</span>
                        <span className="mono">{pct(c.marginPct)} margin</span>
                      </div>
                    )}
                    <div className="mt-4 grid grid-cols-2 gap-x-3.5 gap-y-2.5 border-t border-n-100 pt-3.5">
                      {([
                        ['Fulfilment', c.fulfilmentChannel ?? '—'],
                        ['Est. profit (EUR)', eur(c.profitEur)],
                        ['Margin', pct(c.marginPct)],
                        ['Units sold', String(m?.byChannel.find((b) => b.name === c.name)?.units ?? 0)],
                      ] as const).map(([label, val]) => (
                        <div key={label}>
                          <div className="text-[11px] font-semibold text-n-400">{label}</div>
                          <div className="mono mt-0.5 text-[14px] font-semibold text-n-900">{val}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3.5 flex items-center gap-2">
                      <button className="h-[34px] flex-1 rounded-md border border-n-200 bg-n-0 text-[12.5px] font-semibold text-n-700 hover:bg-n-50" title="Coming with push sync">Edit price</button>
                      {c.integrationId && <a className="inline-flex h-[34px] items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:bg-n-50" href="#" onClick={(e) => e.preventDefault()}><ExternalLink size={14} /> View</a>}
                    </div>
                  </div>
                ) : (
                  <NotListedPanel
                    channelName={c.name}
                    integrationId={c.integrationId ?? null}
                    plan={c.integrationId ? planByIntegration.get(c.integrationId) ?? null : null}
                    sweep={c.integrationId ? sweepByIntegration.get(c.integrationId) ?? null : null}
                    analysed={!!analysis.result}
                    onList={(integrationId) => setListing({ integrationId, name: c.name })}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* charts (placeholder) */}
      <div className="mt-6 grid gap-4" style={{ gridTemplateColumns: '1fr 1.2fr' }}>
        <div className="card p-5">
          <div className="text-[15px] font-bold text-n-900">Price comparison</div>
          <div className="mt-0.5 text-[12.5px] text-n-400">Live price per channel (native)</div>
          <div className="mt-4 flex flex-col gap-3.5">
            {listedChannels.map((c) => (
              <div key={c.integrationId}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Flag code={c.countryIso} />
                  <span className="flex-1 text-[13px] font-semibold text-n-900">{c.name}</span>
                  <span className="mono text-[13px] font-bold text-n-900">{money(c.price, c.priceCurrency ?? c.currency)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-n-100"><div className="h-full rounded-full" style={{ width: `${((c.price ?? 0) / maxPrice) * 100}%`, background: c.color }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-baseline gap-2.5">
            <div className="text-[15px] font-bold text-n-900">Units sold by channel</div>
            <div className="text-[12.5px] text-n-400">Last 12 months</div>
          </div>
          {!m || m.byChannel.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-n-400">
              {m ? 'No sales recorded for this product.' : 'Loading…'}
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {m.byChannel.map((c) => {
                const max = Math.max(...m.byChannel.map((x: { units: number }) => x.units));
                return (
                  <div key={c.name} className="flex items-center gap-2.5">
                    <span className="w-[130px] shrink-0 truncate text-[12.5px] text-n-600">{c.name}</span>
                    <div className="h-[18px] flex-1 overflow-hidden rounded bg-n-100">
                      <div className="h-full rounded bg-teal-500" style={{ width: `${max > 0 ? (c.units / max) * 100 : 0}%` }} />
                    </div>
                    <span className="mono w-[52px] shrink-0 text-right text-[12.5px] tabular-nums text-n-700">{c.units}</span>
                    <span className="mono w-[80px] shrink-0 text-right text-[12px] tabular-nums text-n-500">€{Math.round(c.revenueEur).toLocaleString('en-GB')}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

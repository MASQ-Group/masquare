import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Edit3, ExternalLink, Package, RefreshCw } from 'lucide-react';
import { channelListingsApi } from '../lib/api';
import { formatAmount } from '../lib/format';
import { Flag } from '../components/common/Flag';

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
const Sample = () => <span className="ml-2 rounded-full bg-n-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-n-400">Sample</span>;

export function ChannelListingDetailPage() {
  const { productId = '' } = useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['channel-listing-detail', productId], queryFn: () => channelListingsApi.detail(productId) });

  if (isLoading) return <div className="card p-10 text-center text-[13px] text-n-500">Loading…</div>;
  if (!data) return <div className="card p-10 text-center text-[13px] text-n-500">Product not found.</div>;

  const listedChannels = data.channels.filter((c) => c.listed);
  const maxPrice = Math.max(1, ...listedChannels.map((c) => c.price ?? 0));

  // Placeholder KPIs (real metrics wire up later).
  const kpis = [
    { label: 'Units live', value: String(data.unitsLive), sub: `across ${data.listedCount} channels`, real: true },
    { label: 'Units sold (30d)', value: '148', sub: 'all channels', real: false },
    { label: 'Revenue (30d)', value: '£182.4k', sub: 'net of channel fees', real: false },
    { label: 'Avg. sell price', value: '£1,232', sub: 'weighted', real: false },
    { label: 'Buy Box win', value: '81%', sub: 'Amazon · 30d', real: false },
    { label: 'Return rate', value: '2.4%', sub: 'below category avg', real: false },
  ];
  const weeks = [{ a: 9, e: 3 }, { a: 11, e: 4 }, { a: 10, e: 3 }, { a: 13, e: 5 }, { a: 12, e: 4 }, { a: 14, e: 5 }, { a: 13, e: 4 }, { a: 14, e: 6 }];
  const maxWk = Math.max(...weeks.map((w) => w.a + w.e));
  const recs = [
    { tone: 'Opportunity', toneColor: '#0E7A73', toneBg: '#E1F3F1', stat: '+£3.1k/mo', lead: 'List on more marketplaces.', body: 'Proven demand where listed, with headroom on unlisted channels.', link: 'Create listing' },
    { tone: 'Restock', toneColor: '#B4791E', toneBg: '#FBF1DE', stat: '3 left', lead: 'Availability is low.', body: 'At current velocity it sells out soon.', link: 'Update availability' },
    { tone: 'Pricing', toneColor: '#5A665F', toneBg: '#EEF1F0', stat: '+£20', lead: 'Price varies across channels.', body: 'Consider aligning to protect conversion.', link: 'Adjust price' },
  ];

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      {/* breadcrumb */}
      <div className="flex items-center gap-2 text-[12.5px] text-n-400">
        <Link to="/channel-listings" className="font-semibold text-n-400 hover:text-teal-700">Channel listings</Link>
        <span className="text-n-300">/</span>
        <span className="truncate font-semibold text-n-700">{data.title}</span>
      </div>

      {/* product header */}
      <div className="card mt-3.5 flex flex-wrap items-start gap-5 p-5">
        <div className="grid h-[84px] w-[84px] flex-none place-items-center rounded-xl border border-n-100 bg-n-50 text-n-300"><Package size={38} /></div>
        <div className="min-w-[280px] flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="code rounded-md px-2 py-0.5 text-[12.5px] text-teal-700" style={{ background: '#E8F4F2' }}>{data.sku}</span>
            {data.brand && <span className="text-[12.5px] text-n-500">{data.brand}</span>}
            <span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ color: '#B4791E', background: '#FBF1DE' }}>Listed on {data.listedCount}/{data.channelCount} channels</span>
          </div>
          <h1 className="mt-2 text-[24px] font-bold tracking-tight text-n-900">{data.title}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-4 text-[13px] text-n-500">
            <span>Master stock <strong className="font-semibold text-n-900">{data.masterStock ?? '—'}</strong></span>
            <span>Units live <strong className="font-semibold text-n-900">{data.unitsLive}</strong></span>
            <span>Last synced <strong className="font-semibold text-n-900">{ago(data.lastSyncedAt)}</strong></span>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => { qc.invalidateQueries({ queryKey: ['channel-listing-detail', productId] }); toast.success('Refreshed'); }}
            className="inline-flex h-[38px] items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-semibold text-n-700 hover:bg-n-50"><RefreshCw size={15} /> Refresh</button>
          <Link to="/products" className="inline-flex h-[38px] items-center gap-2 rounded-md bg-teal-500 px-4 text-[13px] font-semibold text-white hover:bg-teal-600"><Edit3 size={15} /> Edit product</Link>
        </div>
      </div>

      {/* KPI row (placeholder) */}
      <div className="mt-1.5 mb-1 flex items-center text-[12px] text-n-400">Performance metrics <Sample /> — indicative; wire up in a later phase.</div>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        {kpis.map((k) => (
          <div key={k.label} className="card p-4">
            <div className="flex items-center justify-between"><span className="text-[12px] font-semibold text-n-500">{k.label}{!k.real && <Sample />}</span></div>
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
                      {([['Fulfilment', c.fulfilmentChannel ?? '—', true], ['Est. profit (EUR)', eur(c.profitEur), true], ['Margin', pct(c.marginPct), true], ['Units sold (30d)', '96', false]] as const).map(([label, val, real]) => (
                        <div key={label}>
                          <div className="text-[11px] font-semibold text-n-400">{label}{!real && <Sample />}</div>
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
                  <div className="flex flex-col items-center gap-2.5 px-4 py-6 text-center">
                    <div className="text-[13px] text-n-500">Not listed on {c.name} yet.</div>
                    <button className="h-9 rounded-md bg-teal-500 px-4 text-[13px] font-semibold text-white hover:bg-teal-600" title="Coming with push sync">+ List on {c.name}</button>
                  </div>
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
          <div className="flex items-baseline gap-2.5"><div className="text-[15px] font-bold text-n-900">Units sold by channel</div><div className="text-[12.5px] text-n-400">Last 8 weeks <Sample /></div></div>
          <div className="mt-4 flex h-[160px] items-end gap-2.5">
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full max-w-[34px] flex-col justify-end overflow-hidden rounded-md" style={{ height: 150 }}>
                  <div style={{ height: `${(w.e / maxWk) * 150}px`, background: '#0064D2' }} />
                  <div style={{ height: `${(w.a / maxWk) * 150}px`, background: '#F59B00' }} />
                </div>
                <span className="text-[10.5px] text-n-400">W{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* recommendations (placeholder) */}
      <div className="mt-6">
        <div className="flex items-center text-[16px] font-bold text-n-900">Recommendations for this SKU <Sample /></div>
        <div className="mt-3 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
          {recs.map((n) => (
            <div key={n.tone} className="card flex flex-col gap-2.5 p-4">
              <div className="flex items-center gap-2">
                <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: n.toneColor, background: n.toneBg }}>{n.tone}</span>
                <div className="flex-1" />
                <span className="mono text-[16px] font-bold" style={{ color: n.toneColor }}>{n.stat}</span>
              </div>
              <div className="text-[13.5px] leading-snug text-n-700"><strong className="text-n-900">{n.lead}</strong> {n.body}</div>
              <span className="text-[12.5px] font-semibold text-teal-700">{n.link} →</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

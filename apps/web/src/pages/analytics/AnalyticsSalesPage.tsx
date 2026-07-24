import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Select } from '@masquare/ui';
import { analyticsApi, type AnalyticsChannelRow } from '../../lib/api';
import { C, eur, eur2, num, pctChange, pctStr } from '../../lib/analyticsFormat';
import { DeltaText, HeaderActions, Kpi, PageHeader, Segmented, SectionCard, marginTone } from '../../components/analytics/primitives';
import { LegendDot, RankedBars, TrendChart } from '../../components/analytics/charts';
import { reshapeTrend, xLabelsFor } from '../../components/analytics/trend';
import { SlideOver } from '../../components/analytics/SlideOver';
import { useAnalyticsFilters, useAnalyticsReport } from '../../components/analytics/useAnalytics';

type Gran = 'day' | 'week';
type SeriesKey = 'revenue' | 'orders' | 'units' | 'aov';

export function AnalyticsSalesPage() {
  const { filters, params, rangeLabel, compareLabel, compare } = useAnalyticsFilters();
  const { data, isLoading } = useAnalyticsReport();
  const [gran, setGran] = useState<Gran>('day');
  const [series, setSeries] = useState<SeriesKey>('revenue');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<AnalyticsChannelRow | null>(null);

  const incVat = filters.incVat;
  const revKey = incVat ? 'revenueIncVatEur' : 'revenueExVatEur';
  const t = data?.totals;
  const c = data?.compareTotals;

  const trend = useMemo(() => (data ? reshapeTrend(data.trend, gran, false) : []), [data, gran]);
  const prevTrend = useMemo(() => (data?.compareTrend ? reshapeTrend(data.compareTrend, gran, false) : null), [data, gran]);

  const seriesDef: Record<SeriesKey, { key: keyof typeof trend[number]; label: string; format: (v: number) => string }> = {
    revenue: { key: revKey, label: 'Revenue', format: eur },
    orders: { key: 'orders', label: 'Orders', format: num },
    units: { key: 'units', label: 'Units', format: num },
    aov: { key: 'avgOrderValueEur', label: 'Avg order value', format: eur2 },
  };
  const sd = seriesDef[series];

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle={<>Revenue and volume across channels, time and geography — {rangeLabel}{compare ? <>, compared with {compareLabel}</> : ''}.</>}
        actions={<HeaderActions />}
      />

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading analytics…</div>}

      {!isLoading && t && data && (
        <>
          {/* KPIs */}
          <div className="mb-4 grid grid-cols-5 gap-3.5 max-[1100px]:grid-cols-3 max-[720px]:grid-cols-2 max-[520px]:grid-cols-1">
            <Kpi label={`Revenue ${incVat ? '(incl. VAT)' : ''}`.trim()} value={eur(t[revKey])} cur={t[revKey]} prev={c?.[revKey]} positiveGood prevLabel={eur(c?.[revKey])} />
            <Kpi label="Profit" value={eur(t.profitEur)} cur={t.profitEur} prev={c?.profitEur} positiveGood prevLabel={eur(c?.profitEur)} accent />
            <Kpi label="Orders" value={num(t.orders)} cur={t.orders} prev={c?.orders} positiveGood prevLabel={num(c?.orders)} />
            <Kpi label="Units" value={num(t.units)} cur={t.units} prev={c?.units} positiveGood prevLabel={num(c?.units)} />
            <Kpi label="Avg order value" value={eur2(t.avgOrderValueEur)} cur={t.avgOrderValueEur} prev={c?.avgOrderValueEur} positiveGood prevLabel={eur2(c?.avgOrderValueEur)} />
          </div>

          {/* Trend */}
          <SectionCard
            className="mb-4"
            title={`Trend — ${sd.label}`}
            right={
              <>
                <Select dense className="w-40" value={series} onChange={(v) => setSeries(v as SeriesKey)}
                  options={[{ value: 'revenue', label: 'Revenue' }, { value: 'orders', label: 'Orders' }, { value: 'units', label: 'Units' }, { value: 'aov', label: 'Avg order value' }]} />
                <Segmented value={gran} onChange={setGran} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month' as Gran, label: 'Month', disabled: true }]} />
              </>
            }
          >
            <div className="mb-3 flex gap-4">
              <LegendDot color={C.teal}>{sd.label}</LegendDot>
              {prevTrend && <LegendDot color="#C9D4D0">Prev period</LegendDot>}
            </div>
            <TrendChart
              points={trend}
              prev={prevTrend}
              prevKey={sd.key}
              series={[{ key: sd.key, label: sd.label, color: C.teal, area: true }]}
              format={sd.format}
              xLabels={xLabelsFor(trend)}
            />
          </SectionCard>

          {/* Ranked bars */}
          <div className="mb-4 grid grid-cols-2 items-start gap-3.5 max-[900px]:grid-cols-1">
            <SectionCard title="Revenue by channel">
              <RankedBars color={C.teal} rows={data.byChannel.map((r) => ({
                key: r.channelId ?? 'none', name: r.channelName,
                value: incVat ? r.revenueIncVatEur : r.revenueExVatEur, display: eur(incVat ? r.revenueIncVatEur : r.revenueExVatEur),
                onClick: () => setPanel(r),
              }))} />
            </SectionCard>
            <SectionCard title="Orders by channel">
              <RankedBars color={C.tealDark} rows={data.byChannel.map((r) => ({
                key: r.channelId ?? 'none', name: r.channelName, value: r.orders, display: num(r.orders), onClick: () => setPanel(r),
              }))} />
            </SectionCard>
          </div>

          {/* Per-channel table with FBM/FBA/Local expand */}
          <SectionCard title="Per sales channel" subtitle="Click a row for the channel drill-down · expand for the FBM / FBA / Local split.">
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {['Channel', 'Native revenue', `Revenue ${incVat ? 'inc' : 'exc'} VAT (€)`, 'Profit', 'Profit %', 'Fees', 'Orders', 'Units', 'vs prev'].map((h, i) => (
                      <th key={h} className={`border-b border-n-200 bg-n-25 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.byChannel.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-n-500">No sales in this range.</td></tr>}
                  {data.byChannel.map((r) => {
                    const id = r.channelId ?? 'none';
                    const isOpen = expanded.has(id);
                    const revEur = incVat ? r.revenueIncVatEur : r.revenueExVatEur;
                    const revNative = incVat ? r.revenueIncVatNative : r.revenueExVatNative;
                    const delta = pctChange(r.revenueExVatEur, r.prevRevenueExVatEur);
                    const canExpand = r.fulfilments.length > 1;
                    return (
                      <Fragment key={id}>
                        <tr className="cursor-pointer hover:bg-teal-50/40" onClick={() => setPanel(r)}>
                          <td className="border-b border-n-100 px-4 py-2 font-medium text-n-800">
                            <span className="flex items-center gap-1.5">
                              {canExpand ? (
                                <button onClick={(e) => { e.stopPropagation(); toggle(id); }} className="grid h-5 w-5 place-items-center rounded text-n-400 hover:bg-n-100 hover:text-n-700">
                                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                              ) : <span className="w-5" />}
                              {r.channelName}
                            </span>
                          </td>
                          <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{r.currency ? `${num(revNative)} ${r.currency}` : '—'}</td>
                          <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{eur2(revEur)}</td>
                          <td className="mono border-b border-n-100 px-4 py-2 text-right font-medium" style={{ color: r.profitEur >= 0 ? C.tealDark : 'var(--danger)' }}>{eur2(r.profitEur)}</td>
                          <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{pctStr(r.profitPct)}</td>
                          <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{eur2(r.feesEur)}</td>
                          <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{num(r.orders)}</td>
                          <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{num(r.units)}</td>
                          <td className="mono border-b border-n-100 px-4 py-2 text-right">{delta == null ? <span className="text-n-300">—</span> : <DeltaText v={delta} good={delta >= 0} />}</td>
                        </tr>
                        {isOpen && r.fulfilments.map((f) => (
                          <tr key={`${id}-${f.fulfilment}`} className="bg-n-25/60">
                            <td className="border-b border-n-100 py-1.5 pl-12 pr-4 text-[12px] text-n-500">
                              <span className="rounded-pill bg-n-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-n-600">{f.fulfilment}</span>
                            </td>
                            <td className="border-b border-n-100" />
                            <td className="mono border-b border-n-100 px-4 py-1.5 text-right text-n-600">{eur2(incVat ? f.revenueIncVatEur : f.revenueExVatEur)}</td>
                            <td className="mono border-b border-n-100 px-4 py-1.5 text-right text-n-600">{eur2(f.profitEur)}</td>
                            <td className="mono border-b border-n-100 px-4 py-1.5 text-right text-n-500">{pctStr(f.profitPct)}</td>
                            <td className="mono border-b border-n-100 px-4 py-1.5 text-right text-n-500">{eur2(f.feesEur)}</td>
                            <td className="mono border-b border-n-100 px-4 py-1.5 text-right text-n-500">{num(f.orders)}</td>
                            <td className="mono border-b border-n-100 px-4 py-1.5 text-right text-n-500">{num(f.units)}</td>
                            <td className="border-b border-n-100" />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}

      <ChannelPanel channel={panel} onClose={() => setPanel(null)} params={params} incVat={incVat} />
    </div>
  );
}

function ChannelPanel({ channel, onClose, params, incVat }: {
  channel: AnalyticsChannelRow | null; onClose: () => void; params: ReturnType<typeof useAnalyticsFilters>['params']; incVat: boolean;
}) {
  const chId = channel?.channelId ?? '';
  const { data } = useQuery({
    queryKey: ['analytics-sales', { ...params, skuChannelId: chId }],
    queryFn: () => analyticsApi.sales({ ...params, skuChannelId: chId }),
    enabled: !!channel && !!chId,
  });
  if (!channel) return null;
  const revEur = incVat ? channel.revenueIncVatEur : channel.revenueExVatEur;
  const tone = marginTone(channel.profitPct);
  const topSkus = (data?.bySku ?? []).slice(0, 8);
  return (
    <SlideOver open={!!channel} onClose={onClose} header={
      <div>
        <div className="text-[17px] font-semibold text-n-900">{channel.channelName}</div>
        <div className="text-[12px] text-n-500">{channel.currency ?? 'EUR'} · {num(channel.orders)} orders</div>
      </div>
    }>
      <div className="grid grid-cols-2 gap-2.5">
        <PanelKpi label="Revenue" value={eur(revEur)} />
        <PanelKpi label="Profit" value={eur(channel.profitEur)} accent={{ color: tone.color, bg: tone.bg }} sub={pctStr(channel.profitPct) + ' margin'} />
        <PanelKpi label="Fees" value={eur(channel.feesEur)} />
        <PanelKpi label="Units" value={num(channel.units)} />
      </div>
      <div className="mt-5 text-[13px] font-semibold text-n-900">Top SKUs on {channel.channelName}</div>
      <div className="mt-2 flex flex-col">
        {topSkus.length === 0 && <div className="py-4 text-center text-[12.5px] text-n-400">No SKU sales</div>}
        {topSkus.map((s) => (
          <div key={s.sku} className="flex items-center gap-2.5 border-b border-n-100 py-2 last:border-0">
            <span className="code shrink-0 text-[12px] font-medium text-n-900">{s.sku}</span>
            <span className="flex-1 truncate text-[12px] text-n-500">{s.productTitle}</span>
            <span className="mono shrink-0 text-[12px] font-semibold text-n-700">{eur(incVat ? s.revenueIncVatEur : s.revenueExVatEur)}</span>
          </div>
        ))}
      </div>
    </SlideOver>
  );
}

function PanelKpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: { color: string; bg: string } }) {
  return (
    <div className="rounded-lg border border-n-200 p-3" style={accent ? { borderColor: accent.bg, background: accent.bg + '55' } : undefined}>
      <div className="text-[11px] font-medium text-n-500">{label}</div>
      <div className="mono mt-1 text-[19px] font-semibold text-n-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] font-semibold" style={{ color: accent?.color ?? 'var(--n-400)' }}>{sub}</div>}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { C, eur, eur2, eurSigned, num, pctChange, pctStr } from '../../lib/analyticsFormat';
import type { AnalyticsChannelRow, AnalyticsReport, AnalyticsTrendPoint } from '../../lib/api';
import { DeltaText, HeaderActions, Kpi, PageHeader, Segmented, SectionCard, marginTone } from '../../components/analytics/primitives';
import { LegendDot, RankedBars, TrendChart } from '../../components/analytics/charts';
import { reshapeTrend, xLabelsFor } from '../../components/analytics/trend';
import { useAnalyticsFilters, useAnalyticsReport } from '../../components/analytics/useAnalytics';

type Gran = 'day' | 'week';

export function AnalyticsOverviewPage() {
  const { filters, rangeLabel, compareLabel, compare } = useAnalyticsFilters();
  const { data, isLoading } = useAnalyticsReport();
  const [gran, setGran] = useState<Gran>('day');
  const [cumulative, setCumulative] = useState(false);
  const [moverMetric, setMoverMetric] = useState<'rev' | 'profit'>('rev');
  const [mixMetric, setMixMetric] = useState<'rev' | 'profit'>('rev');

  const incVat = filters.incVat;
  const revKey = incVat ? 'revenueIncVatEur' : 'revenueExVatEur';
  const t = data?.totals;
  const c = data?.compareTotals;

  const trend = useMemo(() => (data ? reshapeTrend(data.trend, gran, cumulative) : []), [data, gran, cumulative]);
  const prevTrend = useMemo(() => (data?.compareTrend ? reshapeTrend(data.compareTrend, gran, cumulative) : null), [data, gran, cumulative]);
  const insights = useMemo(() => (data ? buildInsights(data) : []), [data]);
  const movers = useMemo(() => (data ? buildMovers(data, moverMetric) : { gainers: [], decliners: [] }), [data, moverMetric]);

  const spark = (k: keyof AnalyticsTrendPoint) => (data ? data.trend.map((p) => Number(p[k]) || 0) : undefined);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={<>How the business is doing — {rangeLabel}{compare ? <>, compared with {compareLabel}</> : ''}.</>}
        actions={<HeaderActions />}
      />

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading analytics…</div>}

      {!isLoading && t && data && (
        <>
          {/* KPI row */}
          <div className="mb-4 grid grid-cols-4 gap-3.5 max-[1200px]:grid-cols-3 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
            <Kpi label={`Revenue ${incVat ? '(incl. VAT)' : ''}`.trim()} value={eur(t[revKey])} cur={t[revKey]} prev={c?.[revKey]} positiveGood prevLabel={eur(c?.[revKey])} spark={spark(revKey)} />
            <Kpi label="Profit" value={eur(t.profitEur)} cur={t.profitEur} prev={c?.profitEur} positiveGood prevLabel={eur(c?.profitEur)} spark={spark('profitEur')} accent />
            <Kpi label="Profit margin" value={pctStr(t.profitPct)} cur={t.profitPct ?? 0} prev={c?.profitPct ?? undefined} positiveGood isPointDelta prevLabel={pctStr(c?.profitPct)} />
            <Kpi label="Fees paid" value={eur(t.feesEur)} cur={t.feesEur} prev={c?.feesEur} positiveGood={false} prevLabel={eur(c?.feesEur)} spark={spark('feesEur')} />
            <Kpi label="Orders" value={num(t.orders)} cur={t.orders} prev={c?.orders} positiveGood prevLabel={num(c?.orders)} spark={spark('orders')} />
            <Kpi label="Units" value={num(t.units)} cur={t.units} prev={c?.units} positiveGood prevLabel={num(c?.units)} spark={spark('units')} />
            <Kpi label="Avg order value" value={eur2(t.avgOrderValueEur)} cur={t.avgOrderValueEur} prev={c?.avgOrderValueEur} positiveGood prevLabel={eur2(c?.avgOrderValueEur)} spark={spark('avgOrderValueEur')} />
            <Kpi label="Shipping + duty" value={eur(t.shippingEur + t.dutyEur)} cur={t.shippingEur + t.dutyEur} prev={c ? c.shippingEur + c.dutyEur : undefined} positiveGood={false} prevLabel={c ? eur(c.shippingEur + c.dutyEur) : undefined} />
          </div>

          {/* Trend */}
          <SectionCard
            className="mb-4"
            title="Revenue & profit trend"
            right={
              <>
                <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-n-600">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={cumulative} onChange={(e) => setCumulative(e.target.checked)} />Cumulative
                </label>
                <Segmented value={gran} onChange={setGran} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month' as Gran, label: 'Month', disabled: true }]} />
              </>
            }
          >
            <div className="mb-3 flex gap-4">
              <LegendDot color={C.teal}>Revenue</LegendDot>
              <LegendDot color={C.tealDark} dashed>Profit</LegendDot>
              {prevTrend && <LegendDot color="#C9D4D0">Prev period</LegendDot>}
            </div>
            <TrendChart
              points={trend}
              prev={prevTrend}
              prevKey={revKey}
              series={[
                { key: revKey, label: 'Revenue', color: C.teal, area: true },
                { key: 'profitEur', label: 'Profit', color: C.tealDark, dashed: true },
              ]}
              format={eur}
              xLabels={xLabelsFor(trend)}
            />
          </SectionCard>

          {/* Insights */}
          {insights.length > 0 && (
            <div className="mb-6">
              <div className="mb-2.5 flex items-baseline gap-3">
                <div className="text-[15px] font-semibold text-n-900">Insights &amp; alerts</div>
                <div className="text-[12.5px] text-n-500">Auto-generated from this period, ranked by impact</div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3.5">
                {insights.map((n, i) => (
                  <Link key={i} to={n.to} className="card flex flex-col gap-2 p-4 transition-shadow hover:shadow-md">
                    <div className="flex items-center gap-2">
                      <span className="rounded-pill px-2.5 py-[3px] text-[10px] font-bold uppercase tracking-wider" style={{ color: n.toneColor, background: n.toneBg }}>{n.tone}</span>
                      <div className="flex-1" />
                      <span className="mono text-[17px] font-semibold" style={{ color: n.statColor }}>{n.stat}</span>
                    </div>
                    <div className="text-[13.5px] leading-snug text-n-700"><strong className="text-n-900">{n.lead}</strong> {n.body}</div>
                    <span className="text-[12.5px] font-semibold text-teal-700">{n.link} →</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Top movers */}
          <div className="mb-6">
            <div className="mb-2.5 flex items-center gap-3">
              <div className="text-[15px] font-semibold text-n-900">Top movers vs previous period</div>
              <div className="ml-auto"><Segmented value={moverMetric} onChange={setMoverMetric} options={[{ value: 'rev', label: 'Revenue Δ' }, { value: 'profit', label: 'Profit Δ' }]} /></div>
            </div>
            {!compare ? (
              <div className="card p-6 text-center text-[13px] text-n-500">Pick a comparison period to see movers.</div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3.5">
                <SectionCard title={<span className="text-[12px] font-bold uppercase tracking-wider text-teal-700">Biggest gainers</span>}>
                  <MoverList rows={movers.gainers} />
                </SectionCard>
                <SectionCard title={<span className="text-[12px] font-bold uppercase tracking-wider text-danger">Biggest decliners</span>}>
                  <MoverList rows={movers.decliners} />
                </SectionCard>
              </div>
            )}
          </div>

          {/* Channel mix + SKU snapshots */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-3.5">
            <SectionCard
              title="Channel mix"
              right={
                <>
                  <Segmented value={mixMetric} onChange={setMixMetric} options={[{ value: 'rev', label: 'Revenue' }, { value: 'profit', label: 'Profit' }]} />
                  <Link to="/analytics/sales" className="text-[13px] font-semibold text-teal-700">Sales →</Link>
                </>
              }
            >
              <RankedBars
                nameWidth={104}
                rows={data.byChannel.map((r) => ({
                  key: r.channelId ?? 'none',
                  name: r.channelName,
                  value: mixMetric === 'rev' ? (incVat ? r.revenueIncVatEur : r.revenueExVatEur) : r.profitEur,
                  display: eur(mixMetric === 'rev' ? (incVat ? r.revenueIncVatEur : r.revenueExVatEur) : r.profitEur),
                  badge: <MarginBadge pct={r.profitPct} />,
                }))}
              />
            </SectionCard>

            <div className="flex flex-col gap-3.5">
              <SectionCard title={<span className="text-[14px]">Top 5 SKUs by profit</span>} right={<Link to="/analytics/products" className="text-[12.5px] font-semibold text-teal-700">Products →</Link>}>
                <SkuMini rows={[...data.bySku].sort((a, b) => b.profitEur - a.profitEur).slice(0, 5)} />
              </SectionCard>
              <SectionCard title={<span className="text-[14px]">Bottom 5 — loss-makers</span>} right={<Link to="/analytics/profitability" className="text-[12.5px] font-semibold text-teal-700">Loss-makers →</Link>}>
                <SkuMini rows={[...data.bySku].sort((a, b) => a.profitEur - b.profitEur).slice(0, 5)} negative />
              </SectionCard>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MarginBadge({ pct }: { pct: number | null }) {
  const tone = marginTone(pct);
  return <span className="mono w-[52px] shrink-0 rounded-pill px-2 py-0.5 text-center text-[11px] font-bold" style={{ color: tone.color, background: tone.bg }}>{pctStr(pct)}</span>;
}

function MoverList({ rows }: { rows: Mover[] }) {
  return (
    <div className="flex flex-col gap-1">
      {rows.length === 0 && <div className="py-3 text-center text-[12.5px] text-n-400">No movement</div>}
      {rows.map((m, i) => (
        <div key={i} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <span className="w-[62px] shrink-0 rounded-[5px] py-0.5 text-center text-[9.5px] font-bold uppercase tracking-wide" style={{ color: m.badgeColor, background: m.badgeBg }}>{m.type}</span>
          <span className={`w-[112px] shrink-0 truncate text-[13px] font-medium text-n-900 ${m.type === 'SKU' ? 'code' : ''}`}>{m.name}</span>
          <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-n-100"><div className="h-full rounded-full" style={{ width: `${m.barW}%`, background: m.delta >= 0 ? C.teal : C.deduction }} /></div>
          <span className="mono w-[74px] shrink-0 text-right text-[13px] font-semibold" style={{ color: m.delta >= 0 ? C.tealDark : C.danger }}>{eurSigned(m.delta)}</span>
        </div>
      ))}
    </div>
  );
}

function SkuMini({ rows, negative }: { rows: AnalyticsReport['bySku']; negative?: boolean }) {
  return (
    <div className="flex flex-col">
      {rows.length === 0 && <div className="py-3 text-center text-[12.5px] text-n-400">No SKU sales</div>}
      {rows.map((p) => (
        <Link key={p.sku} to={`/analytics/products/${encodeURIComponent(p.sku)}`} className="flex items-center gap-2.5 border-b border-n-100 px-1 py-1.5 last:border-0 hover:bg-n-50">
          <span className="code shrink-0 text-[12px] font-medium text-n-900">{p.sku}</span>
          <span className="flex-1 truncate text-[12px] text-n-500">{p.productTitle}</span>
          <span className="mono shrink-0 text-[12.5px] font-semibold" style={{ color: negative ? C.danger : C.tealDark }}>{eur(p.profitEur)}</span>
          <span className="mono w-11 shrink-0 text-right text-[11.5px]" style={{ color: negative ? C.danger : 'var(--n-400)' }}>{pctStr(p.profitPct)}</span>
        </Link>
      ))}
    </div>
  );
}

// ---- client-side derivations ----

interface Insight { tone: string; toneColor: string; toneBg: string; stat: string; statColor: string; lead: string; body: string; link: string; to: string }

function buildInsights(d: AnalyticsReport): Insight[] {
  const out: Insight[] = [];
  const t = d.totals, c = d.compareTotals;
  const CRIT = { tone: 'Critical', toneColor: C.danger, toneBg: '#FBEDEA' };
  const WARN = { tone: 'Warning', toneColor: C.warn, toneBg: '#FDF3E4' };
  const INFO = { tone: 'Info', toneColor: C.tealDark, toneBg: '#E8F4F2' };

  const losers = d.bySku.filter((s) => s.profitEur < 0);
  if (losers.length) {
    const loss = losers.reduce((s, x) => s + x.profitEur, 0);
    const worst = [...losers].sort((a, b) => a.profitEur - b.profitEur)[0];
    out.push({ ...CRIT, stat: eur(loss), statColor: C.danger, lead: `${losers.length} SKU${losers.length > 1 ? 's' : ''} sold at a negative margin`, body: `this period. ${worst.sku} accounts for the largest share of the loss.`, link: 'View loss-makers', to: '/analytics/profitability' });
  }
  if (c) {
    const feeCh = pctChange(t.feesEur, c.feesEur);
    const revCh = pctChange(t.revenueExVatEur, c.revenueExVatEur);
    if (feeCh != null && revCh != null && feeCh > revCh + 5) {
      out.push({ ...WARN, stat: `${feeCh >= 0 ? '+' : ''}${feeCh.toFixed(1)}%`, statColor: C.danger, lead: 'Fees grew faster than revenue', body: `— ${eur(t.feesEur)} paid vs ${eur(c.feesEur)} in the previous period.`, link: 'See fee breakdown', to: '/analytics/profitability' });
    }
    const unitCh = pctChange(t.units, c.units);
    const ordCh = pctChange(t.orders, c.orders);
    if (unitCh != null && ordCh != null && Math.abs(unitCh - ordCh) > 15) {
      out.push({ ...INFO, stat: `${unitCh >= 0 ? '+' : ''}${unitCh.toFixed(1)}%`, statColor: 'var(--n-700)', lead: `Units moved ${unitCh >= 0 ? 'up' : 'down'} while orders ${ordCh >= 0 ? 'rose' : 'fell'} ${Math.abs(ordCh).toFixed(1)}%.`, body: 'Bulk lines can move units independently of order count — not necessarily a demand shift.', link: 'See sales', to: '/analytics/sales' });
    }
  }
  const worstCh = d.byChannel.filter((ch) => ch.profitPct != null).sort((a, b) => (a.profitPct ?? 0) - (b.profitPct ?? 0))[0];
  if (worstCh && t.profitPct != null && worstCh.profitPct != null && t.profitPct - worstCh.profitPct > 8) {
    out.push({ ...WARN, stat: pctStr(worstCh.profitPct), statColor: C.danger, lead: `${worstCh.channelName} margin is ${(t.profitPct - worstCh.profitPct).toFixed(1)}pp below`, body: `the ${pctStr(t.profitPct)} overall average.`, link: 'Open channel', to: '/analytics/sales' });
  }
  const gainer = d.byChannel.filter((ch) => ch.prevRevenueExVatEur != null).map((ch) => ({ ch, d: ch.revenueExVatEur - (ch.prevRevenueExVatEur ?? 0) })).sort((a, b) => b.d - a.d)[0];
  if (gainer && gainer.d > 0) {
    out.push({ ...INFO, stat: eurSigned(gainer.d), statColor: C.tealDark, lead: `${gainer.ch.channelName} is the biggest gainer`, body: `— revenue up ${eur(gainer.ch.revenueExVatEur)} at a ${pctStr(gainer.ch.profitPct)} margin.`, link: 'Open channel', to: '/analytics/sales' });
  }
  return out.slice(0, 5);
}

interface Mover { type: 'SKU' | 'CHANNEL' | 'COUNTRY'; name: string; delta: number; badgeColor: string; badgeBg: string; barW: number }

function buildMovers(d: AnalyticsReport, metric: 'rev' | 'profit'): { gainers: Mover[]; decliners: Mover[] } {
  const raw: Mover[] = [];
  const push = (type: Mover['type'], name: string, cur: number, prev: number | null, style: { badgeColor: string; badgeBg: string }) => {
    if (prev == null) return;
    raw.push({ type, name, delta: cur - prev, barW: 0, ...style });
  };
  const skuStyle = { badgeColor: 'var(--n-600)', badgeBg: 'var(--n-100)' };
  const chStyle = { badgeColor: C.tealDark, badgeBg: '#E8F4F2' };
  const coStyle = { badgeColor: '#B4511F', badgeBg: '#FCEEE7' };
  const pick = (o: { revenueExVatEur: number; profitEur: number }) => (metric === 'rev' ? o.revenueExVatEur : o.profitEur);
  const pickPrev = (o: AnalyticsChannelRow | AnalyticsReport['byCountry'][number] | AnalyticsReport['bySku'][number]) => (metric === 'rev' ? o.prevRevenueExVatEur : o.prevProfitEur);
  for (const ch of d.byChannel) push('CHANNEL', ch.channelName, pick(ch), pickPrev(ch), chStyle);
  for (const co of d.byCountry) push('COUNTRY', co.countryName, pick(co), pickPrev(co), coStyle);
  for (const s of d.bySku) push('SKU', s.sku, pick(s), pickPrev(s), skuStyle);
  const sorted = raw.filter((m) => m.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const max = Math.max(1, ...sorted.map((m) => Math.abs(m.delta)));
  const withBar = (arr: Mover[]) => arr.map((m) => ({ ...m, barW: Math.round((Math.abs(m.delta) / max) * 100) }));
  return {
    gainers: withBar(sorted.filter((m) => m.delta > 0).slice(0, 5)),
    decliners: withBar(sorted.filter((m) => m.delta < 0).slice(0, 5)),
  };
}

import { useMemo } from 'react';
import { C, eur, eur2, num, pctChange, pctStr } from '../../lib/analyticsFormat';
import type { AnalyticsReport } from '../../lib/api';
import { DeltaText, HeaderActions, Kpi, PageHeader, SectionCard, marginTone } from '../../components/analytics/primitives';
import { Histogram, Waterfall, type WaterfallStep } from '../../components/analytics/charts';
import { useAnalyticsFilters, useAnalyticsReport } from '../../components/analytics/useAnalytics';

export function AnalyticsProfitabilityPage() {
  const { rangeLabel, compareLabel, compare } = useAnalyticsFilters();
  const { data, isLoading } = useAnalyticsReport();
  const t = data?.totals;
  const c = data?.compareTotals;

  const waterfall = useMemo<WaterfallStep[]>(() => {
    if (!t) return [];
    const rev = t.revenueExVatEur;
    const shipDuty = t.shippingEur + t.dutyEur;
    const cogs = Math.max(0, rev - t.profitEur - t.feesEur - shipDuty);
    const l1 = rev - cogs;
    const l2 = l1 - t.feesEur;
    const l3 = l2 - shipDuty;
    const pctOf = (v: number) => (rev > 0 ? `${((v / rev) * 100).toFixed(1)}% of revenue` : undefined);
    return [
      { label: 'Revenue', sub: 'excl. VAT', value: rev, from: 0, to: rev, total: true },
      { label: 'COGS', sub: pctOf(cogs), value: -cogs, from: rev, to: l1 },
      { label: 'Marketplace fees', sub: pctOf(t.feesEur), value: -t.feesEur, from: l1, to: l2 },
      { label: 'Shipping + duty', sub: pctOf(shipDuty), value: -shipDuty, from: l2, to: l3 },
      { label: 'Net profit', sub: t.profitPct != null ? `${t.profitPct.toFixed(1)}% margin` : undefined, value: t.profitEur, from: 0, to: t.profitEur, total: true },
    ];
  }, [t]);

  const histo = useMemo(() => (data ? buildHistogram(data) : []), [data]);
  const losers = useMemo(() => (data ? data.bySku.filter((s) => s.profitEur < 0).sort((a, b) => a.profitEur - b.profitEur) : []), [data]);
  const lossTotal = losers.reduce((s, x) => s + x.profitEur, 0);

  return (
    <div>
      <PageHeader
        title="Profitability & Fees"
        subtitle={<>Where money is made and lost — {rangeLabel}{compare ? <>, compared with {compareLabel}</> : ''}.</>}
        actions={<HeaderActions />}
      />

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading analytics…</div>}

      {!isLoading && t && data && (
        <>
          {/* KPIs */}
          <div className="mb-4 grid grid-cols-3 gap-3.5 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
            <Kpi label="Profit" value={eur(t.profitEur)} cur={t.profitEur} prev={c?.profitEur} positiveGood prevLabel={eur(c?.profitEur)} accent />
            <Kpi label="Profit margin" value={pctStr(t.profitPct)} cur={t.profitPct ?? 0} prev={c?.profitPct ?? undefined} positiveGood isPointDelta prevLabel={pctStr(c?.profitPct)} />
            <Kpi label="Fees paid" value={eur(t.feesEur)} cur={t.feesEur} prev={c?.feesEur} positiveGood={false} prevLabel={eur(c?.feesEur)} />
            <Kpi label="Fees % of revenue" value={pctStr(feePct(t))} cur={feePct(t) ?? 0} prev={c ? feePct(c) ?? undefined : undefined} positiveGood={false} isPointDelta prevLabel={pctStr(c ? feePct(c) : null)} />
            <Kpi label="Shipping + duty" value={eur(t.shippingEur + t.dutyEur)} cur={t.shippingEur + t.dutyEur} prev={c ? c.shippingEur + c.dutyEur : undefined} positiveGood={false} prevLabel={c ? eur(c.shippingEur + c.dutyEur) : undefined} />
            <Kpi label="Shipping % of revenue" value={pctStr(shipPct(t))} cur={shipPct(t) ?? 0} prev={c ? shipPct(c) ?? undefined : undefined} positiveGood={false} isPointDelta prevLabel={pctStr(c ? shipPct(c) : null)} />
          </div>

          {/* Waterfall */}
          <SectionCard className="mb-4" title="Profit waterfall" subtitle="The P&L shape of the period, revenue → net profit.">
            <div className="mt-4"><Waterfall steps={waterfall} format={eur} /></div>
          </SectionCard>

          {/* Margin by channel + distribution */}
          <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-3.5">
            <SectionCard title="Margin by channel" subtitle="Profit margin % — big-but-thin channels stand out.">
              <div className="flex flex-col gap-0.5">
                {data.byChannel.map((r) => {
                  const tone = marginTone(r.profitPct);
                  return (
                    <div key={r.channelId ?? 'none'} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
                      <span className="w-[100px] shrink-0 truncate text-[13px] font-medium text-n-800">{r.channelName}</span>
                      <div className="h-[9px] flex-1 overflow-hidden rounded-full bg-n-100"><div className="h-full rounded-full" style={{ width: `${Math.min(100, ((r.profitPct ?? 0) / 32) * 100)}%`, background: (r.profitPct ?? 0) < 15 ? C.deduction : C.teal }} /></div>
                      <span className="mono w-12 shrink-0 text-right text-[13px] font-semibold" style={{ color: tone.color }}>{pctStr(r.profitPct)}</span>
                      <span className="mono w-16 shrink-0 text-right text-[11.5px] text-n-400">{eur(r.revenueExVatEur)}</span>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
            <SectionCard title="Margin distribution" subtitle="Units sold by margin band — how healthy the mix is.">
              <div className="mt-4"><Histogram bars={histo} /></div>
            </SectionCard>
          </div>

          {/* Fee analysis */}
          <SectionCard className="mb-4" title="Fee analysis" subtitle={`${eur(t.feesEur)} paid this period${c ? ` — ${fmtDelta(pctChange(t.feesEur, c.feesEur))} vs prev` : ''}.`}>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
                <thead>
                  <tr>{['Channel', 'Fees', '% of rev.', 'Avg fee/unit', 'vs prev'].map((h, i) => (
                    <th key={h} className={`border-b border-n-200 bg-n-25 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {data.byChannel.filter((r) => r.feesEur > 0).map((r) => (
                      <tr key={r.channelId ?? 'none'} className="hover:bg-teal-50/40">
                        <td className="border-b border-n-100 px-4 py-2 font-medium text-n-800">{r.channelName}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{eur2(r.feesEur)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{pctStr(r.revenueExVatEur > 0 ? (r.feesEur / r.revenueExVatEur) * 100 : null)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{r.units > 0 ? eur2(r.feesEur / r.units) : '—'}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right"><span className="text-n-300">—</span></td>
                      </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11.5px] text-n-400">Fee-type split (referral / FBA / storage) will populate once the marketplace fee breakdown is captured per line.</p>
          </SectionCard>

          {/* Loss-makers */}
          <SectionCard
            title="Loss-making SKUs"
            subtitle="Every SKU sold at negative profit this period, sorted by loss size."
            right={losers.length > 0 && <span className="mono rounded-pill bg-[#FBEDEA] px-3 py-1 text-[12.5px] font-bold text-danger">{losers.length} SKUs · {eur(lossTotal)}</span>}
          >
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
                <thead>
                  <tr>{['SKU', 'Product', 'Units', 'Revenue', 'Profit', 'Margin', 'Main cost driver'].map((h, i) => (
                    <th key={h} className={`border-b border-n-200 bg-n-25 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 ${i <= 1 ? 'text-left' : i === 6 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {losers.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-n-500">No loss-making SKUs this period.</td></tr>}
                  {losers.map((r) => {
                    const cogs = Math.max(0, r.revenueExVatEur - r.profitEur - r.feesEur);
                    const driver = r.feesEur > cogs ? { label: 'Fees', color: C.warn, bg: '#FDF3E4' } : { label: 'COGS', color: 'var(--n-600)', bg: 'var(--n-100)' };
                    return (
                      <tr key={r.sku} className="hover:bg-teal-50/40">
                        <td className="border-b border-n-100 px-4 py-2"><span className="code font-medium text-n-900">{r.sku}</span></td>
                        <td className="max-w-[220px] truncate border-b border-n-100 px-4 py-2 text-n-500">{r.productTitle}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{num(r.units)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{eur(r.revenueExVatEur)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right font-semibold text-danger">{eur2(r.profitEur)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-danger">{pctStr(r.profitPct)}</td>
                        <td className="border-b border-n-100 px-4 py-2"><span className="rounded-pill px-2.5 py-0.5 text-[11px] font-bold" style={{ color: driver.color, background: driver.bg }}>{driver.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

const feePct = (t: AnalyticsReport['totals']) => (t.revenueExVatEur > 0 ? (t.feesEur / t.revenueExVatEur) * 100 : null);
const shipPct = (t: AnalyticsReport['totals']) => (t.revenueExVatEur > 0 ? ((t.shippingEur + t.dutyEur) / t.revenueExVatEur) * 100 : null);
const fmtDelta = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '↗' : '↘'} ${Math.abs(v).toFixed(1)}%`);

function buildHistogram(d: AnalyticsReport) {
  const bands = [
    { band: '< 0%', color: C.deduction, test: (p: number) => p < 0 },
    { band: '0–10%', color: '#C9E5E2', test: (p: number) => p >= 0 && p < 10 },
    { band: '10–20%', color: '#8FD0CA', test: (p: number) => p >= 10 && p < 20 },
    { band: '20–30%', color: C.teal, test: (p: number) => p >= 20 && p < 30 },
    { band: '> 30%', color: C.tealDark, test: (p: number) => p >= 30 },
  ];
  return bands.map((b) => ({ band: b.band, color: b.color, count: d.bySku.filter((s) => s.profitPct != null && b.test(s.profitPct)).reduce((sum, s) => sum + s.units, 0) }));
}

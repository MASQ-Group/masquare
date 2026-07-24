import { useMemo } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, type AnalyticsCountryRow, type Country } from '../../lib/api';
import { C, eur, eur2, num, pctChange, pctStr } from '../../lib/analyticsFormat';
import { DeltaText, HeaderActions, Kpi, PageHeader, SectionCard, marginTone } from '../../components/analytics/primitives';
import { ShareBar } from '../../components/analytics/charts';
import { SlideOver } from '../../components/analytics/SlideOver';
import { Flag } from '../../components/common/Flag';
import { useAnalyticsFilters, useAnalyticsReport, useCountryOptions } from '../../components/analytics/useAnalytics';

export function AnalyticsCountriesPage() {
  const { filters, params, rangeLabel, compareLabel, compare } = useAnalyticsFilters();
  const { data, isLoading } = useAnalyticsReport();
  const { data: countries } = useCountryOptions();
  const [panel, setPanel] = useState<AnalyticsCountryRow | null>(null);
  const incVat = filters.incVat;

  const byId = useMemo(() => new Map((countries ?? []).map((c) => [c.id, c])), [countries]);
  const t = data?.totals;
  const c = data?.compareTotals;

  const totalRev = t ? (incVat ? t.revenueIncVatEur : t.revenueExVatEur) : 0;
  const maxRev = Math.max(1, ...(data?.byCountry ?? []).map((r) => (incVat ? r.revenueIncVatEur : r.revenueExVatEur)));
  const vatCollected = t ? t.revenueIncVatEur - t.revenueExVatEur : 0;
  const prevVat = c ? c.revenueIncVatEur - c.revenueExVatEur : undefined;

  // OSS liability card is a VISUAL PLACEHOLDER — the functional module is not yet defined.
  const ossRows = (data?.byCountry ?? []).filter((r) => byId.get(r.countryId ?? '')?.euVatZone).slice(0, 6);
  const ossMax = Math.max(1, ...ossRows.map((r) => r.revenueIncVatEur - r.revenueExVatEur));
  const ossTotal = ossRows.reduce((s, r) => s + (r.revenueIncVatEur - r.revenueExVatEur), 0);

  return (
    <div>
      <PageHeader
        title="Countries & VAT"
        subtitle={<>Where revenue lands and what VAT it carries — {rangeLabel}{compare ? <>, compared with {compareLabel}</> : ''}. Click a country for detail.</>}
        actions={<HeaderActions />}
      />

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading analytics…</div>}

      {!isLoading && t && data && (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3.5 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
            <Kpi label="Destination countries" value={num(data.byCountry.length)} cur={data.byCountry.length} positiveGood />
            <Kpi label={`Total revenue ${incVat ? '(incl. VAT)' : ''}`.trim()} value={eur(totalRev)} cur={totalRev} prev={c ? (incVat ? c.revenueIncVatEur : c.revenueExVatEur) : undefined} positiveGood prevLabel={c ? eur(incVat ? c.revenueIncVatEur : c.revenueExVatEur) : undefined} />
            <Kpi label="VAT collected" value={eur(vatCollected)} cur={vatCollected} prev={prevVat} positiveGood prevLabel={prevVat != null ? eur(prevVat) : undefined} accent />
            <Kpi label="Profit" value={eur(t.profitEur)} cur={t.profitEur} prev={c?.profitEur} positiveGood prevLabel={eur(c?.profitEur)} />
          </div>

          {/* Country table */}
          <SectionCard className="mb-4" title="By destination country" subtitle="VAT is the standard rate at destination. Click a row for the country view.">
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-[12.5px]">
                <thead>
                  <tr>{['Country', 'Share', 'Revenue €', 'Profit', 'Profit %', 'Units', 'VAT rate', 'VAT collected', 'vs prev'].map((h, i) => (
                    <th key={h} className={`border-b border-n-200 bg-n-25 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${i === 0 || i === 1 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {data.byCountry.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-n-500">No sales in this range.</td></tr>}
                  {data.byCountry.map((r) => {
                    const co = byId.get(r.countryId ?? '');
                    const revEur = incVat ? r.revenueIncVatEur : r.revenueExVatEur;
                    const vat = r.revenueIncVatEur - r.revenueExVatEur;
                    const delta = pctChange(r.revenueExVatEur, r.prevRevenueExVatEur);
                    return (
                      <tr key={r.countryId ?? 'none'} className="cursor-pointer hover:bg-teal-50/40" onClick={() => setPanel(r)}>
                        <td className="border-b border-n-100 px-4 py-2"><span className="flex items-center gap-2"><Flag code={co?.isoCode} /><span className="font-medium text-n-800">{r.countryName}</span></span></td>
                        <td className="border-b border-n-100 px-4 py-2"><span className="flex items-center gap-2"><span className="w-[90px]"><ShareBar pct={(revEur / maxRev) * 100} /></span><span className="mono w-10 text-right text-[11.5px] text-n-500">{pctStr((revEur / totalRev) * 100)}</span></span></td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right font-medium text-n-700">{eur2(revEur)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right font-semibold" style={{ color: r.profitEur >= 0 ? C.tealDark : 'var(--danger)' }}>{eur2(r.profitEur)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{pctStr(r.profitPct)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{num(r.units)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{co ? `${co.vatRate}%` : '—'}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{eur2(vat)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right">{delta == null ? <span className="text-n-300">—</span> : <DeltaText v={delta} good={delta >= 0} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* OSS placeholder + VAT collected by country */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] items-start gap-3.5">
            <SectionCard
              title="OSS VAT liability"
              subtitle="Owed per EU destination in the One-Stop-Shop return."
              right={<span className="rounded-pill bg-n-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-n-500">Placeholder</span>}
            >
              <div className="flex flex-col gap-2.5">
                {ossRows.length === 0 && <div className="py-3 text-center text-[12.5px] text-n-400">No EU-zone destinations in range.</div>}
                {ossRows.map((r) => {
                  const co = byId.get(r.countryId ?? '');
                  const v = r.revenueIncVatEur - r.revenueExVatEur;
                  return (
                    <div key={r.countryId ?? 'none'} className="grid grid-cols-[110px_1fr_70px] items-center gap-2.5">
                      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-n-700"><Flag code={co?.isoCode} />{r.countryName}</span>
                      <span className="h-4 overflow-hidden rounded bg-n-50"><span className="block h-full rounded bg-teal-400" style={{ width: `${(v / ossMax) * 100}%` }} /></span>
                      <span className="mono text-right text-[12.5px] font-semibold text-n-900">{eur(v)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex justify-between border-t border-n-100 pt-2.5 text-[13px]">
                <span className="font-semibold text-n-700">Indicative total</span>
                <span className="mono font-semibold text-n-900">{eur(ossTotal)}</span>
              </div>
              <p className="mt-2.5 rounded-md bg-warning-bg px-3 py-2 text-[11.5px] leading-relaxed text-warning">
                Visual placeholder. The OSS return module (thresholds, filing periods, adjustments) will be defined and wired later — these figures are a straight VAT-collected view, not a filed liability.
              </p>
            </SectionCard>

            <SectionCard title="VAT collected by country" subtitle="Destination VAT charged under OSS, this period.">
              <div className="flex flex-col gap-2">
                {data.byCountry.map((r) => {
                  const co = byId.get(r.countryId ?? '');
                  const v = r.revenueIncVatEur - r.revenueExVatEur;
                  const max = Math.max(1, ...data.byCountry.map((x) => x.revenueIncVatEur - x.revenueExVatEur));
                  return (
                    <div key={r.countryId ?? 'none'} className="flex items-center gap-2.5">
                      <span className="flex w-[120px] shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-n-700"><Flag code={co?.isoCode} /><span className="truncate">{r.countryName}</span></span>
                      <div className="h-[9px] flex-1 overflow-hidden rounded-full bg-n-100"><div className="h-full rounded-full bg-teal-500" style={{ width: `${(v / max) * 100}%` }} /></div>
                      <span className="mono w-16 shrink-0 text-right text-[12.5px] font-semibold text-n-700">{eur(v)}</span>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>
        </>
      )}

      <CountryPanel country={panel} onClose={() => setPanel(null)} params={params} incVat={incVat} co={panel ? byId.get(panel.countryId ?? '') : undefined} />
    </div>
  );
}

function CountryPanel({ country, onClose, params, incVat, co }: {
  country: AnalyticsCountryRow | null; onClose: () => void; params: ReturnType<typeof useAnalyticsFilters>['params']; incVat: boolean; co?: Country;
}) {
  const coId = country?.countryId ?? '';
  const { data } = useQuery({
    queryKey: ['analytics-sales', { ...params, skuCountryId: coId }],
    queryFn: () => analyticsApi.sales({ ...params, skuCountryId: coId }),
    enabled: !!country && !!coId,
  });
  if (!country) return null;
  const revEur = incVat ? country.revenueIncVatEur : country.revenueExVatEur;
  const vat = country.revenueIncVatEur - country.revenueExVatEur;
  const tone = marginTone(country.profitPct);
  const topSkus = (data?.bySkuByCountry ?? []).slice(0, 6);
  return (
    <SlideOver open={!!country} onClose={onClose} header={
      <div className="flex items-center gap-2.5">
        <Flag code={co?.isoCode} className="!h-5 !w-6" />
        <div>
          <div className="text-[17px] font-semibold text-n-900">{country.countryName}</div>
          <div className="text-[12px] text-n-500">standard VAT {co ? `${co.vatRate}%` : '—'}</div>
        </div>
      </div>
    }>
      <div className="grid grid-cols-2 gap-2.5">
        <PanelKpi label="Revenue" value={eur(revEur)} />
        <PanelKpi label="Profit" value={eur(country.profitEur)} sub={pctStr(country.profitPct) + ' margin'} accent={{ color: tone.color, bg: tone.bg }} />
        <PanelKpi label="Units" value={num(country.units)} />
        <PanelKpi label="VAT collected" value={eur(vat)} />
      </div>
      <div className="mt-5 text-[13px] font-semibold text-n-900">Top SKUs in {country.countryName}</div>
      <div className="mt-2 flex flex-col">
        {topSkus.length === 0 && <div className="py-4 text-center text-[12.5px] text-n-400">No SKU sales</div>}
        {topSkus.map((s) => (
          <Link key={s.sku} to={`/analytics/products/${encodeURIComponent(s.sku)}`} className="flex items-center gap-2.5 border-b border-n-100 py-2 last:border-0 hover:bg-n-50">
            <span className="code shrink-0 text-[12px] font-medium text-n-900">{s.sku}</span>
            <span className="flex-1 truncate text-[12px] text-n-500">{s.productTitle}</span>
            <span className="mono shrink-0 text-[12px] font-semibold text-n-700">{eur(incVat ? s.revenueIncVatEur : s.revenueExVatEur)}</span>
          </Link>
        ))}
      </div>
      <Link to="/analytics/sales" className="mt-5 flex h-10 items-center justify-center rounded-lg border border-n-200 text-[13px] font-semibold text-teal-700 hover:bg-n-50">View sales for {country.countryName} →</Link>
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

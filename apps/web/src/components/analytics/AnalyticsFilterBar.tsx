import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { DateRangePicker, Select } from '@masquare/ui';
import { PageHeader } from '../common/PageHeader';
import { useAnalyticsFilters, useChannelOptions, useCountryOptions } from './useAnalytics';

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

// Analytics section title, derived from the route (the sub-nav lives in the sidebar).
const TITLES: { match: (p: string) => boolean; title: string }[] = [
  { match: (p) => p.startsWith('/analytics/sales'), title: 'Sales' },
  { match: (p) => p.startsWith('/analytics/profitability'), title: 'Profitability & Fees' },
  { match: (p) => p.startsWith('/analytics/products'), title: 'Products' },
  { match: (p) => p.startsWith('/analytics/countries'), title: 'Countries & VAT' },
  { match: (p) => p.startsWith('/analytics/returns'), title: 'Returns & Refunds' },
  { match: () => true, title: 'Overview' },
];

/** The analytics top bar (Top Bar Redesign): breadcrumb + the module-wide filter toolbar
 *  (date range, comparison, channel, fulfilment, country) and a VAT incl/excl toggle — all
 *  persisted and shared across the analytics pages. */
export function AnalyticsFilterBar() {
  const { filters, set, reset, rangeLabel, compare, compareLabel } = useAnalyticsFilters();
  const { data: channels } = useChannelOptions();
  const { data: countries } = useCountryOptions();
  const { pathname } = useLocation();
  const title = TITLES.find((t) => t.match(pathname))!.title;

  const chips: { label: string; onRemove: () => void }[] = [];
  if (filters.channelId) chips.push({ label: `Channel: ${channels?.find((c) => c.id === filters.channelId)?.name ?? '—'}`, onRemove: () => set({ channelId: '' }) });
  if (filters.fulfilment !== 'all') chips.push({ label: `Fulfilment: ${filters.fulfilment.toUpperCase()}`, onRemove: () => set({ fulfilment: 'all' }) });
  if (filters.countryId) chips.push({ label: `Country: ${countries?.find((c) => c.id === filters.countryId)?.name ?? '—'}`, onRemove: () => set({ countryId: '' }) });

  return (
    <>
      <PageHeader
        module="Analytics"
        title={title}
        info="Revenue, profit, fees and returns across every channel — driven by your recorded sales transactions."
        toolbar={
          <>
            <span title={rangeLabel}>
              <Select dense className="w-40" value={filters.rangePreset} onChange={(v) => set({ rangePreset: v as any })}
                options={[
                  { value: 'mtd', label: 'Month to date' },
                  { value: 'prev_month', label: 'Previous month' },
                  { value: 'ytd', label: 'Year to date' },
                  { value: 'year', label: 'Specific year' },
                  { value: 'quarter', label: 'Specific quarter' },
                  { value: 'custom', label: 'Custom range' },
                ]} />
            </span>
            {(filters.rangePreset === 'year' || filters.rangePreset === 'quarter') && (
              <Select dense className="w-24" value={String(filters.year)} onChange={(v) => set({ year: Number(v) })} options={YEARS.map((y) => ({ value: String(y), label: String(y) }))} />
            )}
            {filters.rangePreset === 'quarter' && (
              <Select dense className="w-20" value={String(filters.quarter)} onChange={(v) => set({ quarter: Number(v) })} options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: `Q${q}` }))} />
            )}
            {filters.rangePreset === 'custom' && (
              <div className="w-[15rem]"><DateRangePicker value={filters.custom} onChange={(v) => set({ custom: v })} /></div>
            )}

            <span title={compare ? compareLabel : undefined} className="flex items-center gap-1 text-[12px] text-n-400">
              vs
              <Select dense className="w-[13.5rem]" value={filters.comparePreset} onChange={(v) => set({ comparePreset: v as any })}
                options={[
                  { value: 'prev_period', label: 'Previous period' },
                  { value: 'prev_month', label: 'Same period, previous month' },
                  { value: 'prev_year', label: 'Same period, previous year' },
                  { value: 'custom', label: 'Custom' },
                  { value: 'none', label: 'No comparison' },
                ]} />
            </span>
            {filters.comparePreset === 'custom' && (
              <div className="w-[15rem]"><DateRangePicker value={filters.customCompare} onChange={(v) => set({ customCompare: v })} /></div>
            )}

            <Select dense className="w-40" value={filters.channelId} onChange={(v) => set({ channelId: v })}
              options={[{ value: '', label: 'All channels' }, ...(channels ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
            <Select dense className="w-36" value={filters.fulfilment} onChange={(v) => set({ fulfilment: v })}
              options={[{ value: 'all', label: 'All fulfilment' }, { value: 'fbm', label: 'FBM' }, { value: 'fba', label: 'FBA' }, { value: 'local', label: 'Local' }]} />
            <Select dense className="w-40" value={filters.countryId} onChange={(v) => set({ countryId: v })}
              options={[{ value: '', label: 'All countries' }, ...(countries ?? []).map((c) => ({ value: c.id, label: c.name }))]} />

            <div className="flex-1" />
            <div className="hseg">
              <button className={!filters.incVat ? 'hseg-on' : ''} onClick={() => set({ incVat: false })}>excl. VAT</button>
              <button className={filters.incVat ? 'hseg-on' : ''} onClick={() => set({ incVat: true })}>incl. VAT</button>
            </div>
          </>
        }
      />

      {chips.length > 0 && (
        <div className="-mt-2 mb-4 flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span key={c.label} className="inline-flex items-center gap-1.5 rounded-pill bg-teal-50 py-1 pl-3 pr-1.5 text-[12px] font-semibold text-teal-700">
              {c.label}
              <button onClick={c.onRemove} className="grid h-[17px] w-[17px] place-items-center rounded-full bg-n-0 text-teal-700 hover:bg-teal-100"><X size={11} /></button>
            </span>
          ))}
          <button onClick={reset} className="px-2 py-1 text-[12px] font-semibold text-n-500 hover:text-n-700">Reset</button>
        </div>
      )}
    </>
  );
}

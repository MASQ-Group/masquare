import { CalendarDays, X } from 'lucide-react';
import { DateRangePicker, Select } from '@masquare/ui';
import { useAnalyticsFilters, useChannelOptions, useCountryOptions } from './useAnalytics';

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

/** Small labelled wrapper matching the existing analytics toolbar Field. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-n-400">{label}</span>
      {children}
    </div>
  );
}

/** The module-wide filter bar: date range, comparison, channel, fulfilment, country,
 *  and a VAT incl/excl toggle — all persisted and shared across the analytics pages.
 *  Uses the platform Select (not native dropdowns) per the design brief. */
export function AnalyticsFilterBar() {
  const { filters, set, reset, rangeLabel, compare, compareLabel } = useAnalyticsFilters();
  const { data: channels } = useChannelOptions();
  const { data: countries } = useCountryOptions();

  const chips: { label: string; onRemove: () => void }[] = [];
  if (filters.channelId) chips.push({ label: `Channel: ${channels?.find((c) => c.id === filters.channelId)?.name ?? '—'}`, onRemove: () => set({ channelId: '' }) });
  if (filters.fulfilment !== 'all') chips.push({ label: `Fulfilment: ${filters.fulfilment.toUpperCase()}`, onRemove: () => set({ fulfilment: 'all' }) });
  if (filters.countryId) chips.push({ label: `Country: ${countries?.find((c) => c.id === filters.countryId)?.name ?? '—'}`, onRemove: () => set({ countryId: '' }) });
  if (filters.incVat) chips.push({ label: 'Revenue incl. VAT', onRemove: () => set({ incVat: false }) });

  return (
    <div className="sticky top-0 z-20 -mt-1 mb-5 flex flex-col gap-2 rounded-lg border border-n-200 bg-n-0/95 p-3 backdrop-blur">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Range">
          <div className="flex items-center gap-2">
            <CalendarDays size={15} className="text-n-400" />
            <Select
              dense className="w-40" value={filters.rangePreset}
              onChange={(v) => set({ rangePreset: v as any })}
              options={[
                { value: 'mtd', label: 'Month to date' },
                { value: 'prev_month', label: 'Previous month' },
                { value: 'ytd', label: 'Year to date' },
                { value: 'year', label: 'Specific year' },
                { value: 'quarter', label: 'Specific quarter' },
                { value: 'custom', label: 'Custom range' },
              ]}
            />
            <span className="mono whitespace-nowrap text-[11.5px] text-n-500">{rangeLabel}</span>
          </div>
        </Field>
        {(filters.rangePreset === 'year' || filters.rangePreset === 'quarter') && (
          <Field label="Year">
            <Select dense className="w-24" value={String(filters.year)} onChange={(v) => set({ year: Number(v) })}
              options={YEARS.map((y) => ({ value: String(y), label: String(y) }))} />
          </Field>
        )}
        {filters.rangePreset === 'quarter' && (
          <Field label="Quarter">
            <Select dense className="w-20" value={String(filters.quarter)} onChange={(v) => set({ quarter: Number(v) })}
              options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: `Q${q}` }))} />
          </Field>
        )}
        {filters.rangePreset === 'custom' && (
          <Field label="Custom range"><div className="w-[15rem]"><DateRangePicker value={filters.custom} onChange={(v) => set({ custom: v })} /></div></Field>
        )}

        <div className="mx-0.5 h-9 w-px self-end bg-n-200" />

        <Field label="Compare to">
          <div className="flex items-center gap-2">
            <Select dense className="w-[15.5rem]" value={filters.comparePreset} onChange={(v) => set({ comparePreset: v as any })}
              options={[
                { value: 'prev_period', label: 'Previous period' },
                { value: 'prev_month', label: 'Same period, previous month' },
                { value: 'prev_year', label: 'Same period, previous year' },
                { value: 'custom', label: 'Custom' },
                { value: 'none', label: 'No comparison' },
              ]} />
            {compare && <span className="mono whitespace-nowrap text-[11.5px] text-n-500">{compareLabel}</span>}
          </div>
        </Field>
        {filters.comparePreset === 'custom' && (
          <Field label="Compare range"><div className="w-[15rem]"><DateRangePicker value={filters.customCompare} onChange={(v) => set({ customCompare: v })} /></div></Field>
        )}

        <Field label="Channel">
          <Select dense className="w-44" value={filters.channelId} onChange={(v) => set({ channelId: v })}
            options={[{ value: '', label: 'All channels' }, ...(channels ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        </Field>
        <Field label="Fulfilment">
          <Select dense className="w-36" value={filters.fulfilment} onChange={(v) => set({ fulfilment: v })}
            options={[
              { value: 'all', label: 'All fulfilment' },
              { value: 'fbm', label: 'FBM' },
              { value: 'fba', label: 'FBA' },
              { value: 'local', label: 'Local' },
            ]} />
        </Field>
        <Field label="Country">
          <Select dense className="w-44" value={filters.countryId} onChange={(v) => set({ countryId: v })}
            options={[{ value: '', label: 'All countries' }, ...(countries ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        </Field>

        <div className="ml-auto self-end">
          <div className="inline-flex rounded-md bg-n-100 p-[3px]">
            {([['excl', 'Revenue excl. VAT'], ['incl', 'incl. VAT']] as const).map(([k, lbl]) => {
              const active = (k === 'incl') === filters.incVat;
              return (
                <button key={k} onClick={() => set({ incVat: k === 'incl' })}
                  className={`rounded-[6px] px-3 py-[6px] text-[12.5px] font-semibold transition-colors ${active ? 'bg-n-0 text-n-900 shadow-sm' : 'text-n-500 hover:text-n-700'}`}>
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span key={c.label} className="inline-flex items-center gap-1.5 rounded-pill bg-teal-50 py-1 pl-3 pr-1.5 text-[12px] font-semibold text-teal-700">
              {c.label}
              <button onClick={c.onRemove} className="grid h-[17px] w-[17px] place-items-center rounded-full bg-n-0 text-teal-700 hover:bg-teal-100"><X size={11} /></button>
            </span>
          ))}
          <button onClick={reset} className="px-2 py-1 text-[12px] font-semibold text-n-500 hover:text-n-700">Reset</button>
        </div>
      )}
    </div>
  );
}

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, countriesApi, salesChannelsApi, type AnalyticsSalesParams } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { compareRange, presetRange, prettyRange, type ComparePreset, type DateRange, type RangePreset } from '../../lib/analyticsRange';

/** The module-wide filter model, shared across every analytics page and persisted
 *  so the selection survives navigation between the sub-pages. Company scoping comes
 *  from the sidebar CompanySwitcher (activeCompanyId), not a duplicate control here. */
export interface AnalyticsFilters {
  rangePreset: RangePreset;
  year: number;
  quarter: number;
  custom: DateRange;
  comparePreset: ComparePreset;
  customCompare: DateRange;
  incVat: boolean;
  channelId: string; // '' = all channels
  fulfilment: string; // 'all' | 'fbm' | 'fba' | 'local'
  countryId: string; // '' = all countries
}

const STORAGE_KEY = 'analytics.filters.v1';

const defaults = (): AnalyticsFilters => {
  const now = new Date();
  return {
    rangePreset: 'mtd',
    year: now.getFullYear(),
    quarter: Math.floor(now.getMonth() / 3) + 1,
    custom: { from: presetRange('mtd', {}).from, to: presetRange('mtd', {}).to },
    comparePreset: 'prev_period',
    customCompare: { from: '', to: '' },
    incVat: false,
    channelId: '',
    fulfilment: 'all',
    countryId: '',
  };
};

function load(): AnalyticsFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch { /* ignore corrupt state */ }
  return defaults();
}

interface Ctx {
  filters: AnalyticsFilters;
  set: (patch: Partial<AnalyticsFilters>) => void;
  reset: () => void;
  range: DateRange;
  compare: DateRange | null;
  rangeLabel: string;
  compareLabel: string;
  params: AnalyticsSalesParams;
}

const AnalyticsCtx = createContext<Ctx | null>(null);

export function AnalyticsFilterProvider({ children }: { children: ReactNode }) {
  const { activeCompanyId } = useAuth();
  const [filters, setFilters] = useState<AnalyticsFilters>(load);

  const set = (patch: Partial<AnalyticsFilters>) =>
    setFilters((f) => {
      const next = { ...f, ...patch };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  const reset = () => {
    const d = defaults();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch { /* ignore */ }
    setFilters(d);
  };

  const range = useMemo(
    () => presetRange(filters.rangePreset, { year: filters.year, quarter: filters.quarter, custom: filters.custom }),
    [filters.rangePreset, filters.year, filters.quarter, filters.custom],
  );
  const compare = useMemo(() => compareRange(range, filters.comparePreset, filters.customCompare), [range, filters.comparePreset, filters.customCompare]);

  const params: AnalyticsSalesParams = {
    from: range.from,
    to: range.to,
    compareFrom: compare?.from,
    compareTo: compare?.to,
    companyId: activeCompanyId || undefined,
    channelId: filters.channelId || undefined,
    countryId: filters.countryId || undefined,
    fulfilment: filters.fulfilment !== 'all' ? filters.fulfilment : undefined,
  };

  const value: Ctx = {
    filters, set, reset, range, compare,
    rangeLabel: prettyRange(range),
    compareLabel: compare ? prettyRange(compare) : 'No comparison',
    params,
  };
  return <AnalyticsCtx.Provider value={value}>{children}</AnalyticsCtx.Provider>;
}

export function useAnalyticsFilters(): Ctx {
  const ctx = useContext(AnalyticsCtx);
  if (!ctx) throw new Error('useAnalyticsFilters must be used within AnalyticsFilterProvider');
  return ctx;
}

/** Shared report query — keyed on params so every page reuses one cached fetch. */
export function useAnalyticsReport() {
  const { params } = useAnalyticsFilters();
  return useQuery({ queryKey: ['analytics-sales', params], queryFn: () => analyticsApi.sales(params) });
}

/** Full channel/country lists for the filter selects (independent of the active range). */
export function useChannelOptions() {
  return useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
}
export function useCountryOptions() {
  return useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });
}

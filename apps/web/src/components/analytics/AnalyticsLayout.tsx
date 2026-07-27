import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { AnalyticsFilterProvider } from './useAnalytics';
import { AnalyticsFilterBar } from './AnalyticsFilterBar';

/** Shared layout for every /analytics/* page: provides the filter context and renders
 *  the persistent filter bar above the routed page content. */
export function AnalyticsLayout() {
  return (
    <AnalyticsFilterProvider>
      <div className="w-full">
        <AnalyticsFilterBar />
        {/* Own Suspense so switching analytics sub-tabs only swaps the chart area,
            keeping the filter bar steady while the next chunk loads. */}
        <Suspense fallback={<div className="grid h-40 place-items-center text-[13px] text-n-500">Loading…</div>}>
          <Outlet />
        </Suspense>
      </div>
    </AnalyticsFilterProvider>
  );
}

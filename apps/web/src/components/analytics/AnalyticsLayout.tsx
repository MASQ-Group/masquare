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
        <Outlet />
      </div>
    </AnalyticsFilterProvider>
  );
}

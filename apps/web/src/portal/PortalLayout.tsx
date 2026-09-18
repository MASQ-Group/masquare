import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Archive, PackagePlus, Package, Truck } from 'lucide-react';
import { portalApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { RouteBoundary } from '../components/common/RouteBoundary';

/**
 * The shell a customer's own people see.
 *
 * Deliberately not the platform's shell: no sidebar of modules they cannot open, no company
 * switcher, no global search across records that are not theirs. Three places to be — file one,
 * follow the ones in progress, look back at the archived — and their own company's name at the top,
 * because somebody who files for two companies needs to know which one they are in.
 */
export function PortalLayout() {
  const { user, signOut } = useAuth();
  const { data } = useQuery({ queryKey: ['portal', 'home'], queryFn: portalApi.home, refetchInterval: 120_000 });

  const tab = 'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors';
  const active = 'bg-teal-50 text-teal-700';
  const idle = 'text-n-600 hover:bg-n-100';

  return (
    <div className="min-h-screen bg-n-50">
      <header className="border-b border-n-200 bg-n-0">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-3 px-6 py-3 max-[560px]:px-4">
          <Truck size={20} className="text-teal-600" />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-n-900">{data?.customer.name ?? 'Shipments'}</div>
            <div className="text-[12px] text-n-500">Shipments with maSquare</div>
          </div>
          <div className="flex-1" />
          <span className="text-[12.5px] text-n-500 max-[560px]:hidden">{user?.email}</span>
          <button type="button" className="hbtn" onClick={() => signOut()}>Sign out</button>
        </div>

        <nav className="mx-auto flex max-w-[1100px] gap-1 px-6 pb-2 max-[560px]:px-4">
          <NavLink to="/portal/new" className={({ isActive }) => `${tab} ${isActive ? active : idle}`}>
            <PackagePlus size={15} /> New shipment
          </NavLink>
          <NavLink to="/portal" end className={({ isActive }) => `${tab} ${isActive ? active : idle}`}>
            <Truck size={15} /> In progress
            {/* The count that matters is the one waiting on them, not the total. */}
            {(data?.counts.needsInfo ?? 0) > 0 && (
              <span className="rounded-full bg-warning-bg px-1.5 text-[11px] font-bold text-warning">{data!.counts.needsInfo}</span>
            )}
          </NavLink>
          <NavLink to="/portal/archived" className={({ isActive }) => `${tab} ${isActive ? active : idle}`}>
            <Archive size={15} /> Archived
          </NavLink>
          {/* Their own catalogue. Last, because nobody has to visit it — it only saves typing. */}
          <NavLink to="/portal/products" className={({ isActive }) => `${tab} ${isActive ? active : idle}`}>
            <Package size={15} /> Products
          </NavLink>
        </nav>
      </header>

      <main className="mx-auto max-w-[1100px] px-6 py-6 max-[560px]:px-4">
        {/*
          The boundary the platform's own shell has, and this one shipped without.
          Every portal page is a lazily-loaded chunk; with nothing to catch the suspension while it
          arrives, React rendered nothing at all — a white screen that came right only when the
          browser was refreshed and the chunk was already in cache. The error boundary sits outside
          it so a chunk that fails to load says so rather than unmounting the shell.
        */}
        <RouteBoundary>
          <Suspense fallback={<div className="grid place-items-center py-16 text-[13px] text-n-500">Loading…</div>}>
            <Outlet />
          </Suspense>
        </RouteBoundary>
      </main>
    </div>
  );
}

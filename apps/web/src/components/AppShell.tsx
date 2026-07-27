import { Suspense, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Building2,
  CircleDollarSign,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Coins,
  Container,
  FolderTree,
  Globe,
  HelpCircle,
  Tags,
  Wallet,
  LayoutGrid,
  LayoutDashboard,
  LineChart,
  Menu,
  ScanBarcode,
  Boxes,
  PackageX,
  RotateCcw,
  Undo2,
  ClipboardCheck,
  ShoppingCart,
  ClipboardList,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Receipt,
  Search,
  Settings,
  SlidersHorizontal,
  Tag,
  Truck,
  Share2,
  Store,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';
import { settingsApi } from '../lib/api';
import { applyFonts } from '../lib/fonts';
import { CompanySwitcher } from './CompanySwitcher';
import { GlobalSearch } from './GlobalSearch';

interface NavDef {
  to?: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  adminOnly?: boolean;
  disabled?: boolean;
  exact?: boolean; // match this route only, not its sub-paths (e.g. /analytics vs /analytics/sales)
}

/** Non-empty only on the demo/testing build (set via VITE_ENV_LABEL in .env.demo). */
const ENV_LABEL: string = import.meta.env.VITE_ENV_LABEL ?? '';

/** The two read-only dashboards sit above the grouped sections, with no header. */
const TOP_LEVEL: NavDef[] = [
  { to: '/', label: 'Overview', icon: LayoutGrid },
];

/**
 * Grouped by what the user is actually doing, in workflow order: money in, money
 * out, what we sell and where it sits, then the rarely-touched configuration.
 * A group whose items are all hidden (admin-only, non-admin viewer) renders nothing.
 */
const NAV_GROUPS: { label: string; items: NavDef[] }[] = [
  {
    label: 'Sales',
    items: [
      { to: '/sales-transactions', label: 'Sales Transactions', icon: Receipt },
      { to: '/shipments', label: 'Shipments', icon: Truck },
      { to: '/fba-shipments', label: 'FBA Shipments', icon: Container },
    ],
  },
  {
    label: 'Pricing',
    items: [
      { to: '/pricing/individual', label: 'Individual Pricing', icon: CircleDollarSign },
      { to: '/pricing/bulk', label: 'Bulk Pricing', icon: SlidersHorizontal },
    ],
  },
  {
    label: 'Sales channels',
    items: [
      { to: '/channel-listings', label: 'Channel Listings', icon: Share2 },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/analytics', label: 'Overview', icon: LayoutDashboard, exact: true },
      { to: '/analytics/sales', label: 'Sales', icon: LineChart },
      { to: '/analytics/profitability', label: 'Profitability & Fees', icon: Coins },
      { to: '/analytics/products', label: 'Products', icon: Package },
      { to: '/analytics/countries', label: 'Countries & VAT', icon: Globe },
      { to: '/analytics/returns', label: 'Returns & Refunds', icon: RotateCcw },
    ],
  },
  {
    label: 'Purchasing',
    items: [
      { to: '/procurement', label: 'Procurement', icon: ShoppingCart },
      { to: '/purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
      { to: '/goods-receipts', label: 'Goods Receipts', icon: ClipboardCheck },
      { to: '/vendor-returns', label: 'Returns to Vendor', icon: Undo2 },
    ],
  },
  {
    label: 'Catalogue & Inventory',
    items: [
      { to: '/products', label: 'Products', icon: Package },
      { to: '/inventory', label: 'Inventory', icon: Boxes },
      { to: '/availability', label: 'Availability', icon: Store },
      { to: '/stock-owed', label: 'Stock Owed', icon: PackageX },
      { to: '/warehouses', label: 'Warehouses', icon: Warehouse },
      { to: '/serials', label: 'Serial Numbers', icon: ScanBarcode },
    ],
  },
  {
    label: 'Expenses',
    items: [
      { to: '/expenses', label: 'Expenses', icon: Wallet, exact: true },
      { to: '/expenses/names', label: 'Expense Names', icon: Tags },
      { to: '/expenses/tags', label: 'Tags', icon: Tag },
      { to: '/expenses/categories', label: 'Categories', icon: FolderTree },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/integrations', label: 'Integrations', icon: Plug, adminOnly: true },
      { to: '/settings', label: 'Global settings', icon: SlidersHorizontal },
      { to: '/companies', label: 'Companies', icon: Building2, adminOnly: true },
      { to: '/users', label: 'Users & roles', icon: Users, adminOnly: true },
      { to: '/modules', label: 'Modules & sharing', icon: Settings, adminOnly: true },
    ],
  },
];

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('sidebar-collapsed-groups') ?? '[]')); } catch { return new Set(); }
  });
  const searchRef = useRef<HTMLInputElement>(null);

  const toggleGroup = (label: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      localStorage.setItem('sidebar-collapsed-groups', JSON.stringify([...next]));
      return next;
    });

  const groupLabels = NAV_GROUPS.map((g) => g.label);
  const allGroupsCollapsed = groupLabels.every((l) => collapsedGroups.has(l));
  const toggleAllGroups = () => {
    const next = allGroupsCollapsed ? new Set<string>() : new Set(groupLabels);
    localStorage.setItem('sidebar-collapsed-groups', JSON.stringify([...next]));
    setCollapsedGroups(next);
  };

  // Apply the platform fonts once settings load (and whenever an admin changes them).
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  useEffect(() => {
    if (settings) applyFonts(settings.bodyFont, settings.monoFont);
  }, [settings?.bodyFont, settings?.monoFont]);

  useEffect(() => { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0'); }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const renderNav = (items: NavDef[]) =>
    items
      .filter((i) => !i.adminOnly || user?.isAdmin)
      .map((item) => {
        const Icon = item.icon;
        if (item.disabled || !item.to) {
          return (
            <div
              key={item.label}
              title={collapsed ? `${item.label}${item.badge ? ` (${item.badge})` : ''}` : undefined}
              className={[
                'flex w-full cursor-not-allowed items-center rounded-md py-2.5 text-[13.5px] font-medium text-n-300/70',
                collapsed ? 'justify-center px-0' : 'gap-3 px-3',
              ].join(' ')}
            >
              <Icon size={18} />
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && item.badge && (
                <span className="rounded-pill bg-white/[0.08] px-2 py-0.5 font-mono text-[11px] text-n-300">
                  {item.badge}
                </span>
              )}
            </div>
          );
        }
        return (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.to === '/' || item.exact}
            title={collapsed ? item.label : undefined}
            onClick={() => setDrawerOpen(false)}
            className={({ isActive }) =>
              [
                'relative flex w-full items-center rounded-md py-2.5 text-[13.5px] font-medium transition-colors',
                collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                isActive
                  ? 'bg-teal-500/[0.16] text-white before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r before:bg-teal-400'
                  : 'text-n-300 hover:bg-white/[0.06] hover:text-white',
              ].join(' ')
            }
          >
            <Icon size={18} />
            {!collapsed && <span className="flex-1">{item.label}</span>}
            {!collapsed && item.badge && (
              <span className="rounded-pill bg-white/[0.08] px-2 py-0.5 font-mono text-[11px] text-n-300">
                {item.badge}
              </span>
            )}
          </NavLink>
        );
      });

  return (
    <div className={[
      'grid h-screen overflow-hidden max-[760px]:grid-cols-1',
      collapsed ? 'grid-cols-[var(--rail-w)_1fr]' : 'grid-cols-[var(--sidebar-w)_1fr]',
    ].join(' ')}>
      {/* Sidebar */}
      <aside
        className={[
          'flex min-h-0 flex-col overflow-hidden border-r border-n-950 bg-n-900 text-n-300',
          'max-[760px]:fixed max-[760px]:inset-y-0 max-[760px]:left-0 max-[760px]:z-[60] max-[760px]:w-[var(--sidebar-w)] max-[760px]:transition-transform',
          drawerOpen ? 'max-[760px]:translate-x-0' : 'max-[760px]:-translate-x-full',
        ].join(' ')}
      >
        <div className={[
          'flex h-[var(--topbar-h)] flex-shrink-0 items-center border-b border-white/[0.06]',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-[18px]',
        ].join(' ')}>
          <img
            src={collapsed ? '/masq-mark.svg' : '/masq-logo.svg'}
            alt="maSquare"
            className={collapsed ? 'h-[26px] w-auto flex-shrink-0' : 'h-[28px] w-auto'}
          />
        </div>

        <CompanySwitcher collapsed={collapsed} />

        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
          {!collapsed && (
            <div className="flex justify-end px-3 pt-2.5">
              <button
                onClick={toggleAllGroups}
                title={allGroupsCollapsed ? 'Expand all sections' : 'Collapse all sections'}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-n-400 hover:bg-white/[0.06] hover:text-n-200"
              >
                {allGroupsCollapsed ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}
                {allGroupsCollapsed ? 'Expand all' : 'Collapse all'}
              </button>
            </div>
          )}

          {/* Dashboards first, ungrouped. */}
          <div className={collapsed ? 'px-2 pt-2.5' : 'px-3 pt-1'}>{renderNav(TOP_LEVEL)}</div>

          {NAV_GROUPS.map((group) => {
            // Skip the whole section when the viewer can't see any of its items.
            const visible = group.items.filter((i) => !i.adminOnly || user?.isAdmin);
            if (visible.length === 0) return null;
            // Section collapse applies only in the expanded sidebar; the rail shows all items.
            const groupOpen = collapsed || !collapsedGroups.has(group.label);
            return (
              <div key={group.label} className={collapsed ? 'px-2 pb-1 pt-2.5' : 'px-3 pb-1 pt-2.5'}>
                {collapsed ? (
                  <div className="mx-2 my-1.5 border-t border-white/[0.06]" />
                ) : (
                  <button
                    onClick={() => toggleGroup(group.label)}
                    title={groupOpen ? `Collapse ${group.label}` : `Expand ${group.label}`}
                    className="group flex w-full items-center justify-between rounded-md px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-n-400 transition-colors hover:text-n-200"
                  >
                    <span>{group.label}</span>
                    {groupOpen
                      ? <ChevronDown size={13} className="opacity-50 group-hover:opacity-100" />
                      : <ChevronRight size={13} className="opacity-50 group-hover:opacity-100" />}
                  </button>
                )}
                {groupOpen && renderNav(visible)}
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-1 border-t border-white/[0.06] p-3">
          <button
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={[
              'flex items-center rounded-md p-2 text-n-300 hover:bg-white/[0.06] hover:text-white',
              collapsed ? 'justify-center' : 'gap-2.5',
            ].join(' ')}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span className="text-[12.5px] font-medium">Collapse</span>}
          </button>
          <button
            onClick={() => {
              signOut();
              navigate('/login');
            }}
            className={[
              'flex items-center rounded-md p-2 text-left hover:bg-white/[0.06]',
              collapsed ? 'justify-center' : 'gap-2.5',
            ].join(' ')}
            title={collapsed ? `${user?.fullName ?? ''} — Sign out` : 'Sign out'}
          >
            <div className="grid h-[30px] w-[30px] flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-[12px] font-semibold text-white">
              {initials(user?.fullName ?? 'U')}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-white">{user?.fullName}</div>
                <div className="text-[11px] text-n-400">{user?.isAdmin ? 'Administrator' : 'Member'}</div>
              </div>
            )}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-h-0 min-w-0 flex-col bg-n-50">
        <header className="relative z-40 flex h-[var(--topbar-h)] flex-shrink-0 items-center gap-4 border-b border-n-200 bg-n-0 px-5">
          <button
            className="hidden max-[760px]:grid h-[38px] w-[38px] place-items-center rounded-md text-n-600 hover:bg-n-100"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <Menu size={19} />
          </button>

          {ENV_LABEL && (
            <span
              title="You are on the demo/testing environment — a separate database. Nothing here affects live data."
              className="flex-shrink-0 rounded-md border border-warning-bd bg-warning-bg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-warning"
            >
              {ENV_LABEL}
            </span>
          )}

          <GlobalSearch
            inputRef={searchRef}
            open={searchOpen}
            setOpen={setSearchOpen}
            onNavigate={(to) => navigate(to)}
          />

          <div className="ml-auto flex items-center gap-1.5">
            <button className="grid h-[38px] w-[38px] place-items-center rounded-md text-n-600 hover:bg-n-100" title="Help">
              <HelpCircle size={19} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto px-8 py-7 max-[760px]:px-4 max-[760px]:py-5">
          {/* Suspense boundary for lazily-loaded route chunks; the shell stays put. */}
          <Suspense fallback={<div className="grid h-full place-items-center text-[13px] text-n-500">Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* Mobile scrim */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[55] bg-[rgba(12,16,20,0.5)] min-[761px]:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}

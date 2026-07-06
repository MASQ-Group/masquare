import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Boxes,
  Building2,
  ChevronDown,
  Container,
  HelpCircle,
  LayoutGrid,
  LineChart,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Receipt,
  Search,
  Settings,
  SlidersHorizontal,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';
import { CompanySwitcher } from './CompanySwitcher';
import { GlobalSearch } from './GlobalSearch';

interface NavDef {
  to?: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  adminOnly?: boolean;
  disabled?: boolean;
}

const OPERATIONS: NavDef[] = [
  { to: '/products', label: 'Products', icon: Package },
  { to: '/sales-transactions', label: 'Sales Transactions', icon: Receipt },
  { to: '/shipments', label: 'Shipments', icon: Truck },
  { to: '/fba-shipments', label: 'FBA Shipments', icon: Container },
  { label: 'Inventory', icon: Boxes, badge: 'soon', disabled: true },
  { label: 'Warehouses', icon: Warehouse, badge: 'soon', disabled: true },
  { to: '/integrations', label: 'Integrations', icon: Plug, adminOnly: true },
  { to: '/analytics', label: 'Analytics', icon: LineChart },
];

const ADMIN: NavDef[] = [
  { to: '/', label: 'Overview', icon: LayoutGrid },
  { to: '/companies', label: 'Companies', icon: Building2, adminOnly: true },
  { to: '/users', label: 'Users & roles', icon: Users, adminOnly: true },
  { to: '/modules', label: 'Modules & sharing', icon: Settings, adminOnly: true },
  { to: '/settings', label: 'Global settings', icon: SlidersHorizontal },
];

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1');
  const searchRef = useRef<HTMLInputElement>(null);

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
            end={item.to === '/'}
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
      'grid h-screen max-[760px]:grid-cols-1',
      collapsed ? 'grid-cols-[var(--rail-w)_1fr]' : 'grid-cols-[var(--sidebar-w)_1fr]',
    ].join(' ')}>
      {/* Sidebar */}
      <aside
        className={[
          'flex flex-col overflow-hidden border-r border-n-950 bg-n-900 text-n-300',
          'max-[760px]:fixed max-[760px]:inset-y-0 max-[760px]:left-0 max-[760px]:z-[60] max-[760px]:w-[var(--sidebar-w)] max-[760px]:transition-transform',
          drawerOpen ? 'max-[760px]:translate-x-0' : 'max-[760px]:-translate-x-full',
        ].join(' ')}
      >
        <div className={[
          'flex h-[var(--topbar-h)] flex-shrink-0 items-center border-b border-white/[0.06]',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-[18px]',
        ].join(' ')}>
          <div className="grid h-[30px] w-[30px] flex-shrink-0 place-items-center rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 text-[15px] font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">
            m
          </div>
          {!collapsed && (
            <div className="text-[15px] font-semibold tracking-tight text-white">
              ma<span className="text-green-400">Square</span>
            </div>
          )}
        </div>

        <CompanySwitcher collapsed={collapsed} />

        <div className={collapsed ? 'px-2 pb-1 pt-2.5' : 'px-3 pb-1 pt-2.5'}>
          {collapsed
            ? <div className="mx-2 my-1.5 border-t border-white/[0.06]" />
            : <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-n-400">Operations</div>}
          {renderNav(OPERATIONS)}
        </div>
        <div className={collapsed ? 'px-2 pb-1 pt-2.5' : 'px-3 pb-1 pt-2.5'}>
          {collapsed
            ? <div className="mx-2 my-1.5 border-t border-white/[0.06]" />
            : <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-n-400">Administration</div>}
          {renderNav(ADMIN)}
        </div>

        <div className="flex-1" />
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
      <div className="flex min-w-0 flex-col bg-n-50">
        <header className="relative z-40 flex h-[var(--topbar-h)] flex-shrink-0 items-center gap-4 border-b border-n-200 bg-n-0 px-5">
          <button
            className="hidden max-[760px]:grid h-[38px] w-[38px] place-items-center rounded-md text-n-600 hover:bg-n-100"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <Menu size={19} />
          </button>

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
          <Outlet />
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

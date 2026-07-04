import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, ChevronDown, Flag, Globe, LayoutGrid, Lightbulb, Package,
  Receipt, Search, Settings, Store, Truck, Users, type LucideIcon,
} from 'lucide-react';
import { searchApi, type SearchHit, type SearchScope } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Props {
  inputRef: React.RefObject<HTMLInputElement>;
  open: boolean;
  setOpen: (v: boolean) => void;
  onNavigate: (to: string) => void;
}

const PAGES = [
  { label: 'Overview', to: '/', icon: LayoutGrid, admin: false },
  { label: 'Products', to: '/products', icon: Package, admin: false },
  { label: 'Sales transactions', to: '/sales-transactions', icon: Receipt, admin: false },
  { label: 'Global settings', to: '/settings', icon: Settings, admin: false },
  { label: 'Companies', to: '/companies', icon: Building2, admin: true },
  { label: 'Users & roles', to: '/users', icon: Users, admin: true },
  { label: 'Modules & sharing', to: '/modules', icon: Settings, admin: true },
];

/** Everything the client knows about each searchable module: display, scoping and navigation. */
const MODULES: Record<Exclude<SearchScope, 'all'>, { label: string; icon: LucideIcon; adminOnly?: boolean; target: (hit?: SearchHit, q?: string) => string }> = {
  'products': { label: 'Products', icon: Package, target: (hit, q) => `/products?q=${encodeURIComponent(hit?.sub ?? hit?.label ?? q ?? '')}` },
  'sales-transactions': { label: 'Sales Transactions', icon: Receipt, target: (hit, q) => `/sales-transactions?q=${encodeURIComponent(hit?.label ?? q ?? '')}` },
  'sales-channels': { label: 'Sales Channels', icon: Store, target: () => '/settings?tab=sales-channels' },
  'countries': { label: 'Countries', icon: Flag, target: () => '/settings?tab=countries' },
  'shipping-services': { label: 'Shipping Services', icon: Truck, target: () => '/settings?tab=shipping-services' },
  'companies': { label: 'Companies', icon: Building2, adminOnly: true, target: () => '/companies' },
  'users': { label: 'Users', icon: Users, adminOnly: true, target: () => '/users' },
};

const SCOPES: SearchScope[] = ['all', 'products', 'sales-transactions', 'sales-channels', 'countries', 'shipping-services', 'companies', 'users'];

/** Guess what the user typed to suggest the modules most likely to hold it. */
function detectSuggestions(raw: string, isAdmin: boolean): { scope: Exclude<SearchScope, 'all'>; hint: string }[] {
  const q = raw.trim();
  const out: { scope: Exclude<SearchScope, 'all'>; hint: string }[] = [];
  const single = !/\s/.test(q); // single tokens (SKUs, IDs, codes) are the classifiable case

  if (/^\d{2,3}-\d{5,}-\d{5,}$/.test(q) || (single && /^\d{6,}$/.test(q))) {
    out.push({ scope: 'sales-transactions', hint: 'looks like a transaction ID' });
  }
  if (single && /^[A-Za-z0-9][A-Za-z0-9._/-]{2,}$/.test(q) && /\d/.test(q) && !/^\d+$/.test(q)) {
    out.push({ scope: 'products', hint: 'looks like a SKU' });
    if (!out.some((s) => s.scope === 'sales-transactions')) out.push({ scope: 'sales-transactions', hint: 'SKUs appear in transactions' });
  }
  if (single && /^\d{8,14}$/.test(q)) {
    if (!out.some((s) => s.scope === 'products')) out.push({ scope: 'products', hint: 'looks like an EAN/UPC' });
  }
  if (/^[A-Za-z]{2}$/.test(q)) {
    out.push({ scope: 'countries', hint: 'looks like an ISO country code' });
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q) && isAdmin) {
    out.push({ scope: 'users', hint: 'looks like an email address' });
  }
  return out.slice(0, 3);
}

/** Top-bar command palette (Design System §5). ⌘K focuses it. Searches every module the
 *  user can see; the scope dropdown narrows it, and typed input is classified (transaction
 *  ID, SKU, ISO code, email) to suggest the most likely modules. */
export function GlobalSearch({ inputRef, open, setOpen, onNavigate }: Props) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [scopeOpen, setScopeOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); setScopeOpen(false); }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [setOpen]);

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  const { data: results, isFetching } = useQuery({
    queryKey: ['global-search', debounced, scope],
    queryFn: () => searchApi.global(debounced, scope),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });

  const query = q.trim().toLowerCase();
  const suggestions = useMemo(
    () => (query.length >= 2 ? detectSuggestions(q, isAdmin).filter((s) => !MODULES[s.scope].adminOnly || isAdmin) : []),
    [q, query, isAdmin],
  );
  const companies = useMemo(
    () => (user?.companies ?? []).filter((c) => query && c.officialName.toLowerCase().includes(query)),
    [user, query],
  );
  const pages = useMemo(
    () => PAGES.filter((p) => (!p.admin || isAdmin) && query && p.label.toLowerCase().includes(query)),
    [isAdmin, query],
  );

  const groups = (results?.groups ?? []).filter((g) => g.module in MODULES);
  const hasAny = groups.length > 0 || pages.length > 0 || companies.length > 0 || suggestions.length > 0;

  const go = (to: string) => {
    onNavigate(to);
    setOpen(false);
    setScopeOpen(false);
    setQ('');
  };

  const onEnter = () => {
    if (!query) return;
    if (scope !== 'all') { go(MODULES[scope].target(undefined, q.trim())); return; }
    if (suggestions.length > 0) { go(MODULES[suggestions[0].scope].target(undefined, q.trim())); return; }
    const first = groups[0];
    if (first) go(MODULES[first.module as Exclude<SearchScope, 'all'>].target(first.items[0], q.trim()));
  };

  const scopeLabel = scope === 'all' ? 'All modules' : MODULES[scope].label;

  return (
    <div ref={wrapRef} className="relative max-w-[620px] flex-1">
      <div className="flex h-10 items-center overflow-hidden rounded-md border border-n-200 bg-n-50 focus-within:border-teal-400 focus-within:bg-n-0 focus-within:ring-[3px] focus-within:ring-teal-50">
        <button
          type="button"
          className="flex h-full items-center gap-1.5 border-r border-n-200 bg-n-100 px-3 text-[12.5px] font-semibold text-n-700 hover:bg-n-200/60 max-[760px]:px-2.5"
          onClick={() => setScopeOpen((v) => !v)}
        >
          <span className="max-[760px]:hidden">{scopeLabel}</span>
          <ChevronDown size={14} className={`opacity-70 transition-transform ${scopeOpen ? 'rotate-180' : ''}`} />
        </button>
        <Search size={16} className="ml-3 text-n-400" />
        <input
          ref={inputRef}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
          placeholder="Search all modules — SKU, transaction ID, product, channel…"
          className="h-full flex-1 bg-transparent px-3 text-[13.5px] text-n-800 outline-none placeholder:text-n-400"
        />
        <span className="mr-2.5 rounded border border-n-200 bg-n-0 px-1.5 py-0.5 font-mono text-[11px] text-n-400 max-[760px]:hidden">
          ⌘K
        </span>
      </div>

      {/* Scope picker */}
      {scopeOpen && (
        <div className="absolute left-0 top-12 z-50 w-56 rounded-lg border border-n-200 bg-n-0 p-1.5 shadow-lg">
          {SCOPES.filter((s) => s === 'all' || !MODULES[s].adminOnly || isAdmin).map((s) => {
            const label = s === 'all' ? 'All modules' : MODULES[s].label;
            const Icon = s === 'all' ? Globe : MODULES[s].icon;
            return (
              <button
                key={s}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-teal-50 ${scope === s ? 'bg-teal-50 font-semibold text-teal-700' : 'text-n-700'}`}
                onClick={() => { setScope(s); setScopeOpen(false); inputRef.current?.focus(); }}
              >
                <Icon size={15} className="opacity-70" /> {label}
              </button>
            );
          })}
        </div>
      )}

      {open && query.length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-40 max-h-[70vh] overflow-auto rounded-lg border border-n-200 bg-n-0 p-2 shadow-lg">
          {/* Smart suggestions */}
          {suggestions.length > 0 && (
            <>
              <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-n-500">Suggested</div>
              {suggestions.map((s) => {
                const m = MODULES[s.scope];
                const Icon = m.icon;
                return (
                  <button key={s.scope} onClick={() => go(m.target(undefined, q.trim()))} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-teal-50">
                    <div className="grid h-[30px] w-[30px] place-items-center rounded-md bg-teal-50 text-teal-700"><Lightbulb size={15} /></div>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-n-800">
                      Search <strong className="mono">{q.trim()}</strong> in {m.label}
                    </span>
                    <span className="flex items-center gap-1 whitespace-nowrap text-[11px] text-n-400"><Icon size={12} /> {s.hint}</span>
                  </button>
                );
              })}
            </>
          )}

          {/* Cross-module results */}
          {groups.map((g) => {
            const m = MODULES[g.module as Exclude<SearchScope, 'all'>];
            const Icon = m.icon;
            return (
              <div key={g.module}>
                <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-n-500">{m.label}</div>
                {g.items.map((hit) => (
                  <button key={hit.id} onClick={() => go(m.target(hit, q.trim()))} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-teal-50">
                    <div className="grid h-[30px] w-[30px] place-items-center rounded-md bg-n-100 text-n-500"><Icon size={16} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] text-n-800">{hit.label}</div>
                      {hit.sub && <div className="mono truncate text-[12px] text-n-500">{hit.sub}</div>}
                    </div>
                    <span className="rounded-pill bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">{m.label}</span>
                  </button>
                ))}
              </div>
            );
          })}

          {/* Pages & companies quick-nav */}
          {pages.length > 0 && (
            <>
              <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-n-500">Pages</div>
              {pages.map((p) => {
                const Icon = p.icon;
                return (
                  <button key={p.to} onClick={() => go(p.to)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-teal-50">
                    <div className="grid h-[30px] w-[30px] place-items-center rounded-md bg-n-100 text-n-500"><Icon size={16} /></div>
                    <span className="flex-1 text-[13.5px] text-n-800">{p.label}</span>
                  </button>
                );
              })}
            </>
          )}
          {companies.length > 0 && (
            <>
              <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-n-500">Companies</div>
              {companies.map((c) => (
                <button key={c.id} onClick={() => go(isAdmin ? '/companies' : '/')} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-teal-50">
                  <div className="grid h-[30px] w-[30px] place-items-center rounded-md bg-n-100 text-n-500"><Building2 size={16} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-n-800">{c.officialName}</div>
                    {c.registrationNumber && <div className="mono truncate text-[12px] text-n-500">{c.registrationNumber}</div>}
                  </div>
                  <span className="rounded-pill bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">Company</span>
                </button>
              ))}
            </>
          )}

          {!hasAny && (
            <div className="px-3 py-3 text-[12.5px] text-n-500">{isFetching ? 'Searching…' : `No matches for “${q.trim()}” ${scope === 'all' ? 'across modules' : `in ${scopeLabel}`}.`}</div>
          )}
        </div>
      )}

      {open && query.length < 2 && (
        <div className="absolute left-0 right-0 top-12 z-40 rounded-lg border border-n-200 bg-n-0 p-2 shadow-lg">
          <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-n-500">Pages</div>
          {PAGES.filter((p) => !p.admin || isAdmin).map((p) => {
            const Icon = p.icon;
            return (
              <button key={p.to} onClick={() => go(p.to)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-teal-50">
                <div className="grid h-[30px] w-[30px] place-items-center rounded-md bg-n-100 text-n-500"><Icon size={16} /></div>
                <span className="flex-1 text-[13.5px] text-n-800">{p.label}</span>
              </button>
            );
          })}
          <p className="px-3 pb-2 pt-2 text-[11.5px] text-n-400">Type at least two characters to search every module — SKUs, transaction IDs, products, channels, countries…</p>
        </div>
      )}
    </div>
  );
}

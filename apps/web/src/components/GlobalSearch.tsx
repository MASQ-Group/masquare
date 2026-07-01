import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ChevronDown, LayoutGrid, Search, Settings, Users } from 'lucide-react';
import { useAuth } from '../lib/auth';

interface Props {
  inputRef: React.RefObject<HTMLInputElement>;
  open: boolean;
  setOpen: (v: boolean) => void;
  onNavigate: (to: string) => void;
}

const PAGES = [
  { label: 'Overview', to: '/', icon: LayoutGrid, admin: false },
  { label: 'Companies', to: '/companies', icon: Building2, admin: true },
  { label: 'Users & roles', to: '/users', icon: Users, admin: true },
  { label: 'Modules & sharing', to: '/modules', icon: Settings, admin: true },
];

/** Top-bar command palette (Design System §5). ⌘K focuses it. In this slice it searches
 *  the user's companies and the admin pages; module/product search arrives with M2/M3. */
export function GlobalSearch({ inputRef, open, setOpen, onNavigate }: Props) {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [setOpen]);

  const query = q.trim().toLowerCase();
  const companies = useMemo(
    () => (user?.companies ?? []).filter((c) => !query || c.officialName.toLowerCase().includes(query)),
    [user, query],
  );
  const pages = useMemo(
    () =>
      PAGES.filter((p) => (!p.admin || user?.isAdmin) && (!query || p.label.toLowerCase().includes(query))),
    [user, query],
  );

  const go = (to: string) => {
    onNavigate(to);
    setOpen(false);
    setQ('');
  };

  return (
    <div ref={wrapRef} className="relative max-w-[620px] flex-1">
      <div className="flex h-10 items-center overflow-hidden rounded-md border border-n-200 bg-n-50 focus-within:border-teal-400 focus-within:bg-n-0 focus-within:ring-[3px] focus-within:ring-teal-50">
        <div className="flex h-full items-center gap-1.5 border-r border-n-200 bg-n-100 px-3 text-[12.5px] font-semibold text-n-700 max-[760px]:px-2.5">
          <span className="max-[760px]:hidden">All modules</span>
          <ChevronDown size={14} className="opacity-70" />
        </div>
        <Search size={16} className="ml-3 text-n-400" />
        <input
          ref={inputRef}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          placeholder="Search the platform — company, page…"
          className="h-full flex-1 bg-transparent px-3 text-[13.5px] text-n-800 outline-none placeholder:text-n-400"
        />
        <span className="mr-2.5 rounded border border-n-200 bg-n-0 px-1.5 py-0.5 font-mono text-[11px] text-n-400 max-[760px]:hidden">
          ⌘K
        </span>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-12 z-50 rounded-lg border border-n-200 bg-n-0 p-2 shadow-lg">
          {pages.length > 0 && (
            <>
              <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-n-500">
                Pages
              </div>
              {pages.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.to}
                    onClick={() => go(p.to)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-teal-50"
                  >
                    <div className="grid h-[30px] w-[30px] place-items-center rounded-md bg-n-100 text-n-500">
                      <Icon size={16} />
                    </div>
                    <span className="flex-1 text-[13.5px] text-n-800">{p.label}</span>
                  </button>
                );
              })}
            </>
          )}

          {companies.length > 0 && (
            <>
              <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-n-500">
                Companies
              </div>
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => go(user?.isAdmin ? '/companies' : '/')}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-teal-50"
                >
                  <div className="grid h-[30px] w-[30px] place-items-center rounded-md bg-n-100 text-n-500">
                    <Building2 size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-n-800">{c.officialName}</div>
                    {c.registrationNumber && (
                      <div className="mono truncate text-[12px] text-n-500">{c.registrationNumber}</div>
                    )}
                  </div>
                  <span className="rounded-pill bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                    Company
                  </span>
                </button>
              ))}
            </>
          )}

          {pages.length === 0 && companies.length === 0 && (
            <div className="px-3 py-3 text-[12.5px] text-n-500">No matches.</div>
          )}
        </div>
      )}
    </div>
  );
}

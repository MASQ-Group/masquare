import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';

/** Company switcher pinned to the top of the sidebar (Design System §5). Lists the
 *  companies the signed-in user may access; selecting one sets the active scope. */
export function CompanySwitcher() {
  const { user, activeCompany, setActiveCompany } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const companies = user?.companies ?? [];
  const current = activeCompany ?? companies[0] ?? null;

  return (
    <div ref={ref} className="relative mx-3 mb-1.5 mt-3.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-md border border-white/[0.07] bg-white/[0.04] px-3 py-2.5 text-left hover:bg-white/[0.07]"
      >
        <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-[7px] bg-teal-600 text-[11px] font-bold text-white">
          {current ? initials(current.officialName) : '–'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.08em] text-n-400">Active company</div>
          <div className="truncate text-[13px] font-semibold text-white">
            {current?.officialName ?? 'No company'}
          </div>
        </div>
        <ChevronDown size={16} className="text-n-300" />
      </button>

      {open && companies.length > 0 && (
        <div className="absolute left-0 right-0 top-[58px] z-50 overflow-hidden rounded-lg border border-n-200 bg-n-0 p-1 shadow-lg">
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setActiveCompany(c.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-teal-50"
            >
              <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-[7px] bg-teal-600 text-[11px] font-bold text-white">
                {initials(c.officialName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-n-800">{c.officialName}</div>
                {c.registrationNumber && (
                  <div className="mono truncate text-[11px] text-n-500">{c.registrationNumber}</div>
                )}
              </div>
              {current?.id === c.id && <Check size={15} className="text-teal-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

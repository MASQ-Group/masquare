import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useConfirm } from './ConfirmProvider';
import { initials } from '../lib/format';

/** Company switcher pinned to the top of the sidebar (Design System §5). Lists the
 *  companies the signed-in user may access; selecting one sets the active scope. */
export function CompanySwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { user, activeCompany, setActiveCompany } = useAuth();
  const confirm = useConfirm();
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

  // Switching company must be deliberate (avoid entering data against the wrong company)
  // and must fully reload so no other company's data — or an in-progress entry — carries over.
  const switchTo = async (id: string, name: string) => {
    setOpen(false);
    if (id === (current?.id ?? null)) return;
    const ok = await confirm({
      title: 'Switch active company?',
      message: (
        <>
          You are switching to <strong>{name}</strong>. The page will reload, and everything you
          view or register from now on will belong to this company.
        </>
      ),
      confirmLabel: 'Switch company',
    });
    if (!ok) return;
    setActiveCompany(id);
    window.location.reload();
  };

  return (
    <div ref={ref} className={collapsed ? 'relative mx-2 mb-1.5 mt-3.5' : 'relative mx-3 mb-1.5 mt-3.5'}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? `Active company: ${current?.officialName ?? 'None'}` : undefined}
        className={[
          'flex w-full items-center rounded-md border border-white/[0.07] bg-white/[0.04] hover:bg-white/[0.07]',
          collapsed ? 'justify-center p-1.5' : 'gap-2.5 px-3 py-2.5 text-left',
        ].join(' ')}
      >
        <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-[7px] bg-teal-600 text-[11px] font-bold text-white">
          {current ? initials(current.officialName) : '–'}
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] uppercase tracking-[0.08em] text-n-400">Active company</div>
              <div className="truncate text-[13px] font-semibold text-white">
                {current?.officialName ?? 'No company'}
              </div>
            </div>
            <ChevronDown size={16} className="text-n-300" />
          </>
        )}
      </button>

      {open && companies.length > 0 && (
        <div className={[
          'absolute top-[58px] z-50 overflow-hidden rounded-lg border border-n-200 bg-n-0 p-1 shadow-lg',
          collapsed ? 'left-0 w-60' : 'left-0 right-0',
        ].join(' ')}>
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => { void switchTo(c.id, c.officialName); }}
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

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** Primary button text. Defaults to "Submit" — the platform-wide word for a final action. */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

/** Ask for confirmation before a final action. `if (!(await confirm({...}))) return;` */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

/**
 * One shared confirmation dialog for every final action, so "are you sure?" looks and
 * behaves the same everywhere. Promise-based: the caller awaits a yes/no rather than
 * threading dialog state through each screen. Sits above ModalShell (z-50) so it also works
 * when the action lives inside a modal (receiving, returning, amending).
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setOptions(opts);
  }), []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  }, []);

  useEffect(() => {
    if (!options) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); settle(false); }
      else if (e.key === 'Enter') { e.preventDefault(); settle(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options, settle]);

  const danger = options?.tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-[rgba(12,16,20,0.5)]" onClick={() => settle(false)} />
          <div className="relative w-full max-w-[440px] rounded-xl border border-n-200 bg-n-0 p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-lg ${danger ? 'bg-danger-bg text-danger' : 'bg-teal-50 text-teal-700'}`}>
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0">
                <h3 className="text-[15.5px] font-bold text-n-900">{options.title}</h3>
                {options.message && <div className="mt-1 text-[13px] leading-relaxed text-n-600">{options.message}</div>}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => settle(false)}>{options.cancelLabel ?? 'Cancel'}</button>
              <button
                autoFocus
                onClick={() => settle(true)}
                className={danger
                  ? 'inline-flex h-10 items-center rounded-md bg-danger px-4 text-[13.5px] font-semibold text-white shadow-xs hover:opacity-90'
                  : 'btn btn-primary'}
              >
                {options.confirmLabel ?? 'Submit'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </ConfirmContext.Provider>
  );
}

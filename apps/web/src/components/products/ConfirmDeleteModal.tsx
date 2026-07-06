import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  /** Number of products about to be deleted. */
  count: number;
  /** Shown when deleting a single product (e.g. its SKU). Ignored when count > 1. */
  label?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Deliberate delete confirmation. A single product needs one click; deleting several
 *  requires typing the exact count first, so a reflexive click can't wipe the catalogue. */
export function ConfirmDeleteModal({ count, label, busy, onConfirm, onClose }: Props) {
  const bulk = count > 1;
  const [typed, setTyped] = useState('');
  const confirmed = !bulk || typed.trim() === String(count);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="flex w-[440px] max-w-full flex-col overflow-hidden rounded-lg bg-n-0 shadow-lg" role="dialog" aria-modal="true">
        <div className="flex items-start gap-3 px-5 pt-5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger-bg text-danger">
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-[15px] font-semibold text-n-900">
              {bulk ? `Delete ${count} products?` : 'Delete this product?'}
            </h2>
            <p className="mt-1 text-[13px] text-n-600">
              {bulk
                ? <>You're about to permanently remove <span className="font-semibold text-n-800">{count} products</span> from the catalogue. This can't be undone.</>
                : <>This permanently removes <span className="mono font-semibold text-n-800">{label ?? 'this product'}</span> from the catalogue. This can't be undone.</>}
            </p>
          </div>
          <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" onClick={() => !busy && onClose()} title="Close">
            <X size={17} />
          </button>
        </div>

        {bulk && (
          <div className="mt-4 px-5">
            <label className="text-[12.5px] text-n-600">
              Type <span className="mono font-semibold text-n-900">{count}</span> to confirm
            </label>
            <input
              autoFocus
              className="input mono mt-1.5"
              placeholder={String(count)}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && confirmed && !busy) onConfirm(); }}
            />
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-n-200 px-5 py-3.5">
          <button type="button" onClick={() => !busy && onClose()} className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmed || busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-danger px-4 text-[13.5px] font-semibold text-white shadow-xs hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Deleting…' : bulk ? `Delete ${count} products` : 'Delete product'}
          </button>
        </div>
      </div>
    </div>
  );
}

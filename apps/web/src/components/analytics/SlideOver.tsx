import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Right-hand slide-over panel with a dimmed overlay (channel / country drill-downs).
 *  Closes on overlay click, the ✕, or Escape. */
export function SlideOver({ open, onClose, header, children, width = 440 }: {
  open: boolean; onClose: () => void; header: ReactNode; children: ReactNode; width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-[rgba(14,26,23,0.32)]" onClick={onClose} />
      <div
        className="absolute inset-y-0 right-0 flex max-w-[92%] flex-col bg-n-0 shadow-[-12px_0_34px_rgba(14,26,23,0.18)]"
        style={{ width }}
      >
        <div className="flex items-center gap-3 border-b border-n-200 px-5 py-4">
          <div className="min-w-0 flex-1">{header}</div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md border border-n-200 text-n-600 hover:bg-n-50"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

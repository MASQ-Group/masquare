import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** All SKUs on the transaction, in order. */
  skus: string[];
}

/**
 * Single-line SKU cell for list views. Shows the first SKU (truncated to a fixed
 * width) and a "+N" chip when there are more, keeping every row the same height.
 * Hovering reveals a popover listing all SKUs, one per row — the same chip style
 * used in the order-alerts popover.
 */
export function SkuCell({ skus }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pos != null;

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 288) });
  };
  const hide = () => setPos(null);

  if (skus.length === 0) return <span className="text-n-400">—</span>;

  const extra = skus.length - 1;

  return (
    <span ref={ref} className="inline-flex max-w-full items-center gap-1 align-middle" onMouseEnter={show} onMouseLeave={hide}>
      <span className="code max-w-[130px] truncate rounded bg-n-100 px-1.5 py-0.5 text-[11px] text-n-600" title={skus[0]}>
        {skus[0]}
      </span>
      {extra > 0 && (
        <span className="shrink-0 cursor-default rounded bg-n-100 px-1.5 py-0.5 text-[11px] font-semibold text-n-500">+{extra}</span>
      )}

      {open && createPortal(
        <div
          className="fixed z-[90] max-h-[320px] w-72 overflow-y-auto rounded-lg border border-n-200 bg-n-0 p-2.5 shadow-lg"
          style={{ top: pos!.top, left: pos!.left }}
        >
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-400">
            {skus.length} SKU{skus.length === 1 ? '' : 's'}
          </div>
          <ul className="flex flex-col gap-0.5">
            {skus.map((s, i) => (
              <li key={i} className="code rounded bg-n-50 px-1.5 py-0.5 text-[11.5px] text-n-800">{s}</li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </span>
  );
}

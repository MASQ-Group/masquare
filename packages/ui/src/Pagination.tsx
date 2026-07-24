import { Select } from './Select';

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Omit the pair to hide the rows-per-page control. */
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export const DEFAULT_PAGE_SIZES = [25, 50, 100, 200, 500];

/** The page buttons to render: first and last are always shown, with a window around the
 *  current page and an ellipsis wherever a gap is skipped. e.g. page 1 of 274 -> 1 2 3 … 274 */
export function pageItems(page: number, pageCount: number): (number | 'gap-left' | 'gap-right')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const last = pageCount;
  let start = Math.max(2, page - 1);
  let end = Math.min(last - 1, page + 1);
  // Near an edge, keep a consistent run of three so the control doesn't change width.
  if (page <= 3) { start = 2; end = 3; }
  if (page >= last - 2) { start = last - 2; end = last - 1; }

  const out: (number | 'gap-left' | 'gap-right')[] = [1];
  if (start > 2) out.push('gap-left');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < last - 1) out.push('gap-right');
  out.push(last);
  return out;
}

/** Standard list-view footer: rows-per-page on the left, page navigation on the right. */
export function Pagination({ page, pageCount, onPageChange, pageSize, onPageSizeChange, pageSizeOptions = DEFAULT_PAGE_SIZES }: PaginationProps) {
  const items = pageItems(page, Math.max(1, pageCount));
  const btn = 'grid h-8 min-w-8 place-items-center rounded-md border px-2 text-[13px] transition-colors';
  const idle = 'border-n-200 bg-n-0 text-n-600 hover:border-n-300 hover:bg-n-50';
  const disabled = 'border-n-200 bg-n-0 text-n-400 opacity-50 cursor-not-allowed';

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {pageSize != null && onPageSizeChange && (
          <>
            <span className="text-[13px] text-n-500">Rows per page</span>
            <Select
              dense
              className="w-[72px]"
              value={String(pageSize)}
              onChange={(v) => onPageSizeChange(Number(v))}
              options={pageSizeOptions.map((n) => ({ value: String(n), label: String(n) }))}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          className={`${btn} ${page <= 1 ? disabled : idle}`}
          onClick={() => onPageChange(page - 1)}
        >
          ‹ Prev
        </button>

        {items.map((it, i) =>
          it === 'gap-left' || it === 'gap-right' ? (
            <span key={`${it}-${i}`} className="grid h-8 min-w-8 place-items-center px-1 text-[13px] text-n-400">…</span>
          ) : (
            <button
              key={it}
              type="button"
              aria-current={it === page ? 'page' : undefined}
              className={`${btn} ${it === page ? 'border-teal-600 bg-teal-600 font-semibold text-white' : idle}`}
              onClick={() => onPageChange(it)}
            >
              {it}
            </button>
          ),
        )}

        <button
          type="button"
          disabled={page >= pageCount}
          className={`${btn} ${page >= pageCount ? disabled : idle}`}
          onClick={() => onPageChange(page + 1)}
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

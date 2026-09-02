import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, FileSpreadsheet, RefreshCw, User } from 'lucide-react';
import { productsApi } from '../../lib/api';
import { Pagination } from '@masquare/ui';

/**
 * What happened to this product, and who did it.
 *
 * Reads as a timeline rather than a table because the question being asked is "when did this go
 * wrong", which is answered by scanning down dates. The field-level before/after is the point —
 * "someone edited this" locates nothing, while "Purchase cost 12.50 → 1250.00" is the mistake
 * itself, already found.
 */

/** Who or what was behind the change. A person and a nightly sync deserve different weight. */
const SOURCE = {
  user: { icon: User, label: 'Person', className: 'text-teal-700 bg-teal-50 border-teal-200' },
  import: { icon: FileSpreadsheet, label: 'Spreadsheet', className: 'text-info bg-info-50 border-info-200' },
  sync: { icon: RefreshCw, label: 'Channel sync', className: 'text-n-600 bg-n-50 border-n-200' },
  system: { icon: Bot, label: 'Platform', className: 'text-n-600 bg-n-50 border-n-200' },
} as const;

const ACTION_LABEL: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  delete: 'Deleted',
  restore: 'Restored',
};

/** "2 Sep 2026, 16:25" — absolute, never "3 hours ago". A dispute needs a timestamp, not a feeling. */
const when = (iso: string) => new Date(iso).toLocaleString(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function ProductHistoryTab({ productId }: { productId: string }) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, isLoading } = useQuery({
    queryKey: ['product-activity', productId, page],
    queryFn: () => productsApi.activity(productId, { page, pageSize }),
  });

  if (isLoading) return <div className="px-4 py-16 text-center text-[13px] text-n-500">Loading history…</div>;

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-n-200 px-4 py-14 text-center">
        <div className="text-[13.5px] font-medium text-n-700">No history yet</div>
        {/* Says why it is empty rather than implying nothing ever happened to this product. */}
        <p className="mx-auto mt-1 max-w-md text-[12.5px] text-n-500">
          Changes are recorded from the point this feature went live. Edits made before then are not here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((a) => {
        const src = SOURCE[a.source as keyof typeof SOURCE] ?? SOURCE.system;
        const Icon = src.icon;
        return (
          <div key={a.id} className="rounded-lg border border-n-200 bg-n-0 p-4">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="text-[13.5px] font-semibold text-n-900">{ACTION_LABEL[a.action] ?? a.action}</span>
              <span className="text-[13px] text-n-600">
                {/* A null actor is the platform acting alone — a sync or a repair. Naming it that
                    way is more honest than an empty space. */}
                by {a.actor?.name ?? 'the platform'}
              </span>
              <span
                title={src.label}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] font-medium ${src.className}`}
              >
                <Icon size={11} /> {src.label}
              </span>
              <div className="flex-1" />
              <span className="mono text-[12px] text-n-500">{when(a.createdAt)}</span>
            </div>

            {a.action !== 'update' && a.summary && (
              <div className="mt-1.5 text-[13px] text-n-600">{a.summary}</div>
            )}

            {a.changes.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse">
                  <tbody>
                    {a.changes.map((c, i) => (
                      <tr key={`${c.field}-${i}`} className="border-t border-n-100">
                        <td className="w-[34%] py-1.5 pr-3 align-top text-[12.5px] text-n-500">{c.label}</td>
                        {/* The old value is struck through and muted, the new one carries the
                            weight — the eye should land on what it became. */}
                        <td className="py-1.5 pr-2 align-top text-[12.5px] text-n-400 line-through">
                          {c.from ?? <span className="no-underline">—</span>}
                        </td>
                        <td className="w-[6px] py-1.5 align-top text-[12.5px] text-n-300">→</td>
                        <td className="py-1.5 align-top text-[12.5px] font-medium text-n-800">{c.to ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {(data?.total ?? 0) > pageSize && (
        <Pagination page={page} pageCount={Math.ceil((data?.total ?? 0) / pageSize)} onPageChange={setPage} />
      )}
    </div>
  );
}

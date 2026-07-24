import { useState } from 'react';
import { toast } from 'sonner';
import { ModalShell, downloadSheet } from '@masquare/ui';
import { salesTransactionsApi } from '../../lib/api';
import { TX_EXPORT_COLUMNS, ITEM_EXPORT_COLUMNS } from './salesExportColumns';

/** Filter params passed straight to the export endpoint — the exact filtered view. */
export type SalesExportParams = Parameters<typeof salesTransactionsApi.export>[0];

interface Props {
  /** The current filtered view's params. Undefined = export all transactions. */
  params: SalesExportParams;
  /** How many rows the current filter matches, for the button/label. */
  total: number;
  /** True when a filter is active (affects the wording only). */
  filtered: boolean;
  onClose: () => void;
}

/** Intermediary export step: choose columns, whether to expand SKU lines, and the format. */
export function SalesExportModal({ params, total, filtered, onClose }: Props) {
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [expandSkus, setExpandSkus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [txCols, setTxCols] = useState<Set<string>>(() => new Set(TX_EXPORT_COLUMNS.filter((c) => c.def).map((c) => c.key)));
  const [itemCols, setItemCols] = useState<Set<string>>(() => new Set(ITEM_EXPORT_COLUMNS.filter((c) => c.def).map((c) => c.key)));

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
    setter((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const doExport = async () => {
    const tx = TX_EXPORT_COLUMNS.filter((c) => txCols.has(c.key));
    const items = ITEM_EXPORT_COLUMNS.filter((c) => itemCols.has(c.key));
    if (tx.length === 0 && !(expandSkus && items.length)) { toast.error('Select at least one column'); return; }

    setBusy(true);
    try {
      const rows = await salesTransactionsApi.export(params);
      const header = [...tx.map((c) => c.label), ...(expandSkus ? items.map((c) => c.label) : [])];
      const aoa: (string | number | null)[][] = [header];

      for (const t of rows) {
        const txValues = tx.map((c) => c.get(t));
        if (!expandSkus) {
          aoa.push(txValues);
          continue;
        }
        // One row per SKU; transaction columns repeat on each line so the file pivots cleanly.
        // A transaction with no lines still gets one row so it isn't silently dropped.
        if (t.items.length === 0) {
          aoa.push([...txValues, ...items.map(() => null)]);
        } else {
          for (const it of t.items) aoa.push([...txValues, ...items.map((c) => c.get(it, t))]);
        }
      }

      const scope = filtered ? 'filtered' : 'all';
      const grain = expandSkus ? 'skus' : 'transactions';
      downloadSheet(`masquare-sales-${scope}-${grain}-${rows.length}`, aoa, format);
      const lineCount = aoa.length - 1;
      toast.success(`Exported ${rows.length} transaction${rows.length === 1 ? '' : 's'}${expandSkus ? ` (${lineCount} SKU rows)` : ''}`);
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title={`Export ${filtered ? 'filtered' : 'all'} sales transactions`}
      subtitle={`${total} transaction${total === 1 ? '' : 's'} match${filtered ? ' the current filters' : ''}`}
      primaryLabel={busy ? 'Exporting…' : 'Download'}
      onPrimary={doExport}
      primaryDisabled={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div>
          <label className="label">Transaction columns</label>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-n-200 p-3 max-[560px]:grid-cols-1">
            {TX_EXPORT_COLUMNS.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-n-50">
                <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={txCols.has(c.key)} onChange={() => toggle(setTxCols, c.key)} />
                <span className="text-[13px] text-n-700">{c.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-n-200 p-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={expandSkus} onChange={(e) => setExpandSkus(e.target.checked)} />
            <span className="text-[13.5px] font-medium text-n-800">Include SKU line items — one row per SKU</span>
          </label>
          <p className="mt-1 pl-6 text-[11.5px] text-n-500">
            Each SKU goes on its own row (not comma-separated in one cell); the transaction columns repeat on each row.
          </p>
          {expandSkus && (
            <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-n-100 pt-3 max-[560px]:grid-cols-1">
              {ITEM_EXPORT_COLUMNS.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-n-50">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={itemCols.has(c.key)} onChange={() => toggle(setItemCols, c.key)} />
                  <span className="text-[13px] text-n-700">{c.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="label">Format</label>
          <div className="flex gap-2">
            {(['xlsx', 'csv'] as const).map((f) => (
              <button key={f} onClick={() => setFormat(f)}
                className={`mono h-10 w-24 rounded-md border text-[13px] font-medium uppercase ${format === f ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:bg-n-50'}`}>
                .{f}
              </button>
            ))}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

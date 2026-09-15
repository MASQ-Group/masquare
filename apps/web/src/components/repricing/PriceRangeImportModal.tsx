import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { ModalShell, downloadTemplate, parseSheetFile } from '@masquare/ui';
import { repricingApi, type RepricingRangeFilters } from '../../lib/api';

/**
 * The sheet's columns, in order. The server reads an upload by header NAME, so the same names must
 * be used here; the columns before "Min price" are context for a person and are ignored on import.
 */
const COLUMNS = [
  'SKU', 'Marketplace', 'ASIN', 'Brand', 'Vendor', 'Product type', 'Currency', 'Current price',
  'Breakeven', 'Margin floor', 'Floor in use', 'Floor from',
  'Min price', 'Max price', 'Margin %',
  'Clearance floor', 'Clearance reason', 'Clearance ends', 'Clearance until stock',
];

type Validation = Awaited<ReturnType<typeof repricingApi.validateRangeImport>>;
const STATUS: Record<string, { label: string; tone: string }> = {
  change: { label: 'Will change', tone: 'text-teal-700' },
  no_change: { label: 'No change', tone: 'text-n-500' },
  error: { label: 'Problem', tone: 'text-danger' },
};
const money = (c: number | null, ccy: string) => (c == null ? '—' : `${(c / 100).toFixed(2)} ${ccy}`);

/**
 * Price ranges by spreadsheet: download the SKUs the table's filters select with their breakeven and
 * floors beside the editable columns, change them in Excel, upload, check the preview, apply.
 *
 * Blank leaves a value as it is; a dash (-) removes it. Nothing is written until Apply, and Apply
 * re-checks the file on the server rather than trusting the preview — a row with a problem is left
 * unchanged, never half-applied.
 */
export function PriceRangeImportModal({ filters, filterSummary, onClose }: { filters: RepricingRangeFilters; filterSummary: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<Validation | null>(null);

  const download = useMutation({
    mutationFn: async () => {
      const r = await repricingApi.exportRange(filters);
      await downloadTemplate(`repricing-price-ranges-${new Date().toISOString().slice(0, 10)}`, {
        sheetName: 'Price ranges',
        headers: COLUMNS,
        sampleRows: r.rows.map((row) => COLUMNS.map((c) => row[c] ?? '')),
      });
      return r.rows.length;
    },
    onSuccess: (n) => toast.success(`Downloaded ${n} SKU${n === 1 ? '' : 's'}`),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not download'),
  });

  const validate = useMutation({
    mutationFn: (r: Record<string, string>[]) => repricingApi.validateRangeImport(r),
    onSuccess: setResult,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not check the file'),
  });

  const commit = useMutation({
    mutationFn: () => repricingApi.commitRangeImport(rows ?? []),
    onSuccess: (r) => {
      toast.success(`${r.applied} SKU${r.applied === 1 ? '' : 's'} changed${r.skippedWithProblems ? `, ${r.skippedWithProblems} left unchanged` : ''}${r.floorJobId ? ' — floors are being recalculated' : ''}`);
      qc.invalidateQueries({ queryKey: ['repricing', 'sku-pricing'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not apply the file'),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setFileName(file.name);
    const parsed = await parseSheetFile(file);
    const missing = ['SKU', 'Marketplace'].filter((c) => !parsed.columns.includes(c));
    if (missing.length) { toast.error(`The file has no ${missing.join(' or ')} column — download the sheet from here and edit that.`); return; }
    setRows(parsed.rows);
    validate.mutate(parsed.rows);
  };

  const changes = result?.counts.change ?? 0;
  return (
    <ModalShell open title="Price ranges from a spreadsheet" subtitle={filterSummary}
      primaryLabel={changes ? `Apply ${changes} change${changes === 1 ? '' : 's'}` : 'Apply'}
      onPrimary={() => commit.mutate()} primaryDisabled={!result || changes === 0}
      busy={commit.isPending} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-[12.5px] text-n-600">
          <li>Download the SKUs the table&apos;s current filters select.</li>
          <li>Edit <b>Min price</b>, <b>Max price</b>, <b>Margin %</b> and the <b>Clearance</b> columns. Blank leaves a value; <b>-</b> removes it. Dates as YYYY-MM-DD.</li>
          <li>Upload it, check the preview, apply.</li>
        </ol>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="hbtn" onClick={() => download.mutate()} disabled={download.isPending}>
            {download.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download sheet
          </button>
          <label className="hbtn cursor-pointer">
            <FileSpreadsheet size={14} /> {fileName || 'Upload edited sheet'}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {validate.isPending && <span className="flex items-center gap-1 text-[12px] text-n-500"><Loader2 size={12} className="animate-spin" /> Checking…</span>}
        </div>

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-x-4 text-[12.5px]">
              <span><b className="font-mono text-teal-700">{result.counts.change}</b> will change</span>
              <span><b className="font-mono">{result.counts.noChange}</b> no change</span>
              <span><b className="font-mono text-danger">{result.counts.error}</b> with problems — left unchanged</span>
            </div>
            <div className="max-h-[360px] overflow-auto rounded-md border border-n-200">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-n-25 text-left text-[10.5px] uppercase tracking-wide text-n-500">
                  <tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">SKU</th><th className="px-2 py-1">Mkt</th><th className="px-2 py-1">Status</th><th className="px-2 py-1 text-right">Floor after</th><th className="px-2 py-1 text-right">Max after</th><th className="px-2 py-1">Notes</th></tr>
                </thead>
                <tbody>
                  {result.rows.filter((r) => r.status !== 'no_change').map((r) => (
                    <tr key={r.line} className="border-t border-n-100 align-top">
                      <td className="px-2 py-1 font-mono text-n-500">{r.line}</td>
                      <td className="px-2 py-1 font-mono">{r.sku}</td>
                      <td className="px-2 py-1 font-mono">{r.marketplace}</td>
                      <td className={`px-2 py-1 ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums">{r.view ? money(r.view.after.floorCents, r.view.currency) : '—'}</td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums">{r.view ? money(r.view.after.maxPriceCents, r.view.currency) : '—'}</td>
                      <td className="px-2 py-1 text-n-600">{[...r.problems, ...(r.view?.after.notes ?? [])].join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

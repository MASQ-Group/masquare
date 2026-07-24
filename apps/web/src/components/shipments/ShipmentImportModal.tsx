import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, downloadSheet, parseSheetFile } from '@masquare/ui';
import { shipmentsApi, type ShipmentImportRowResult } from '../../lib/api';
import { SHIPMENT_COLUMNS, mapShipmentHeaders } from './shipmentColumns';

interface Props { onClose: () => void; onDone: () => void }
type Step = 'setup' | 'review' | 'done';

export function ShipmentImportModal({ onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>('setup');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [results, setResults] = useState<ShipmentImportRowResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ created: number; skipped: number; errors: { transactionRef: string; message: string }[] } | null>(null);

  const onFile = async (file: File) => {
    setFileName(file.name);
    const { columns, rows: raw } = await parseSheetFile(file);
    const map = mapShipmentHeaders(columns);
    const mapped = raw
      .map((r) => {
        const o: Record<string, string> = {};
        for (const [header, val] of Object.entries(r)) if (map[header]) o[map[header]] = val;
        return o;
      })
      .filter((r) => (r.transactionRef ?? '').trim());
    setRows(mapped);
  };

  const runValidate = async () => {
    if (rows.length === 0) { toast.error('Upload a file with at least one Transaction ID'); return; }
    setBusy(true);
    try {
      const res = await shipmentsApi.importValidate(rows);
      setResults(res.rows);
      setStep('review');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Validation failed');
    } finally { setBusy(false); }
  };

  const commit = async () => {
    const items = results
      .filter((r) => r.status === 'new' && r.transactionId)
      .map((r) => ({ row: rows[r.index], transactionId: r.transactionId!, shippingServiceId: r.shippingServiceId }));
    const notShipped = results.filter((r) => r.status === 'skip').length;
    setBusy(true);
    try {
      const res = await shipmentsApi.importCommit(items);
      setSummary({ created: res.created, skipped: res.skipped + notShipped, errors: res.errors });
      setStep('done');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Import failed');
    } finally { setBusy(false); }
  };

  const downloadTemplate = () =>
    downloadSheet('masquare-shipments-template', [SHIPMENT_COLUMNS.map((c) => c.label), SHIPMENT_COLUMNS.map((c) => c.sample)], 'xlsx');

  const errorCount = results.filter((r) => r.status === 'error').length;
  const skipCount = results.filter((r) => r.status === 'skip').length;
  const okCount = results.filter((r) => r.status === 'new').length;

  const primary = step === 'setup'
    ? { label: 'Review file', onClick: runValidate, disabled: rows.length === 0 }
    : step === 'review'
      ? { label: `Import (${okCount})`, onClick: commit, disabled: okCount === 0 }
      : { label: 'Done', onClick: onDone, disabled: false };

  return (
    <ModalShell open title="Import Shipments" subtitle={fileName || undefined} primaryLabel={primary.label} onPrimary={primary.onClick} primaryDisabled={primary.disabled} busy={busy} onClose={onClose}>
      {step === 'setup' && (
        <div className="flex flex-col gap-5">
          <p className="text-[13px] text-n-500">
            Each row records a shipment against a sales transaction (matched by <strong>Transaction ID</strong>). Outbound rows mark the order shipped unless <span className="mono">Mark fully shipped</span> is <span className="mono">no</span>.
            <br /><strong>Leave the Ship date empty</strong> for orders not shipped yet — those rows are skipped and left unchanged. Empty cost/duty cells stay empty (not €0). Dates use your Global Settings format.
            Tip: use <strong>Export</strong> on the Pending fulfilment tab to get a pre-filled template.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-ghost" onClick={downloadTemplate}><Upload size={16} className="rotate-180" /> Download template</button>
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-n-300 bg-n-25 px-6 py-10 text-center hover:border-teal-400 hover:bg-teal-50">
            <Upload className="text-n-400" size={26} />
            <span className="text-[14px] font-medium text-n-700">{fileName ? `${fileName} — ${rows.length} rows` : 'Drop a .csv / .xls / .xlsx, or click to browse'}</span>
            <span className="text-[12px] text-n-500">Columns: Transaction ID · Type · Ship date · Shipping service · Tracking · Shipping cost (EUR) · Cost borne by · Duty/import (EUR) · Comments · Mark fully shipped</span>
            <input type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
      )}

      {step === 'review' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            <span className="rounded-pill border border-success-bd bg-success-bg px-3 py-1 font-medium text-success">{okCount} to import</span>
            {skipCount > 0 && <span className="rounded-pill border border-n-200 bg-n-100 px-3 py-1 font-medium text-n-600">{skipCount} not shipped (skipped)</span>}
            {errorCount > 0 && <span className="rounded-pill border border-danger-bd bg-danger-bg px-3 py-1 font-medium text-danger">{errorCount} with errors</span>}
          </div>
          {errorCount > 0 && (
            <div className="rounded-lg border border-danger-bd bg-danger-bg/40 px-3 py-2 text-[12.5px] text-danger">
              <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> {errorCount} row(s) can't be imported</div>
              <div className="mt-0.5 text-[12px]">Fix the Transaction IDs / values below and re-upload, or import the valid rows now.</div>
            </div>
          )}
          <div className="max-h-72 overflow-auto rounded-lg border border-n-200">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0">
                <tr>
                  {['#', 'Transaction ID', 'Status', 'Issues'].map((h) => (
                    <th key={h} className="border-b border-n-200 bg-n-25 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-n-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={r.status === 'error' ? 'bg-danger-bg/30' : r.status === 'skip' ? 'bg-n-25' : ''}>
                    <td className="border-t border-n-100 px-2 py-1.5 font-mono text-n-400 align-top">{i + 1}</td>
                    <td className="border-t border-n-100 px-2 py-1.5 font-mono text-n-800 align-top">{r.transactionRef || '—'}</td>
                    <td className="border-t border-n-100 px-2 py-1.5 align-top">
                      {r.status === 'new'
                        ? <span className="text-success">Matched</span>
                        : r.status === 'skip'
                          ? <span className="text-n-500">Not shipped</span>
                          : <span className="inline-flex items-center gap-1 font-medium text-danger"><AlertTriangle size={12} /> Error</span>}
                    </td>
                    <td className="border-t border-n-100 px-2 py-1.5 align-top">
                      {r.issues.length === 0 ? <span className="text-n-300">—</span> : (
                        <ul className="flex flex-col gap-0.5">
                          {r.issues.map((iss, k) => (
                            <li key={k} className={iss.severity === 'error' ? 'text-danger' : 'text-warning'}><span className="mono">{iss.field}</span>: {iss.message}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 'done' && summary && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="text-success" size={40} />
          <div className="text-[15px] font-semibold text-n-900">Import complete</div>
          <div className="flex flex-wrap justify-center gap-2 text-[13px]">
            <span className="rounded-pill bg-success-bg px-3 py-1 text-success">{summary.created} shipments recorded</span>
            {summary.skipped > 0 && <span className="rounded-pill bg-n-100 px-3 py-1 text-n-600">{summary.skipped} not shipped (skipped)</span>}
            {summary.errors.length > 0 && <span className="rounded-pill bg-danger-bg px-3 py-1 text-danger">{summary.errors.length} failed</span>}
          </div>
          {summary.errors.length > 0 && (
            <div className="mt-2 w-full rounded-lg border border-danger-bd bg-danger-bg/40 p-3 text-left text-[12.5px] text-danger">
              <div className="mb-1 font-semibold">{summary.errors.length} row(s) failed:</div>
              {summary.errors.slice(0, 8).map((e, i) => <div key={i} className="code">{e.transactionRef}: {e.message}</div>)}
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

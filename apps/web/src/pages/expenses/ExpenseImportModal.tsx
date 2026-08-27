import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { FileDrop, ModalShell, downloadTemplate, parseSheetFile } from '@masquare/ui';
import { expenseCategoriesApi, expenseTagsApi, expensesApi, type ExpenseImportRowResult } from '../../lib/api';
import { EXPENSE_IMPORT_COLUMNS, EXPENSE_IMPORT_SAMPLE_ROWS, mapExpenseHeaders } from './expenseImportColumns';

interface Props { companyId: string; onClose: () => void; onDone: () => void }
type Step = 'setup' | 'review' | 'done';

const OCC_LABEL: Record<string, string> = { monthly: 'Monthly', annual: 'Annual', once_off: 'Once-off' };

export function ExpenseImportModal({ companyId, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>('setup');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [results, setResults] = useState<ExpenseImportRowResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ created: number; skipped: number; errors: { name: string; message: string }[] } | null>(null);

  const onFile = async (file: File) => {
    setFileName(file.name);
    const { columns, rows: raw } = await parseSheetFile(file);
    const map = mapExpenseHeaders(columns);
    const mapped = raw
      .map((r) => {
        const o: Record<string, string> = {};
        for (const [header, val] of Object.entries(r)) if (map[header]) o[map[header]] = val;
        return o;
      })
      // drop fully-blank rows
      .filter((r) => Object.values(r).some((v) => (v ?? '').trim()));
    setRows(mapped);
  };

  const runValidate = async () => {
    if (rows.length === 0) { toast.error('Upload a file with at least one expense row'); return; }
    setBusy(true);
    try {
      const res = await expensesApi.importValidate(rows);
      setResults(res.rows);
      setStep('review');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Validation failed');
    } finally { setBusy(false); }
  };

  const commit = async () => {
    const valid = results.filter((r) => r.status === 'new').map((r) => rows[r.index]);
    setBusy(true);
    try {
      const res = await expensesApi.importCommit(valid, companyId);
      setSummary(res);
      setStep('done');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Import failed');
    } finally { setBusy(false); }
  };

  // For the template dropdowns only — the lists must be the ones that exist at download time.
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: () => expenseCategoriesApi.list() });
  const { data: tags = [] } = useQuery({ queryKey: ['expense-tags'], queryFn: () => expenseTagsApi.list() });
  const downloadSampleTemplate = () =>
    downloadTemplate('masquare-expenses-template', {
      sheetName: 'Expenses',
      headers: EXPENSE_IMPORT_COLUMNS.map((c) => c.label),
      sampleRows: EXPENSE_IMPORT_SAMPLE_ROWS,
      lists: [
        { column: EXPENSE_IMPORT_COLUMNS.findIndex((c) => c.key === 'type'), values: ['Monthly', 'Annual', 'Once-off'] },
        { column: EXPENSE_IMPORT_COLUMNS.findIndex((c) => c.key === 'category'), values: categories.map((c: any) => c.name) },
        { column: EXPENSE_IMPORT_COLUMNS.findIndex((c) => c.key === 'tag'), values: tags.map((t: any) => t.name) },
      ].filter((l) => l.column >= 0 && l.values.length > 0),
    });

  const errorCount = results.filter((r) => r.status === 'error').length;
  const okCount = results.filter((r) => r.status === 'new').length;
  const newDefs = results.filter((r) => r.status === 'new' && r.willCreateDefinition).length;

  const primary = step === 'setup'
    ? { label: 'Review file', onClick: runValidate, disabled: rows.length === 0 }
    : step === 'review'
      ? { label: `Import (${okCount})`, onClick: commit, disabled: okCount === 0 }
      : { label: 'Done', onClick: onDone, disabled: false };

  return (
    <ModalShell open title="Import Expenses" subtitle={fileName || undefined} primaryLabel={primary.label} onPrimary={primary.onClick} primaryDisabled={primary.disabled} busy={busy} onClose={onClose}>
      {step === 'setup' && (
        <div className="flex flex-col gap-5">
          <p className="text-[13px] text-n-500">
            Each row registers one expense. <strong>Expense name</strong>, <strong>Type</strong> (Monthly / Annual / Once-off),
            <strong> Amount</strong> and <strong>Date</strong> are required. An expense name that doesn't exist yet is created for you
            (with its Category and Tag). Dates are <span className="mono">DD/MM/YYYY</span> — for Monthly/Annual only the month matters (the start month), for Once-off it's the exact expense date. Currency defaults to EUR.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-ghost" onClick={downloadSampleTemplate}><Upload size={16} className="rotate-180" /> Download template</button>
          </div>
          <FileDrop accept=".csv,.xls,.xlsx" onFiles={(f) => onFile(f[0])}>
            {({ dragging }) => (
              <div className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors ${dragging ? 'border-teal-400 bg-teal-50' : 'border-n-300 bg-n-25 hover:border-teal-400 hover:bg-teal-50'}`}>

                <Upload className="text-n-400" size={26} />
                <span className="text-[14px] font-medium text-n-700">{fileName ? `${fileName} — ${rows.length} rows` : 'Drop a .csv / .xls / .xlsx, or click to browse'}</span>
                <span className="text-[12px] text-n-500">Columns: Expense name · Category · Type · Amount · Currency · Date · Note · Tag</span>
              </div>
            )}
          </FileDrop>
        </div>
      )}

      {step === 'review' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            <span className="rounded-pill border border-success-bd bg-success-bg px-3 py-1 font-medium text-success">{okCount} to import</span>
            {newDefs > 0 && <span className="rounded-pill border border-info-bd bg-info-bg px-3 py-1 font-medium text-info">{newDefs} new expense name{newDefs === 1 ? '' : 's'} will be created</span>}
            {errorCount > 0 && <span className="rounded-pill border border-danger-bd bg-danger-bg px-3 py-1 font-medium text-danger">{errorCount} with errors</span>}
          </div>
          {errorCount > 0 && (
            <div className="rounded-lg border border-danger-bd bg-danger-bg/40 px-3 py-2 text-[12.5px] text-danger">
              <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> {errorCount} row(s) can't be imported</div>
              <div className="mt-0.5 text-[12px]">Fix the values below and re-upload, or import the valid rows now.</div>
            </div>
          )}
          <div className="max-h-72 overflow-auto rounded-lg border border-n-200">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0">
                <tr>
                  {['#', 'Expense name', 'Type', 'Status', 'Issues'].map((h) => (
                    <th key={h} className="border-b border-n-200 bg-n-25 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-n-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={r.status === 'error' ? 'bg-danger-bg/30' : ''}>
                    <td className="border-t border-n-100 px-2 py-1.5 font-mono text-n-400 align-top">{i + 1}</td>
                    <td className="border-t border-n-100 px-2 py-1.5 text-n-800 align-top">
                      {r.name || '—'}
                      {r.willCreateDefinition && <span className="ml-1.5 rounded-pill border border-info-bd bg-info-bg px-1.5 text-[10.5px] font-semibold text-info">new</span>}
                    </td>
                    <td className="border-t border-n-100 px-2 py-1.5 text-n-600 align-top">{r.occurrence ? OCC_LABEL[r.occurrence] : '—'}</td>
                    <td className="border-t border-n-100 px-2 py-1.5 align-top">
                      {r.status === 'new'
                        ? <span className="text-success">Ready</span>
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
            <span className="rounded-pill bg-success-bg px-3 py-1 text-success">{summary.created} expense{summary.created === 1 ? '' : 's'} registered</span>
            {summary.skipped > 0 && <span className="rounded-pill bg-n-100 px-3 py-1 text-n-600">{summary.skipped} skipped</span>}
            {summary.errors.length > 0 && <span className="rounded-pill bg-danger-bg px-3 py-1 text-danger">{summary.errors.length} failed</span>}
          </div>
          {summary.errors.length > 0 && (
            <div className="mt-2 w-full rounded-lg border border-danger-bd bg-danger-bg/40 p-3 text-left text-[12.5px] text-danger">
              <div className="mb-1 font-semibold">{summary.errors.length} row(s) failed:</div>
              {summary.errors.slice(0, 8).map((e, i) => <div key={i} className="code">{e.name}: {e.message}</div>)}
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

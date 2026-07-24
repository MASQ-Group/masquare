import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, parseSheetFile, Select } from '@masquare/ui';
import { productsApi, type ImportRowResult } from '../../lib/api';
import { mapHeadersToKeys } from './columns';

interface Props { onClose: () => void; onDone: () => void }
type Step = 'setup' | 'review' | 'done';
type RowAction = { action: 'add' | 'edit' | 'skip'; productId?: string };

export function ProductImportModal({ onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>('setup');
  const [purpose, setPurpose] = useState<'add' | 'edit'>('add');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [results, setResults] = useState<ImportRowResult[]>([]);
  const [actions, setActions] = useState<RowAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ created: number; updated: number; skipped: number; errors: { sku: string; message: string }[] } | null>(null);

  const onFile = async (file: File) => {
    setFileName(file.name);
    try {
      const { columns, rows: raw } = await parseSheetFile(file);
      const map = mapHeadersToKeys(columns);
      if (Object.keys(map).length === 0) {
        toast.error('None of the columns were recognised. Use the Export button to download a template with the right headers.');
        setRows([]);
        return;
      }
      const mapped = raw.map((r) => {
        const o: Record<string, string> = {};
        for (const [header, val] of Object.entries(r)) if (map[header]) o[map[header]] = val;
        return o;
      }).filter((r) => (r.mainSku ?? '').trim() || (r.title ?? '').trim());
      if (mapped.length === 0) toast.error('No product rows found — each row needs at least a Main SKU or Title.');
      setRows(mapped);
    } catch {
      setRows([]);
      toast.error('Could not read this file. Make sure it is a valid .csv, .xls or .xlsx spreadsheet.');
    }
  };

  // Surface the real reason instead of a generic message (handles no-response + array messages).
  const errMsg = (e: any, fallback: string) => {
    if (!e?.response) return `${fallback}: no response from the server — it may have restarted or the request was interrupted. Please try again.`;
    const m = e.response.data?.message;
    if (Array.isArray(m)) return m.join('; ');
    return m || `${fallback} (HTTP ${e.response.status})`;
  };

  const runValidate = async () => {
    if (rows.length === 0) { toast.error('Upload a file with at least one product row'); return; }
    setBusy(true);
    try {
      const res = await productsApi.importValidate(purpose, rows);
      setResults(res.rows);
      setActions(res.rows.map((r) => {
        if (r.status === 'error') return { action: 'skip' }; // rows with problems can't be imported
        if (purpose === 'add') return r.status === 'conflict' ? { action: 'edit', productId: r.existingProductId ?? undefined } : { action: 'add' };
        return r.status === 'match' ? { action: 'edit', productId: r.existingProductId ?? undefined } : { action: 'skip' };
      }));
      setStep('review');
    } catch (e: any) {
      toast.error(errMsg(e, 'Validation failed'));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const items = rows.map((row, i) => ({ row, action: actions[i].action, productId: actions[i].productId }));
      const res = await productsApi.importCommit(items);
      setSummary(res);
      setStep('done');
    } catch (e: any) {
      toast.error(errMsg(e, 'Import failed'));
    } finally {
      setBusy(false);
    }
  };

  const counts = {
    add: actions.filter((a) => a.action === 'add').length,
    edit: actions.filter((a) => a.action === 'edit').length,
    skip: actions.filter((a) => a.action === 'skip').length,
  };
  const errorCount = results.filter((r) => r.status === 'error').length;
  const missingCount = results.filter((r) => r.status === 'missing').length;

  const primary = step === 'setup'
    ? { label: 'Review file', onClick: runValidate, disabled: rows.length === 0 }
    : step === 'review'
      ? { label: `Import (${counts.add + counts.edit})`, onClick: commit, disabled: counts.add + counts.edit === 0 }
      : { label: 'Done', onClick: onDone, disabled: false };

  return (
    <ModalShell open title="Import Products" subtitle={fileName || undefined} primaryLabel={primary.label} onPrimary={primary.onClick} primaryDisabled={primary.disabled} busy={busy} onClose={onClose}>
      {step === 'setup' && (
        <div className="flex flex-col gap-5">
          <div>
            <label className="label">What is this file for?</label>
            <div className="flex gap-2">
              {([['add', 'Add new products'], ['edit', 'Edit existing products']] as const).map(([val, lbl]) => (
                <button key={val} onClick={() => setPurpose(val)}
                  className={`h-10 flex-1 rounded-md border text-[13px] font-medium ${purpose === val ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:bg-n-50'}`}>
                  {lbl}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-n-400">
              {purpose === 'add'
                ? 'Rows whose SKU/EAN/UPC already exist will be flagged so you can choose add-new or edit.'
                : 'Every row must match an existing SKU. Rows with unknown SKUs are dropped and reported.'}
            </p>
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-n-300 bg-n-25 px-6 py-10 text-center hover:border-teal-400 hover:bg-teal-50">
            <Upload className="text-n-400" size={26} />
            <span className="text-[14px] font-medium text-n-700">{fileName ? `${fileName} — ${rows.length} rows` : 'Drop a .csv / .xls / .xlsx, or click to browse'}</span>
            <span className="text-[12px] text-n-500">Use the Export button to download a template first.</span>
            <input type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
      )}

      {step === 'review' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            <span className="rounded-pill border border-success-bd bg-success-bg px-3 py-1 font-medium text-success">{counts.add} add</span>
            <span className="rounded-pill border border-info-bd bg-info-bg px-3 py-1 font-medium text-info">{counts.edit} edit</span>
            {counts.skip > 0 && <span className="rounded-pill border border-warning-bd bg-warning-bg px-3 py-1 font-medium text-warning">{counts.skip} skipped</span>}
            {errorCount > 0 && <span className="rounded-pill border border-danger-bd bg-danger-bg px-3 py-1 font-medium text-danger">{errorCount} with errors</span>}
          </div>

          {errorCount > 0 && (
            <div className="rounded-lg border border-danger-bd bg-danger-bg/40 px-3 py-2 text-[12.5px] text-danger">
              <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> {errorCount} row(s) have problems and won't be imported</div>
              <div className="mt-0.5 text-[12px]">Fix the fields listed in the Issues column below and re-upload — or import the valid rows now and fix the rest separately.</div>
            </div>
          )}

          <div className="max-h-72 overflow-auto rounded-lg border border-n-200">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0">
                <tr>
                  {['#', 'Main SKU', 'Title', 'Status', 'Issues', 'Action'].map((h) => (
                    <th key={h} className="border-b border-n-200 bg-n-25 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-n-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={r.status === 'error' ? 'bg-danger-bg/30' : actions[i]?.action === 'skip' ? 'bg-warning-bg/30' : ''}>
                    <td className="border-t border-n-100 px-2 py-1.5 font-mono text-n-400 align-top">{i + 1}</td>
                    <td className="border-t border-n-100 px-2 py-1.5 font-mono text-n-800 align-top">{r.sku || '—'}</td>
                    <td className="border-t border-n-100 px-2 py-1.5 text-n-700 align-top">{r.title || '—'}</td>
                    <td className="border-t border-n-100 px-2 py-1.5 align-top">
                      {r.status === 'new' && <span className="text-success">New</span>}
                      {r.status === 'match' && <span className="text-info">Exists</span>}
                      {r.status === 'conflict' && <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle size={12} /> Exists ({r.conflictOn.join(', ')})</span>}
                      {r.status === 'missing' && <span className="inline-flex items-center gap-1 text-danger"><AlertTriangle size={12} /> Unknown SKU</span>}
                      {r.status === 'error' && <span className="inline-flex items-center gap-1 font-medium text-danger"><AlertTriangle size={12} /> Error</span>}
                    </td>
                    <td className="border-t border-n-100 px-2 py-1.5 align-top">
                      {r.issues.length === 0 ? <span className="text-n-300">—</span> : (
                        <ul className="flex flex-col gap-0.5">
                          {r.issues.map((iss, k) => (
                            <li key={k} className={iss.severity === 'error' ? 'text-danger' : 'text-warning'}>
                              <span className="mono">{iss.field}</span>: {iss.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="border-t border-n-100 px-2 py-1.5 align-top">
                      {r.status === 'error' ? (
                        <span className="font-medium text-danger">Skipped — fix required</span>
                      ) : purpose === 'add' && r.status === 'conflict' ? (
                        <Select
                          dense
                          className="w-48"
                          value={actions[i]?.action ?? ''}
                          onChange={(v) => setActions((a) => a.map((x, idx) => idx === i ? (v === 'add' ? { action: 'add' } : { action: 'edit', productId: r.existingProductId ?? undefined }) : x))}
                          options={[
                            { value: 'edit', label: `Edit existing (${r.existingSku})` },
                            { value: 'add', label: 'Add as new' },
                          ]}
                        />
                      ) : r.status === 'missing' ? (
                        <span className="text-danger">Dropped</span>
                      ) : (
                        <span className="text-n-600">{actions[i]?.action === 'edit' ? 'Edit existing' : 'Add new'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {purpose === 'edit' && missingCount > 0 && (
            <p className="text-[12px] text-warning">⚠ {missingCount} row(s) reference SKUs that don't exist and will be dropped (edit mode only allows existing SKUs).</p>
          )}
        </div>
      )}

      {step === 'done' && summary && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="text-success" size={40} />
          <div className="text-[15px] font-semibold text-n-900">Import complete</div>
          <div className="flex gap-2 text-[13px]">
            <span className="rounded-pill bg-success-bg px-3 py-1 text-success">{summary.created} created</span>
            <span className="rounded-pill bg-info-bg px-3 py-1 text-info">{summary.updated} updated</span>
            <span className="rounded-pill bg-n-100 px-3 py-1 text-n-600">{summary.skipped} skipped</span>
          </div>
          {summary.errors.length > 0 && (
            <div className="mt-2 w-full rounded-lg border border-danger-bd bg-danger-bg/40 p-3 text-left text-[12.5px] text-danger">
              <div className="mb-1 font-semibold">{summary.errors.length} row(s) failed:</div>
              {summary.errors.slice(0, 8).map((e, i) => <div key={i} className="code">{e.sku}: {e.message}</div>)}
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

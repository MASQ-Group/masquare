import { FileDrop } from './FileDrop';
import { useMemo, useState } from 'react';
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
// xlsx is loaded on demand inside handleFile (below) so it stays out of the main bundle.
import { cn } from './cn';

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
}

export interface BulkImportProps {
  /** Target fields rows are mapped onto. */
  fields: ImportField[];
  /** Commit the validated rows (the import). */
  onCommit: (rows: Record<string, string>[]) => Promise<void> | void;
  /** Optional: surface reference values that don't yet exist for confirm-to-create. */
  onClose?: () => void;
}

type Step = 'upload' | 'map' | 'review';

/** Bulk-import framework (Module 1 §6.2): upload → column mapping → validation with a
 *  row-level error report → dry-run preview → commit. Accepts .csv / .xls / .xlsx. */
export function BulkImport({ fields, onCommit, onClose }: BulkImportProps) {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [committing, setCommitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
    const header = (grid[0] ?? []).map((c) => String(c ?? '').trim());
    setColumns(header);
    setRows(grid.slice(1).map((r) => header.map((_, i) => String(r[i] ?? '').trim())));

    // Best-effort auto-map by case-insensitive label/key match.
    const auto: Record<string, string> = {};
    for (const f of fields) {
      const hit = header.find(
        (h) => h.toLowerCase() === f.label.toLowerCase() || h.toLowerCase() === f.key.toLowerCase(),
      );
      if (hit) auto[f.key] = hit;
    }
    setMapping(auto);
    setStep('map');
  };

  const mappedRows = useMemo<Record<string, string>[]>(() => {
    return rows.map((r) => {
      const obj: Record<string, string> = {};
      for (const f of fields) {
        const col = mapping[f.key];
        const idx = col ? columns.indexOf(col) : -1;
        obj[f.key] = idx >= 0 ? r[idx] ?? '' : '';
      }
      return obj;
    });
  }, [rows, mapping, fields, columns]);

  const errors = useMemo(() => {
    return mappedRows.map((row) => {
      const missing = fields.filter((f) => f.required && !row[f.key]).map((f) => f.label);
      return missing.length ? `Missing: ${missing.join(', ')}` : null;
    });
  }, [mappedRows, fields]);

  const validRows = mappedRows.filter((_, i) => !errors[i]);
  const errorCount = errors.filter(Boolean).length;

  const commit = async () => {
    setCommitting(true);
    try {
      await onCommit(validRows);
      setDone(true);
    } finally {
      setCommitting(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <CheckCircle2 className="text-success" size={40} />
        <div className="text-[15px] font-semibold text-n-900">
          Imported {validRows.length} {validRows.length === 1 ? 'row' : 'rows'}
        </div>
        {onClose && (
          <button
            className="mt-2 inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover"
            onClick={onClose}
          >
            Done
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-[12px] font-medium text-n-500">
        {(['upload', 'map', 'review'] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            <span
              className={cn(
                'grid h-5 w-5 place-items-center rounded-full font-mono text-[11px]',
                step === s ? 'bg-primary text-white' : 'bg-n-100 text-n-500',
              )}
            >
              {i + 1}
            </span>
            <span className={cn('capitalize', step === s && 'text-n-800')}>{s}</span>
            {i < 2 && <span className="text-n-300">→</span>}
          </span>
        ))}
      </div>

      {step === 'upload' && (
        <FileDrop accept=".csv,.xls,.xlsx" onFiles={(f) => handleFile(f[0])}>
          {({ dragging }) => (
            <div className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center transition-colors',
              dragging ? 'border-teal-400 bg-teal-50' : 'border-n-300 bg-n-25 hover:border-teal-400 hover:bg-teal-50',
            )}>
              <Upload className="text-n-400" size={28} />
              <span className="text-[14px] font-medium text-n-700">
                Drop a .csv / .xls / .xlsx, or click to browse
              </span>
              <span className="text-[12px] text-n-500">The first row is read as column headers.</span>
            </div>
          )}
        </FileDrop>
      )}

      {step === 'map' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[13px] text-n-600">
            <FileSpreadsheet size={16} className="text-n-400" />
            <span className="font-mono">{fileName}</span>
            <span className="text-n-400">· {rows.length} rows</span>
          </div>
          <div className="grid gap-2">
            {fields.map((f) => (
              <div key={f.key} className="grid grid-cols-2 items-center gap-3">
                <label className="text-[13px] font-medium text-n-700">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </label>
                <select
                  className="h-9 rounded-md border border-n-200 bg-n-0 px-2 text-[13px] text-n-800 outline-none focus:border-teal-400"
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                >
                  <option value="">— ignore —</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover"
              onClick={() => setStep('review')}
            >
              Preview import
            </button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-success-bd bg-success-bg px-3 py-1 font-medium text-success">
              <CheckCircle2 size={14} /> {validRows.length} ready
            </span>
            {errorCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-warning-bd bg-warning-bg px-3 py-1 font-medium text-warning">
                <AlertTriangle size={14} /> {errorCount} with errors (skipped)
              </span>
            )}
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-n-200">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="bg-n-25 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-n-500">
                    #
                  </th>
                  {fields.map((f) => (
                    <th
                      key={f.key}
                      className="bg-n-25 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-n-500"
                    >
                      {f.label}
                    </th>
                  ))}
                  <th className="bg-n-25 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-n-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {mappedRows.slice(0, 100).map((row, i) => (
                  <tr key={i} className={cn(errors[i] && 'bg-danger-bg/40')}>
                    <td className="border-t border-n-100 px-2 py-1.5 font-mono text-n-400">{i + 1}</td>
                    {fields.map((f) => (
                      <td key={f.key} className="border-t border-n-100 px-2 py-1.5 text-n-700">
                        {row[f.key]}
                      </td>
                    ))}
                    <td className="border-t border-n-100 px-2 py-1.5">
                      {errors[i] ? (
                        <span className="text-danger">{errors[i]}</span>
                      ) : (
                        <span className="text-success">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between">
            <button
              className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50"
              onClick={() => setStep('map')}
            >
              Back
            </button>
            <button
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
              onClick={commit}
              disabled={committing || validRows.length === 0}
            >
              {committing ? 'Importing…' : `Import ${validRows.length} rows`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

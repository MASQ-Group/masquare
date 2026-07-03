import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, parseSheetFile } from '@masquare/ui';
import { salesChannelsApi, type SalesChannel } from '../../lib/api';

interface Props {
  channels: SalesChannel[];
  resolveCountryId: (token?: string) => string | null;
  onClose: () => void;
  onDone: () => void;
}
type Step = 'setup' | 'review' | 'done';
type RowAction = { action: 'add' | 'edit' | 'skip'; existingId?: string };
type RowResult = { index: number; name: string; status: 'new' | 'exists'; existingId: string | null };

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'nativeCountry', label: 'Native Country' },
  { key: 'nativeCurrency', label: 'Native Currency' },
  { key: 'generalSalesFeePct', label: 'General Sales Fee (%)' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Website' },
  { key: 'contactName', label: 'Contact Name' },
];

function mapHeaders(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const h of headers) {
    const lo = h.toLowerCase();
    const f = FIELDS.find((x) => x.label.toLowerCase() === lo || x.key.toLowerCase() === lo);
    if (f) m[h] = f.key;
  }
  return m;
}

export function SalesChannelImportModal({ channels, resolveCountryId, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>('setup');
  const [purpose, setPurpose] = useState<'add' | 'edit'>('add');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [results, setResults] = useState<RowResult[]>([]);
  const [actions, setActions] = useState<RowAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ created: number; updated: number; skipped: number; errors: string[] } | null>(null);

  const onFile = async (file: File) => {
    setFileName(file.name);
    const { columns, rows: raw } = await parseSheetFile(file);
    const map = mapHeaders(columns);
    const mapped = raw
      .map((r) => {
        const o: Record<string, string> = {};
        for (const [h, v] of Object.entries(r)) if (map[h]) o[map[h]] = v;
        return o;
      })
      .filter((r) => (r.name ?? '').trim());
    setRows(mapped);
  };

  const runReview = () => {
    if (rows.length === 0) { toast.error('Upload a file with at least one Name'); return; }
    const byName = new Map(channels.map((c) => [c.name.toLowerCase(), c]));
    const res: RowResult[] = rows.map((r, i) => {
      const name = (r.name ?? '').trim();
      const existing = byName.get(name.toLowerCase());
      return { index: i, name, status: existing ? 'exists' : 'new', existingId: existing?.id ?? null };
    });
    setResults(res);
    setActions(res.map((r) => {
      if (purpose === 'add') return r.status === 'exists' ? { action: 'edit', existingId: r.existingId ?? undefined } : { action: 'add' };
      return r.status === 'exists' ? { action: 'edit', existingId: r.existingId ?? undefined } : { action: 'add' };
    }));
    setStep('review');
  };

  const bodyOf = (r: Record<string, string>) => ({
    name: (r.name ?? '').trim(),
    description: r.description || undefined,
    nativeCountryId: resolveCountryId(r.nativeCountry),
    nativeCurrency: r.nativeCurrency || undefined,
    generalSalesFeePct: (r.generalSalesFeePct ?? '').trim() === '' ? null : Number((r.generalSalesFeePct ?? '').replace('%', '').trim()),
    email: r.email || undefined,
    website: r.website || undefined,
    contactName: r.contactName || undefined,
  });

  const commit = async () => {
    setBusy(true);
    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    try {
      for (let i = 0; i < rows.length; i++) {
        const a = actions[i];
        if (a.action === 'skip') { skipped++; continue; }
        try {
          if (a.action === 'edit' && a.existingId) { await salesChannelsApi.update(a.existingId, bodyOf(rows[i]) as any); updated++; }
          else { await salesChannelsApi.create(bodyOf(rows[i]) as any); created++; }
        } catch (e: any) {
          errors.push(`${results[i].name}: ${e?.response?.data?.message ?? 'failed'}`);
        }
      }
      setSummary({ created, updated, skipped, errors });
      setStep('done');
    } finally {
      setBusy(false);
    }
  };

  const counts = {
    add: actions.filter((a) => a.action === 'add').length,
    edit: actions.filter((a) => a.action === 'edit').length,
    skip: actions.filter((a) => a.action === 'skip').length,
  };

  const primary = step === 'setup'
    ? { label: 'Review file', onClick: runReview, disabled: rows.length === 0 }
    : step === 'review'
      ? { label: `Import (${counts.add + counts.edit})`, onClick: commit, disabled: counts.add + counts.edit === 0 }
      : { label: 'Done', onClick: onDone, disabled: false };

  return (
    <ModalShell open title="Import sales channels" subtitle={fileName || undefined} primaryLabel={primary.label} onPrimary={primary.onClick} primaryDisabled={primary.disabled} busy={busy} onClose={onClose}>
      {step === 'setup' && (
        <div className="flex flex-col gap-5">
          <div>
            <label className="label">What is this file for?</label>
            <div className="flex gap-2">
              {([['add', 'Add new sales channels'], ['edit', 'Edit existing sales channels']] as const).map(([val, lbl]) => (
                <button key={val} onClick={() => setPurpose(val)}
                  className={`h-10 flex-1 rounded-md border text-[13px] font-medium ${purpose === val ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:bg-n-50'}`}>
                  {lbl}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-n-400">
              {purpose === 'add'
                ? 'Rows whose Name already exists will be flagged so you can choose update-or-drop.'
                : 'Rows whose Name is not found will be flagged so you can choose add-as-new or drop. Name is the unique identifier.'}
            </p>
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-n-300 bg-n-25 px-6 py-10 text-center hover:border-teal-400 hover:bg-teal-50">
            <Upload className="text-n-400" size={26} />
            <span className="text-[14px] font-medium text-n-700">{fileName ? `${fileName} — ${rows.length} rows` : 'Drop a .csv / .xls / .xlsx, or click to browse'}</span>
            <span className="text-[12px] text-n-500">Use the Template or Export buttons to get a correctly-formatted file.</span>
            <input type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
      )}

      {step === 'review' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            <span className="rounded-pill border border-success-bd bg-success-bg px-3 py-1 font-medium text-success">{counts.add} add</span>
            <span className="rounded-pill border border-info-bd bg-info-bg px-3 py-1 font-medium text-info">{counts.edit} update</span>
            {counts.skip > 0 && <span className="rounded-pill border border-warning-bd bg-warning-bg px-3 py-1 font-medium text-warning">{counts.skip} dropped</span>}
          </div>
          <div className="max-h-72 overflow-auto rounded-lg border border-n-200">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0">
                <tr>{['#', 'Name', 'Status', 'Action'].map((h) => <th key={h} className="border-b border-n-200 bg-n-25 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-n-500">{h}</th>)}</tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const flagged = (purpose === 'add' && r.status === 'exists') || (purpose === 'edit' && r.status === 'new');
                  return (
                    <tr key={i} className={actions[i]?.action === 'skip' ? 'bg-warning-bg/30' : ''}>
                      <td className="border-t border-n-100 px-2 py-1.5 font-mono text-n-400">{i + 1}</td>
                      <td className="border-t border-n-100 px-2 py-1.5 text-n-800">{r.name}</td>
                      <td className="border-t border-n-100 px-2 py-1.5">
                        {r.status === 'exists'
                          ? <span className={purpose === 'add' ? 'inline-flex items-center gap-1 text-warning' : 'text-info'}>{purpose === 'add' && <AlertTriangle size={12} />}Exists</span>
                          : <span className={purpose === 'edit' ? 'inline-flex items-center gap-1 text-warning' : 'text-success'}>{purpose === 'edit' && <AlertTriangle size={12} />}New</span>}
                      </td>
                      <td className="border-t border-n-100 px-2 py-1.5">
                        {flagged ? (
                          <select
                            className="h-8 rounded border border-n-200 bg-n-0 px-1.5 text-[12.5px]"
                            value={actions[i]?.action}
                            onChange={(e) => setActions((a) => a.map((x, idx) => {
                              if (idx !== i) return x;
                              const v = e.target.value;
                              if (v === 'skip') return { action: 'skip' };
                              return purpose === 'add' ? { action: 'edit', existingId: r.existingId ?? undefined } : { action: 'add' };
                            }))}
                          >
                            {purpose === 'add'
                              ? (<><option value="edit">Update existing</option><option value="skip">Drop</option></>)
                              : (<><option value="add">Add as new</option><option value="skip">Drop</option></>)}
                          </select>
                        ) : (
                          <span className="text-n-600">{actions[i]?.action === 'edit' ? 'Update existing' : 'Add new'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 'done' && summary && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="text-success" size={40} />
          <div className="text-[15px] font-semibold text-n-900">Import complete</div>
          <div className="flex gap-2 text-[13px]">
            <span className="rounded-pill bg-success-bg px-3 py-1 text-success">{summary.created} created</span>
            <span className="rounded-pill bg-info-bg px-3 py-1 text-info">{summary.updated} updated</span>
            <span className="rounded-pill bg-n-100 px-3 py-1 text-n-600">{summary.skipped} dropped</span>
          </div>
          {summary.errors.length > 0 && (
            <div className="mt-2 w-full rounded-lg border border-danger-bd bg-danger-bg/40 p-3 text-left text-[12.5px] text-danger">
              <div className="mb-1 font-semibold">{summary.errors.length} row(s) failed:</div>
              {summary.errors.slice(0, 8).map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Undo2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import {
  vendorApplyApi,
  type VendorChangeField, type VendorImportPreview, type VendorPlannedChange,
} from '../../lib/api';

const FIELD_LABEL: Record<VendorChangeField, string> = {
  purchaseCost: 'Purchase cost',
  map: 'MAP',
  availability: 'Availability',
  ean: 'EAN',
  upc: 'UPC',
};

interface Props {
  file: File;
  vendorId: string;
  sheet?: string;
  currency: string;
  profileId?: string;
  mapping: Record<string, number>;
  /** Blocks preview until the mapping is usable and the currency confirmed. */
  ready: boolean;
  readyHint: string;
}

/**
 * The step that writes.
 *
 * Deliberately two actions, not one: a bulk cost change moves margins, breakevens and repricing
 * floors at once and nothing in a P&L afterwards says "a file did this", so the change list is
 * shown in full and applying it is a separate, explicit decision.
 */
export function ApplySection({ file, vendorId, sheet, currency, profileId, mapping, ready, readyHint }: Props) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<VendorImportPreview | null>(null);
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const { data: runs = [] } = useQuery({
    queryKey: ['vendor-import-runs', vendorId],
    queryFn: () => vendorApplyApi.listRuns(vendorId),
    enabled: !!vendorId,
  });

  const doPreview = useMutation({
    mutationFn: () => vendorApplyApi.preview(file, { vendorId, sheet, currency, mapping }),
    onSuccess: (p) => { setPreview(p); setConfirmed(false); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not build the preview'),
  });

  const doApply = useMutation({
    mutationFn: () => vendorApplyApi.apply(file, { vendorId, sheet, currency, profileId, mapping }),
    onSuccess: (r) => {
      toast.success(`Applied ${r.applied} change${r.applied === 1 ? '' : 's'}`);
      setPreview(null);
      setConfirmed(false);
      qc.invalidateQueries({ queryKey: ['vendor-import-runs', vendorId] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not apply the file'),
  });

  const doRollback = useMutation({
    mutationFn: (id: string) => vendorApplyApi.rollback(id),
    onSuccess: (r) => {
      toast.success(`Reverted ${r.reverted} change${r.reverted === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['vendor-import-runs', vendorId] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not roll that run back'),
  });

  const shown: VendorPlannedChange[] = preview
    ? preview.changes.filter((c) => !onlyWarnings || c.warning)
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
          <span className="text-[13px] font-semibold text-n-800">Apply to products</span>
          <button
            onClick={() => doPreview.mutate()}
            disabled={!ready || doPreview.isPending}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:bg-n-50 disabled:opacity-50"
          >
            <Eye size={13} /> {doPreview.isPending ? 'Checking…' : preview ? 'Refresh preview' : 'Preview changes'}
          </button>
          {!ready && <span className="text-[11.5px] text-n-400">{readyHint}</span>}
        </div>

        {preview && (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-n-100 px-4 py-3 text-[12.5px]">
              <span className="font-semibold text-n-800">{preview.summary.total} change{preview.summary.total === 1 ? '' : 's'}</span>
              {(Object.keys(FIELD_LABEL) as VendorChangeField[])
                .filter((f) => preview.summary.byField[f] > 0)
                .map((f) => (
                  <span key={f} className="text-n-600">{FIELD_LABEL[f]}: <b>{preview.summary.byField[f]}</b></span>
                ))}
              {preview.summary.warnings > 0 && (
                <span className="font-semibold text-amber-700">{preview.summary.warnings} need a look</span>
              )}
              <span className="text-n-400">{preview.summary.unchanged} rows already agree</span>
              {preview.summary.skipped > 0 && <span className="text-n-400">{preview.summary.skipped} values unreadable</span>}
            </div>

            {preview.summary.total === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-n-500">
                Nothing to apply — every matched row already agrees with what we hold.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 py-2">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-n-600">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={onlyWarnings} onChange={(e) => setOnlyWarnings(e.target.checked)} />
                    Only show the ones that need a look
                  </label>
                </div>

                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="sticky top-0 bg-n-25 text-[11px] uppercase tracking-wide text-n-500">
                      <tr>
                        <th className="px-4 py-1.5 text-left font-semibold">SKU</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Field</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Now</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Becomes</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-n-100">
                      {shown.slice(0, 500).map((c, i) => (
                        <tr key={`${c.productId}-${c.field}-${i}`} className={c.warning ? 'bg-amber-50/40' : undefined}>
                          <td className="px-4 py-1.5">
                            <span className="mono">{c.mainSku}</span>
                            <div className="truncate text-[11px] text-n-400">{c.title}</div>
                          </td>
                          <td className="px-2 py-1.5 text-n-600">{FIELD_LABEL[c.field]}</td>
                          <td className="mono px-2 py-1.5 text-right text-n-500">{c.oldValue ?? '—'}</td>
                          <td className="mono px-2 py-1.5 text-right font-semibold text-n-800">{c.newValue}</td>
                          <td className="px-2 py-1.5">
                            {c.warning && (
                              <span className="inline-flex items-center gap-1 text-[11.5px] text-amber-700">
                                <AlertTriangle size={12} /> {c.warning}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {shown.length > 500 && (
                    <div className="px-4 py-2 text-[11.5px] text-n-400">Showing the first 500 of {shown.length}.</div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-n-100 px-4 py-3">
                  <label className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 ${confirmed ? 'border-teal-300 bg-teal-50' : 'border-n-200'}`}>
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                    <span className="text-[12.5px] text-n-700">
                      I have reviewed these {preview.summary.total} changes
                      {preview.summary.warnings > 0 && <>, including the <b>{preview.summary.warnings}</b> flagged</>}.
                    </span>
                  </label>
                  <button
                    onClick={() => doApply.mutate()}
                    disabled={!confirmed || doApply.isPending}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-teal-500 px-3.5 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
                  >
                    <Check size={15} /> {doApply.isPending ? 'Applying…' : `Apply ${preview.summary.total} changes`}
                  </button>
                  <span className="text-[11.5px] text-n-400">Reversible — every previous value is kept.</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {runs.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-n-100 px-4 py-2.5 text-[13px] font-semibold text-n-800">Previous imports</div>
          <table className="w-full text-[12.5px]">
            <tbody className="divide-y divide-n-100">
              {runs.slice(0, 10).map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">
                    <div className="truncate font-medium text-n-800">{r.fileName}</div>
                    <div className="text-[11px] text-n-400">
                      {new Date(r.createdAt).toLocaleString('en-GB')} · {r.changed} change{r.changed === 1 ? '' : 's'} · {r.rowsMatched}/{r.rowsTotal} rows matched · {r.currency}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">
                    {r.rolledBackAt ? (
                      <span className="text-[11.5px] text-n-400">rolled back {new Date(r.rolledBackAt).toLocaleDateString('en-GB')}</span>
                    ) : (
                      <button
                        onClick={() => doRollback.mutate(r.id)}
                        disabled={doRollback.isPending}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:border-danger-bd hover:text-danger disabled:opacity-50"
                      >
                        <Undo2 size={13} /> Undo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

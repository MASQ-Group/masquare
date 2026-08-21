import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { UploadCloud, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Select } from '@masquare/ui';
import { PageHeader } from '../components/common/PageHeader';
import { CurrencySelect } from '../components/common/CurrencySelect';
import { toast } from 'sonner';
import {
  vendorsApi, vendorImportApi,
  type VendorImportAnalysis, type VendorImportColumn, type VendorImportField,
} from '../lib/api';

/** The fields a vendor file can supply, in the order they are presented for confirmation. */
const FIELDS: { key: VendorImportField; label: string; hint: string; required?: boolean }[] = [
  { key: 'sku', label: 'SKU', hint: 'Matched against our Main SKU. Without it no row can be applied.', required: true },
  { key: 'ean', label: 'EAN / barcode', hint: 'Used to match when the SKU does not.' },
  { key: 'manufacturerSku', label: 'Manufacturer SKU', hint: 'The vendor’s model or part number.' },
  { key: 'purchaseCost', label: 'Purchase cost', hint: 'The dealer / wholesale price we pay.' },
  { key: 'map', label: 'MAP (suggested retail)', hint: 'Read as inc- or ex-VAT per the vendor’s card.' },
  { key: 'availability', label: 'Availability', hint: 'The vendor’s sellable quantity — not our own stock.' },
];

const KIND_LABEL: Record<VendorImportColumn['kind'], string> = {
  ean: 'barcode', money: 'price', integer: 'whole number', sku: 'code', text: 'text', empty: 'empty',
};

export function VendorImportPage() {
  const [vendorId, setVendorId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState('');
  const [analysis, setAnalysis] = useState<VendorImportAnalysis | null>(null);
  /** User's mapping, overriding whatever was proposed. field -> column index or null. */
  const [chosen, setChosen] = useState<Partial<Record<VendorImportField, number | null>>>({});
  const [currency, setCurrency] = useState('EUR');
  const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  const [profileName, setProfileName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });

  const analyse = useMutation({
    mutationFn: (args: { file: File; sheet?: string }) =>
      vendorImportApi.analyse(args.file, { vendorId: vendorId || undefined, sheet: args.sheet }),
    onSuccess: (a) => {
      setAnalysis(a);
      setSheet(a.sheet);
      setCurrency(a.suggestedCurrency);
      // Re-confirmed on every upload: a price list read in the wrong currency changes every
      // cost silently, so this is never carried over from last time.
      setCurrencyConfirmed(false);
      setChosen(Object.fromEntries(a.mapping.map((m) => [m.field, m.columnIndex])));
      setProfileName((p) => p || a.profile?.name || `${a.file.name.replace(/\.[^.]+$/, '')}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not read that file'),
  });

  const saveProfile = useMutation({
    mutationFn: () => {
      const mapping: Record<string, { header: string; letter: string; ordinal: number }> = {};
      for (const f of FIELDS) {
        const idx = chosen[f.key];
        const col = idx != null ? analysis!.columns[idx] : null;
        if (col) mapping[f.key] = { header: col.header, letter: col.letter, ordinal: col.ordinal };
      }
      return vendorImportApi.saveProfile({
        id: analysis?.profile?.id, vendorId, name: profileName,
        sheetName: analysis?.sheet ?? null, currency, mapping,
      });
    },
    onSuccess: () => toast.success('Mapping saved for this vendor'),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the mapping'),
  });

  const onFile = (f: File) => { setFile(f); setSheet(''); analyse.mutate({ file: f }); };

  // A column can only serve one field — offering a taken column invites a mapping that silently
  // reads the retail price as cost.
  const takenBy = useMemo(() => {
    const m = new Map<number, VendorImportField>();
    for (const [field, idx] of Object.entries(chosen)) if (idx != null) m.set(idx, field as VendorImportField);
    return m;
  }, [chosen]);

  const skuMapped = chosen.sku != null;
  const willUpdate = {
    cost: chosen.purchaseCost != null,
    map: chosen.map != null,
    availability: chosen.availability != null,
  };
  const needsCurrency = willUpdate.cost || willUpdate.map;
  const canSave = !!vendorId && skuMapped && !!analysis && (!needsCurrency || currencyConfirmed);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        module="Pricing"
        title="Vendor Price Files"
        info="Upload a vendor's price or stock file, confirm what each column means, and save the mapping for next time."
      />

      <div className="card p-5">
        <div className="grid grid-cols-3 gap-4 max-[820px]:grid-cols-1">
          <div>
            <label className="label">Vendor</label>
            <Select
              value={vendorId}
              onChange={(v) => { setVendorId(v); if (file) analyse.mutate({ file }); }}
              placeholder="Select a vendor…"
              options={vendors.map((v: any) => ({ value: v.id, label: v.name }))}
            />
            <div className="mt-1.5 text-[11.5px] text-n-400">
              Its card decides the default currency and whether MAP includes VAT.
            </div>
          </div>
          <div className="col-span-2 max-[820px]:col-span-1">
            <label className="label">Price file</label>
            <label className="flex h-[38px] cursor-pointer items-center gap-2 rounded-md border border-dashed border-n-300 px-3 hover:bg-n-25">
              <UploadCloud size={16} className="text-n-500" />
              <span className="text-[13px] text-n-700">
                {file ? `${file.name}${analysis ? ` — ${analysis.file.rows} rows` : ''}` : 'Choose a .csv, .xls or .xlsx'}
              </span>
              <input
                ref={fileInput} type="file" accept=".csv,.xls,.xlsx,.xlsm" className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
            </label>
            <div className="mt-1.5 text-[11.5px] text-n-400">PDF price lists are not supported yet.</div>
          </div>
        </div>
      </div>

      {analyse.isPending && <div className="card p-5 text-[13px] text-n-500">Reading the file…</div>}

      {analysis && (
        <>
          <div className="card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[14px] font-bold text-n-800">What we read</h2>
              {analysis.sheets.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-n-500">Sheet</span>
                  <Select
                    value={sheet}
                    onChange={(v) => { setSheet(v); if (file) analyse.mutate({ file, sheet: v }); }}
                    options={analysis.sheets.map((s) => ({ value: s.name, label: `${s.name} (${s.rowCount})` }))}
                  />
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-n-600">
              <span><b>{analysis.file.rows}</b> product rows</span>
              <span>header on row <b>{analysis.headerRowIndex + 1}</b></span>
              {analysis.discarded.sectionHeaders > 0 && (
                <span><b>{analysis.discarded.sectionHeaders}</b> category rows skipped</span>
              )}
              {analysis.discarded.blank > 0 && <span><b>{analysis.discarded.blank}</b> blank rows skipped</span>}
            </div>
            {analysis.sectionLabels.length > 0 && (
              <div className="mt-1.5 text-[11.5px] text-n-400">
                Skipped as category headings: {analysis.sectionLabels.slice(0, 4).join(' · ')}
                {analysis.sectionLabels.length > 4 ? ' …' : ''}
              </div>
            )}
            {analysis.profile && (
              <div className="mt-2 text-[12px] text-teal-700">
                Applied the saved mapping &ldquo;{analysis.profile.name}&rdquo; for this vendor.
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-n-100 px-4 py-2.5">
              <span className="text-[13px] font-semibold text-n-800">Confirm what each column means</span>
              <p className="mt-0.5 text-[11.5px] text-n-500">
                Check the sample values, not the column name — vendors reuse the same headings for different things.
                Anything left unmapped is simply not updated.
              </p>
            </div>
            <div className="flex flex-col divide-y divide-n-100">
              {FIELDS.map((f) => {
                const proposed = analysis.mapping.find((m) => m.field === f.key);
                const idx = chosen[f.key] ?? null;
                const col = idx != null ? analysis.columns[idx] : null;
                const missingRequired = f.required && idx == null;
                return (
                  <div key={f.key} className="grid grid-cols-[200px_260px_1fr] items-start gap-3 px-4 py-3 max-[900px]:grid-cols-1">
                    <div>
                      <div className="text-[13px] font-semibold text-n-800">
                        {f.label}{f.required && <span className="text-danger"> *</span>}
                      </div>
                      <div className="text-[11.5px] text-n-500">{f.hint}</div>
                    </div>
                    <div>
                      <Select
                        value={idx == null ? '' : String(idx)}
                        onChange={(v) => setChosen((c) => ({ ...c, [f.key]: v === '' ? null : Number(v) }))}
                        placeholder="— not in this file —"
                        options={[
                          { value: '', label: '— not in this file —' },
                          ...analysis.columns.map((c, i) => {
                            const owner = takenBy.get(i);
                            const taken = owner && owner !== f.key;
                            return {
                              value: String(i),
                              label: `${c.letter} · ${c.header || '(no header)'}${taken ? `  → used for ${owner}` : ''}`,
                            };
                          }),
                        ]}
                      />
                      {missingRequired && (
                        <div className="mt-1 flex items-center gap-1 text-[11.5px] text-danger">
                          <AlertTriangle size={12} /> Required
                        </div>
                      )}
                      {proposed?.movedFrom && idx != null && (
                        <div className="mt-1 text-[11.5px] text-amber-700">
                          Moved from column {proposed.movedFrom} since the mapping was saved.
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      {col ? (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {col.samples.map((s, i) => (
                              <span key={i} className="mono rounded bg-n-100 px-1.5 py-0.5 text-[11.5px] text-n-700">{s}</span>
                            ))}
                          </div>
                          <div className="mt-1 text-[11px] text-n-400">
                            looks like {KIND_LABEL[col.kind]} · filled on {Math.round(col.filled * 100)}% of rows
                            {proposed?.source === 'detected' && proposed.columnIndex === idx && ` · suggested: ${proposed.reason}`}
                          </div>
                        </>
                      ) : (
                        <span className="text-[12px] text-n-400">Not mapped — this field will not be updated.</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-[14px] font-bold text-n-800">Before anything is written</h2>
            <div className="mt-3 grid grid-cols-2 gap-5 max-[820px]:grid-cols-1">
              <div>
                <label className="label">Currency of the prices in this file</label>
                <CurrencySelect value={currency} onChange={(v) => { setCurrency(v ?? 'EUR'); setCurrencyConfirmed(false); }} />
                <label className={`mt-2 flex cursor-pointer items-start gap-2 rounded-md border p-2.5 ${currencyConfirmed ? 'border-teal-300 bg-teal-50' : 'border-n-200'}`}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]" checked={currencyConfirmed} onChange={(e) => setCurrencyConfirmed(e.target.checked)} />
                  <span className="text-[12.5px] text-n-700">
                    I have checked the file and its prices are in <b>{currency}</b>.
                  </span>
                </label>
                {!needsCurrency && (
                  <div className="mt-1.5 text-[11.5px] text-n-400">No price column is mapped, so currency does not apply.</div>
                )}
              </div>
              <div>
                <div className="label">This file will update</div>
                <ul className="flex flex-col gap-1 text-[12.5px]">
                  {([['cost', 'Purchase cost'], ['map', 'MAP (suggested retail)'], ['availability', 'Availability']] as const).map(([k, label]) => (
                    <li key={k} className={`flex items-center gap-1.5 ${willUpdate[k] ? 'text-teal-700' : 'text-n-400'}`}>
                      {willUpdate[k] ? <CheckCircle2 size={13} /> : <span className="w-[13px]" />}
                      {label}{!willUpdate[k] && ' — not in this file'}
                    </li>
                  ))}
                </ul>
                {analysis.vendor && willUpdate.map && (
                  <div className="mt-2 text-[11.5px] text-n-500">
                    MAP will be read as <b>{analysis.vendor.mapIncludesVat ? 'including' : 'excluding'} VAT</b>, per {analysis.vendor.name}&rsquo;s card.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-n-100 pt-4">
              <div className="flex-1 min-w-[220px]">
                <label className="label">Save this mapping as</label>
                <input className="input" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Monthly stock &amp; price list" />
              </div>
              <button
                onClick={() => saveProfile.mutate()}
                disabled={!canSave || saveProfile.isPending}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-teal-500 px-3.5 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
              >
                <Save size={15} /> {saveProfile.isPending ? 'Saving…' : 'Save mapping'}
              </button>
            </div>
            {!canSave && (
              <div className="mt-2 text-[12px] text-n-500">
                {!vendorId ? 'Choose a vendor to save the mapping against.'
                  : !skuMapped ? 'Map the SKU column — without it no row can be matched to a product.'
                  : 'Confirm the currency before saving.'}
              </div>
            )}
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Nothing is written to any product yet. Applying a file — with a preview of every change
              before it lands — is the next step.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

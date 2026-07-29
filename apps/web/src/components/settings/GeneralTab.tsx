import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { settingsApi, type PlatformSettings } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { applyFonts, BODY_FONTS, DEFAULT_BODY_FONT, DEFAULT_MONO_FONT, MONO_FONTS } from '../../lib/fonts';
import { SectionHeader } from './shared';

const DATE_FORMATS: { value: PlatformSettings['dateFormat']; label: string }[] = [
  { value: 'ddmmyyyy', label: 'dd/mm/yyyy' },
  { value: 'mmddyyyy', label: 'mm/dd/yyyy' },
  { value: 'yyyymmdd', label: 'yyyy-mm-dd' },
];

export function GeneralTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const [measurementSystem, setMeasurementSystem] = useState<PlatformSettings['measurementSystem']>('metric');
  const [dateFormat, setDateFormat] = useState<PlatformSettings['dateFormat']>('ddmmyyyy');
  const [bodyFont, setBodyFont] = useState(DEFAULT_BODY_FONT);
  const [monoFont, setMonoFont] = useState(DEFAULT_MONO_FONT);
  const [deductStockOnSale, setDeductStockOnSale] = useState(false);
  const [applyChannelResolutions, setApplyChannelResolutions] = useState(false);
  const [autoAdjustAvailabilityOnSale, setAutoAdjustAvailabilityOnSale] = useState(false);

  useEffect(() => {
    if (data) {
      setMeasurementSystem(data.measurementSystem);
      setDateFormat(data.dateFormat);
      setBodyFont(data.bodyFont ?? DEFAULT_BODY_FONT);
      setMonoFont(data.monoFont ?? DEFAULT_MONO_FONT);
      setDeductStockOnSale(data.deductStockOnSale ?? false);
      setApplyChannelResolutions(data.applyChannelResolutions ?? false);
      setAutoAdjustAvailabilityOnSale(data.autoAdjustAvailabilityOnSale ?? false);
    }
  }, [data]);

  // Preview live as the admin changes fonts. Persisted on save; on discard the
  // AppShell re-applies the saved fonts from the settings query.
  const previewFonts = (body: string, mono: string) => { setBodyFont(body); setMonoFont(mono); applyFonts(body, mono); };

  const save = useMutation({
    mutationFn: () => settingsApi.update({ measurementSystem, dateFormat, bodyFont, monoFont, deductStockOnSale, applyChannelResolutions, autoAdjustAvailabilityOnSale }),
    onSuccess: () => { toast.success('Settings saved'); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Save failed'),
  });

  const readOnly = !user?.isAdmin;

  return (
    <div className="max-w-[560px]">
      <SectionHeader title="General" description="Platform-wide display defaults. Drives units and how dates render everywhere." />

      <div className="card flex flex-col gap-5 p-5">
        <div>
          <label className="label">Measurement system</label>
          <div className="flex gap-2">
            {(['metric', 'imperial'] as const).map((opt) => (
              <button
                key={opt}
                disabled={readOnly}
                onClick={() => setMeasurementSystem(opt)}
                className={`h-10 flex-1 rounded-md border text-[13.5px] font-medium capitalize transition-colors ${
                  measurementSystem === opt ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:bg-n-50'
                } disabled:opacity-60`}
              >
                {opt} {opt === 'metric' ? '(cm, kg)' : '(in, lb)'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Date format</label>
          <div className="flex gap-2">
            {DATE_FORMATS.map((opt) => (
              <button
                key={opt.value}
                disabled={readOnly}
                onClick={() => setDateFormat(opt.value)}
                className={`mono h-10 flex-1 rounded-md border text-[13px] font-medium transition-colors ${
                  dateFormat === opt.value ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-600 hover:bg-n-50'
                } disabled:opacity-60`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <SectionHeader title="Inventory" description="How selling affects stock on hand." />
      </div>

      <div className="card p-5">
        <label className={`flex items-start gap-3 ${readOnly ? 'opacity-60' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]"
            checked={deductStockOnSale}
            disabled={readOnly}
            onChange={(e) => setDeductStockOnSale(e.target.checked)}
          />
          <span>
            <span className="block text-[13.5px] font-semibold text-n-800">Deduct stock when a sale is submitted</span>
            <span className="mt-0.5 block text-[12.5px] text-n-500">
              Submitting a sale takes its units off hand. If there isn't enough, the sale still goes through and the
              shortfall is recorded as stock owed, to clear when the goods are received. Serial-tracked products already
              behave this way regardless of this setting.
            </span>
          </span>
        </label>
        {deductStockOnSale && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12px] text-warning">
            <span>⚠</span>
            <span>Turn this on only once opening stock has been counted in. With an empty catalogue, every sale would
              record a shortfall. It applies going forward — sales submitted before it was switched on are not
              retroactively deducted.</span>
          </p>
        )}

        <label className={`mt-1 flex items-start gap-3 border-t border-n-100 pt-4 ${readOnly ? 'opacity-60' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]"
            checked={applyChannelResolutions}
            disabled={readOnly}
            onChange={(e) => setApplyChannelResolutions(e.target.checked)}
          />
          <span>
            <span className="block text-[13.5px] font-semibold text-n-800">Apply cancellations &amp; refunds pulled from sales channels</span>
            <span className="mt-0.5 block text-[12.5px] text-n-500">
              When a channel sync (e.g. Amazon) finds a cancelled or refunded order, mark the matching transaction
              accordingly — registering cancellations, reversing revenue on refunds, and raising a return decision.
            </span>
          </span>
        </label>
        {applyChannelResolutions && (
          <p className="flex items-start gap-2 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12px] text-warning">
            <span>⚠</span>
            <span>Leave off until you've reviewed the behaviour. While off, syncs ignore cancellations/refunds
              (their prior behaviour); switching it on lets the next sync change existing transactions.</span>
          </p>
        )}

        <label className={`mt-1 flex items-start gap-3 border-t border-n-100 pt-4 ${readOnly ? 'opacity-60' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--teal-500)]"
            checked={autoAdjustAvailabilityOnSale}
            disabled={readOnly}
            onChange={(e) => setAutoAdjustAvailabilityOnSale(e.target.checked)}
          />
          <span>
            <span className="block text-[13.5px] font-semibold text-n-800">Adjust channel Availability when a sale is submitted</span>
            <span className="mt-0.5 block text-[12.5px] text-n-500">
              A sale on any channel lowers the shared Availability figure (the sellable number broadcast to the channels)
              and schedules a push of the new quantity to every channel the SKU is listed on, so the others don't keep
              selling stock that's gone. Cancellations add it back. Independent of physical stock above.
            </span>
          </span>
        </label>
        {autoAdjustAvailabilityOnSale && (
          <p className="flex items-start gap-2 rounded-md border border-warning-bd bg-warning-bg px-3 py-2 text-[12px] text-warning">
            <span>⚠</span>
            <span>This makes live quantity writes to the marketplaces. Leave off until Availability reflects real
              sellable stock. It applies going forward — sales submitted before it was switched on are not
              retroactively adjusted.</span>
          </p>
        )}
      </div>

      <div className="mt-6">
        <SectionHeader title="Typography" description="The two platform fonts. The primary font is used for all text and numbers; the code font is used for machine codes — SKUs, IDs, tracking numbers." />
      </div>

      <div className="card flex flex-col gap-5 p-5">
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <div>
            <label className="label">Primary font <span className="font-normal text-n-400">(text &amp; numbers)</span></label>
            <Select
              value={bodyFont}
              disabled={readOnly}
              onChange={(v) => previewFonts(v, monoFont)}
              options={BODY_FONTS.map((f) => ({ value: f.name, label: f.name }))}
            />
          </div>
          <div>
            <label className="label">Code font <span className="font-normal text-n-400">(SKUs, IDs)</span></label>
            <Select
              value={monoFont}
              disabled={readOnly}
              onChange={(v) => previewFonts(bodyFont, v)}
              options={MONO_FONTS.map((f) => ({ value: f.name, label: f.name }))}
            />
          </div>
        </div>

        {/* Live preview */}
        <div className="rounded-lg border border-n-200 bg-n-25 p-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-n-400">Preview</div>
          <div className="text-[15px] font-semibold text-n-900">Marketplace sales &amp; inventory</div>
          <div className="mt-0.5 text-[13px] text-n-600">Orders sync automatically across channels.</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="mono text-[15px] font-semibold text-n-900">€12,480.50</span>
            <span className="mono text-[13px] text-n-600">1,204 units · 18.3%</span>
            <span className="code rounded bg-n-100 px-1.5 py-0.5 text-[12px] text-n-700">RE-S8590-FBA</span>
            <span className="code rounded bg-n-100 px-1.5 py-0.5 text-[12px] text-n-700">402-1234567</span>
          </div>
        </div>

        {readOnly && <p className="text-[12px] text-n-400">Only admins can change platform settings.</p>}
      </div>

      {!readOnly && (
        <div className="mt-5 flex justify-end">
          <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  );
}

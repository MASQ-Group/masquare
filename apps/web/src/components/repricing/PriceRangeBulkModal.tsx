import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { repricingApi, type RepricingPriceSetting, type RepricingRangeChange, type RepricingRangeFilters } from '../../lib/api';

type PriceMode = 'leave' | 'fixed' | 'above_breakeven_pct' | 'clear';
const PRICE_MODES = [
  { value: 'leave', label: 'Leave as it is' },
  { value: 'fixed', label: 'Set a fixed price' },
  { value: 'above_breakeven_pct', label: 'Set % above each SKU’s breakeven' },
  { value: 'clear', label: 'Remove' },
];
const money = (c: number | null, ccy: string) => (c == null ? '—' : `${(c / 100).toFixed(2)} ${ccy}`);
const SOURCE: Record<string, string> = { clearance: 'clearance', min_price: 'min price', margin: 'margin' };

/**
 * One change for every SKU the table's filters select — marketplace, brand, vendor, product type,
 * search and state, exactly as shown behind this window.
 *
 * Always previewed first: how many SKUs match, how many would change, which are refused and why,
 * and a sample of the floor before and after. A price set "% above breakeven" follows each SKU's own
 * breakeven, because one fixed price rarely suits many different products.
 */
export function PriceRangeBulkModal({ filters, filterSummary, onClose }: { filters: RepricingRangeFilters; filterSummary: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [minMode, setMinMode] = useState<PriceMode>('leave');
  const [minValue, setMinValue] = useState('');
  const [maxMode, setMaxMode] = useState<PriceMode>('leave');
  const [maxValue, setMaxValue] = useState('');
  const [marginMode, setMarginMode] = useState<'leave' | 'set' | 'clear'>('leave');
  const [marginValue, setMarginValue] = useState('');
  const [clearMode, setClearMode] = useState<'leave' | 'set' | 'clear'>('leave');
  const [cFloorMode, setCFloorMode] = useState<'fixed' | 'above_breakeven_pct'>('above_breakeven_pct');
  const [cFloor, setCFloor] = useState('');
  const [cReason, setCReason] = useState('');
  const [cEnds, setCEnds] = useState('');
  const [cStock, setCStock] = useState('');

  const num = (v: string) => Number(v.replace(',', '.'));
  const price = (mode: PriceMode, v: string): RepricingPriceSetting | undefined =>
    mode === 'leave' ? undefined : mode === 'clear' ? { mode: 'clear' } : { mode, value: num(v) };

  const change = (): RepricingRangeChange => ({
    ...(price(minMode, minValue) ? { minPrice: price(minMode, minValue) } : {}),
    ...(price(maxMode, maxValue) ? { maxPrice: price(maxMode, maxValue) } : {}),
    ...(marginMode === 'set' ? { minMarginPct: num(marginValue) } : marginMode === 'clear' ? { minMarginPct: null } : {}),
    ...(clearMode === 'clear' ? { clearance: { mode: 'clear' as const } } : {}),
    ...(clearMode === 'set'
      ? {
        clearance: {
          mode: 'set' as const,
          floor: { mode: cFloorMode, value: num(cFloor) },
          reason: cReason,
          endsAt: cEnds ? new Date(Date.parse(`${cEnds}T00:00:00Z`) + 86_400_000).toISOString() : null,
          untilStock: cStock.trim() === '' ? null : Number(cStock),
        },
      }
      : {}),
  });

  const nothing = minMode === 'leave' && maxMode === 'leave' && marginMode === 'leave' && clearMode === 'leave';

  const run = useMutation({
    mutationFn: (apply: boolean) => repricingApi.bulkRange(filters, change(), apply),
    onSuccess: (r, apply) => {
      if (!apply) return;
      toast.success(`${r.applied} SKU${r.applied === 1 ? '' : 's'} changed${r.floorJobId ? ' — floors are being recalculated for the new margin' : ''}`);
      qc.invalidateQueries({ queryKey: ['repricing', 'sku-pricing'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not run the bulk edit'),
  });
  const preview = run.data && !run.variables ? run.data : null;
  // Any edit invalidates the preview: applying must never run on settings nobody previewed.
  const edited = <T,>(set: (v: T) => void) => (v: T) => { set(v); run.reset(); };

  return (
    <ModalShell open title="Bulk edit price range" subtitle={filterSummary} dirty={!nothing}
      primaryLabel={preview ? `Apply to ${preview.willChange} SKU${preview.willChange === 1 ? '' : 's'}` : 'Preview'}
      onPrimary={() => run.mutate(!!preview)}
      primaryDisabled={nothing || (!!preview && preview.willChange === 0)}
      busy={run.isPending} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-n-500">
          Applies to every SKU matching the table&apos;s current filters. Change the filters behind this window to pick a vendor, brand or product type.
        </p>

        <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
          <div>
            <span className="label">Minimum price</span>
            <Select value={minMode} onChange={(v) => edited(setMinMode)(v as PriceMode)} options={PRICE_MODES} />
            {(minMode === 'fixed' || minMode === 'above_breakeven_pct') && (
              <input aria-label="Minimum price value" className="input mt-1.5 font-mono" inputMode="decimal" value={minValue} onChange={(e) => edited(setMinValue)(e.target.value)} placeholder={minMode === 'fixed' ? 'e.g. 19.99' : 'e.g. 5 (%)'} />
            )}
          </div>
          <div>
            <span className="label">Maximum price</span>
            <Select value={maxMode} onChange={(v) => edited(setMaxMode)(v as PriceMode)} options={PRICE_MODES} />
            {(maxMode === 'fixed' || maxMode === 'above_breakeven_pct') && (
              <input aria-label="Maximum price value" className="input mt-1.5 font-mono" inputMode="decimal" value={maxValue} onChange={(e) => edited(setMaxValue)(e.target.value)} placeholder={maxMode === 'fixed' ? 'e.g. 49.99' : 'e.g. 60 (%)'} />
            )}
          </div>
          <div>
            <span className="label">Margin %</span>
            <Select value={marginMode} onChange={(v) => edited(setMarginMode)(v as 'leave' | 'set' | 'clear')}
              options={[{ value: 'leave', label: 'Leave as it is' }, { value: 'set', label: 'Set' }, { value: 'clear', label: 'Follow the strategy again' }]} />
            {marginMode === 'set' && (
              <input aria-label="Margin value" className="input mt-1.5 font-mono" inputMode="decimal" value={marginValue} onChange={(e) => edited(setMarginValue)(e.target.value)} placeholder="0–90" />
            )}
          </div>
          <div>
            <span className="label">Clearance</span>
            <Select value={clearMode} onChange={(v) => edited(setClearMode)(v as 'leave' | 'set' | 'clear')}
              options={[{ value: 'leave', label: 'Leave as it is' }, { value: 'set', label: 'Start clearance' }, { value: 'clear', label: 'End clearance' }]} />
          </div>
        </div>

        {clearMode === 'set' && (
          <div className="grid grid-cols-2 gap-3 rounded-md border border-warning-bd bg-warning-bg p-3 max-[560px]:grid-cols-1">
            <p className="col-span-2 text-[12px] text-warning max-[560px]:col-span-1">
              Clearance lets the engine price below breakeven until the end you set. Use a negative percentage to go under breakeven, e.g. −15.
            </p>
            <div>
              <span className="label">Clearance floor</span>
              <Select value={cFloorMode} onChange={(v) => edited(setCFloorMode)(v as 'fixed' | 'above_breakeven_pct')}
                options={[{ value: 'above_breakeven_pct', label: '% relative to breakeven' }, { value: 'fixed', label: 'Fixed price' }]} />
              <input aria-label="Clearance floor value" className="input mt-1.5 font-mono" inputMode="decimal" value={cFloor} onChange={(e) => edited(setCFloor)(e.target.value)} placeholder={cFloorMode === 'fixed' ? 'e.g. 12.50' : 'e.g. -15'} />
            </div>
            <div>
              <label className="label" htmlFor="bulk-clr-reason">Reason</label>
              <input id="bulk-clr-reason" className="input" maxLength={200} value={cReason} onChange={(e) => edited(setCReason)(e.target.value)} placeholder="End of line" />
            </div>
            <div>
              <label className="label" htmlFor="bulk-clr-ends">Runs until (last day)</label>
              <input id="bulk-clr-ends" type="date" className="input" value={cEnds} onChange={(e) => edited(setCEnds)(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="bulk-clr-stock">Or until available units reach</label>
              <input id="bulk-clr-stock" className="input font-mono" inputMode="numeric" value={cStock} onChange={(e) => edited(setCStock)(e.target.value)} placeholder="e.g. 0" />
            </div>
          </div>
        )}

        {preview && (
          <div className="flex flex-col gap-2 rounded-md border border-n-200 p-3 text-[12.5px]">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span><b className="font-mono">{preview.matched}</b> matched</span>
              <span><b className="font-mono text-teal-700">{preview.willChange}</b> will change</span>
              {preview.refusedTotal > 0 && <span><b className="font-mono text-danger">{preview.refusedTotal}</b> refused — left unchanged</span>}
            </div>
            {preview.sample.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="text-left text-[10.5px] uppercase tracking-wide text-n-500">
                    <tr><th className="py-1 pr-2">SKU</th><th className="py-1 pr-2">Mkt</th><th className="py-1 pr-2 text-right">Breakeven</th><th className="py-1 pr-2 text-right">Floor before</th><th className="py-1 pr-2 text-right">Floor after</th><th className="py-1 text-right">Max after</th></tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((v) => (
                      <tr key={v.id} className="border-t border-n-100">
                        <td className="py-1 pr-2 font-mono">{v.sku}</td>
                        <td className="py-1 pr-2 font-mono">{v.marketplace}</td>
                        <td className="py-1 pr-2 text-right font-mono tabular-nums">{money(v.breakevenCents, v.currency)}</td>
                        <td className="py-1 pr-2 text-right font-mono tabular-nums">{money(v.before.floorCents, v.currency)} <span className="font-sans text-[10.5px] text-n-400">{SOURCE[v.before.floorSource]}</span></td>
                        <td className="py-1 pr-2 text-right font-mono tabular-nums">{money(v.after.floorCents, v.currency)} <span className="font-sans text-[10.5px] text-n-400">{SOURCE[v.after.floorSource]}{v.marginChanged ? ' · recalculated' : ''}</span></td>
                        <td className="py-1 text-right font-mono tabular-nums">{money(v.after.maxPriceCents, v.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.willChange > preview.sample.length && <p className="mt-1 text-[11px] text-n-500">Showing {preview.sample.length} of {preview.willChange}.</p>}
              </div>
            )}
            {preview.refused.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[12px] font-semibold text-danger">Why {preview.refusedTotal} SKU{preview.refusedTotal === 1 ? ' is' : 's are'} refused</summary>
                <ul className="mt-1 flex flex-col gap-0.5 text-[11.5px] text-n-600">
                  {preview.refused.map((v) => <li key={v.id}><span className="font-mono">{v.sku} {v.marketplace}</span> — {v.problems.join('; ')}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

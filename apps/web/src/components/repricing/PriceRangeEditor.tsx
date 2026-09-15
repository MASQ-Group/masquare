import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { repricingApi, type RepricingRangeChange, type RepricingSkuRow } from '../../lib/api';

const toMoney = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2));
const money = (c: number | null, ccy: string) => (c == null ? '—' : `${(c / 100).toFixed(2)} ${ccy}`);
const SOURCE: Record<string, string> = { clearance: 'Clearance', min_price: 'Minimum price', margin: 'Margin floor' };

/**
 * One SKU's price range. The engine prices between the floor and the maximum; the floor is the
 * clearance floor while clearance runs, else the minimum price, else the margin floor.
 *
 * Breakeven is shown beside every field because it is the line that matters: a minimum below it is
 * raised to it, and only clearance — with a reason and an end — may go under it.
 */
export function PriceRangeEditor({ row, onClose }: { row: RepricingSkuRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [min, setMin] = useState(toMoney(row.minPriceCents));
  const [max, setMax] = useState(toMoney(row.maxPriceCents));
  const [margin, setMargin] = useState(row.minMarginPct != null ? String(Number(row.minMarginPct)) : '');
  const hadClearance = row.clearanceFloorCents != null;
  const [clearOn, setClearOn] = useState(hadClearance);
  const [cFloor, setCFloor] = useState(toMoney(row.clearanceFloorCents));
  const [cReason, setCReason] = useState(row.clearanceReason ?? '');
  // Stored as the moment it stops; shown as the last day it runs.
  const [cEnds, setCEnds] = useState(row.clearanceEndsAt ? new Date(new Date(row.clearanceEndsAt).getTime() - 1).toISOString().slice(0, 10) : '');
  const [cStock, setCStock] = useState(row.clearanceUntilStock != null ? String(row.clearanceUntilStock) : '');
  const [dirty, setDirty] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };

  const change = (): RepricingRangeChange => {
    const price = (v: string) => (v.trim() === '' ? { mode: 'clear' as const } : { mode: 'fixed' as const, value: Number(v.replace(',', '.')) });
    const c: RepricingRangeChange = {
      minPrice: price(min),
      maxPrice: price(max),
      minMarginPct: margin.trim() === '' ? null : Number(margin),
    };
    if (clearOn) {
      c.clearance = {
        mode: 'set',
        floor: price(cFloor),
        reason: cReason,
        // The last day it runs → it stops at the start of the next day.
        endsAt: cEnds ? new Date(Date.parse(`${cEnds}T00:00:00Z`) + 86_400_000).toISOString() : null,
        untilStock: cStock.trim() === '' ? null : Number(cStock),
      };
    } else if (hadClearance) {
      c.clearance = { mode: 'clear' };
    }
    return c;
  };

  const save = useMutation({
    mutationFn: () => repricingApi.updateRange(row.id, change()),
    onSuccess: (r) => {
      toast.success(r.marginChanged ? 'Saved — the floor is being recalculated for the new margin' : 'Saved');
      qc.invalidateQueries({ queryKey: ['repricing', 'sku-pricing'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const ccy = row.currency;
  return (
    <ModalShell open title="Price range" subtitle={`${row.sku} · ${ccy}`} dirty={dirty}
      primaryLabel="Save range" onPrimary={() => save.mutate()} busy={save.isPending} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3 rounded-md border border-n-200 bg-n-25 p-3 text-[12.5px] max-[560px]:grid-cols-1">
          <div><div className="text-n-500">Breakeven</div><div className="font-mono tabular-nums text-n-800">{money(row.breakevenCents, ccy)}</div></div>
          <div><div className="text-n-500">Margin floor</div><div className="font-mono tabular-nums text-n-800">{money(row.strategyFloorCents, ccy)}</div></div>
          <div><div className="text-n-500">Floor in use</div><div className="font-mono tabular-nums text-n-800">{money(row.range.floorCents, ccy)} <span className="font-sans text-[11px] text-n-500">{SOURCE[row.range.floorSource]}</span></div></div>
        </div>
        {row.range.notes.map((n) => <p key={n} className="text-[12px] text-warning">{n}</p>)}

        <div className="grid grid-cols-3 gap-3 max-[560px]:grid-cols-1">
          <div>
            <label className="label" htmlFor="range-min">Minimum price</label>
            <input id="range-min" className="input font-mono" inputMode="decimal" value={min} onChange={(e) => touch(setMin)(e.target.value)} placeholder="Margin floor" />
            <p className="mt-1 text-[11px] text-n-500">Replaces the margin floor. Never below breakeven.</p>
          </div>
          <div>
            <label className="label" htmlFor="range-max">Maximum price</label>
            <input id="range-max" className="input font-mono" inputMode="decimal" value={max} onChange={(e) => touch(setMax)(e.target.value)} placeholder="No maximum" />
            <p className="mt-1 text-[11px] text-n-500">The engine never prices above this.</p>
          </div>
          <div>
            <label className="label" htmlFor="range-margin">Margin %</label>
            <input id="range-margin" className="input font-mono" inputMode="decimal" value={margin} onChange={(e) => touch(setMargin)(e.target.value)} placeholder={row.preset?.name ? `From ${row.preset.name}` : 'Default 12'} />
            <p className="mt-1 text-[11px] text-n-500">0–90. Empty follows the strategy. The floor is recalculated after saving.</p>
          </div>
        </div>

        <div className="rounded-md border border-n-200 p-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={clearOn} onChange={(e) => touch(setClearOn)(e.target.checked)} />
            <span className="text-[13px] font-semibold text-n-800">Clearance — allow prices below breakeven</span>
          </label>
          <p className="mt-1 pl-6 text-[11.5px] text-n-500">
            For clearing stock. Needs a reason and an end: a date, a stock level, or both. When it ends the SKU returns to its normal floor by itself.
          </p>
          {clearOn && (
            <div className="mt-3 grid grid-cols-2 gap-3 pl-6 max-[560px]:grid-cols-1">
              <div>
                <label className="label" htmlFor="clr-floor">Clearance floor</label>
                <input id="clr-floor" className="input font-mono" inputMode="decimal" value={cFloor} onChange={(e) => touch(setCFloor)(e.target.value)} />
                {row.breakevenCents != null && cFloor.trim() !== '' && Number(cFloor.replace(',', '.')) * 100 < row.breakevenCents && (
                  <p className="mt-1 text-[11px] text-warning">
                    {((row.breakevenCents - Number(cFloor.replace(',', '.')) * 100) / 100).toFixed(2)} {ccy} below breakeven per unit at the floor.
                  </p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="clr-reason">Reason</label>
                <input id="clr-reason" className="input" maxLength={200} value={cReason} onChange={(e) => touch(setCReason)(e.target.value)} placeholder="Discontinued model" />
              </div>
              <div>
                <label className="label" htmlFor="clr-ends">Runs until (last day)</label>
                <input id="clr-ends" type="date" className="input" value={cEnds} onChange={(e) => touch(setCEnds)(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="clr-stock">Or until available units reach</label>
                <input id="clr-stock" className="input font-mono" inputMode="numeric" value={cStock} onChange={(e) => touch(setCStock)(e.target.value)} placeholder="e.g. 0" />
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

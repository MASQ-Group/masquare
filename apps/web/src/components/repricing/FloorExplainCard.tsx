import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { repricingApi, type FloorExplain } from '../../lib/api';

/**
 * Every input behind one SKU's floor.
 *
 * A floor is one number standing for a dozen inputs, so when it looks wrong there is nothing to
 * inspect — which is how four wrong floors went unnoticed until they were cross-checked by hand.
 * This shows the inputs, what the floor omits, and what recomputing right now would give, so a
 * stale figure can be told from a wrong one.
 */
export function FloorExplainCard() {
  const [sku, setSku] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [data, setData] = useState<FloorExplain | null>(null);

  const run = useMutation({
    mutationFn: () => repricingApi.explainFloor(sku.trim(), marketplace.trim() || undefined),
    onSuccess: setData,
    onError: () => setData(null),
  });

  const cents = (v: number | null | undefined) => (v == null ? '—' : (v / 100).toFixed(2));
  const eur = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
  const i = data?.inputs;
  const s = data?.stored;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-n-800">Explain a floor</span>
        <input
          className="input mono h-8 w-[190px] text-[12.5px]"
          placeholder="SKU"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && sku.trim()) run.mutate(); }}
        />
        <input
          className="input mono h-8 w-[90px] text-[12.5px]"
          placeholder="UK"
          value={marketplace}
          onChange={(e) => setMarketplace(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && sku.trim()) run.mutate(); }}
        />
        <button
          onClick={() => run.mutate()}
          disabled={!sku.trim() || run.isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          <Search size={14} /> {run.isPending ? 'Reading…' : 'Explain'}
        </button>
        <span className="text-[11.5px] text-n-400">Read-only — nothing is changed.</span>
      </div>

      {run.isError && (
        <div className="px-4 py-3 text-[12.5px] text-danger">
          {(run.error as any)?.response?.data?.message ?? 'Could not read that SKU.'}
        </div>
      )}

      {data?.error && <div className="px-4 py-3 text-[12.5px] text-danger">{data.error}</div>}

      {data && !data.error && (
        <div className="grid grid-cols-3 gap-4 px-4 py-3 text-[12px] max-[900px]:grid-cols-1">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Costs</div>
            <Row label="Product cost" value={`€${eur(i?.costEur)}`} />
            <Row label="Landed COGS" value={cents(i?.cogsLandedCents)} />
            <Row label={i?.fbaFulfillmentFeeCents ? 'FBA fee' : 'Shipping'} value={cents(i?.fbaFulfillmentFeeCents || i?.fixedPerUnitCents)} />
            <Row label="Closing fee" value={cents(i?.closingFeeCents)} />
            <Row label="FX to EUR" value={i?.fxNativeToEur != null ? String(i.fxNativeToEur) : '—'} />
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Loaded costs</div>
            <Row
              label="Returns"
              value={i?.returnsRatePct != null ? `${Number(i.returnsRatePct).toFixed(1)}%` : 'not applied'}
              sub={i?.returnsRateSource ? `from ${i.returnsRateSource}` : undefined}
            />
            <Row label="Storage / unit" value={i?.storagePerUnitCents ? cents(i.storagePerUnitCents) : 'not set'} />
            <Row label="Advertising / unit" value={i?.adCostPerUnitCents ? cents(i.adCostPerUnitCents) : 'not set'} />
            <Row label="VAT" value={i?.vatRate != null ? `${(i.vatRate * 100).toFixed(1)}%` : '—'} sub={i?.vatSource} />
            <Row label="Min margin" value={i?.minMarginPct != null ? `${i.minMarginPct}%` : '—'} />
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Result</div>
            <Row label="Breakeven" value={cents(s?.breakevenCents)} />
            <Row label="Floor" value={cents(s?.strategyFloorCents)} />
            <Row
              label="Computed"
              value={s?.floorsComputedAt ? new Date(s.floorsComputedAt).toLocaleString('en-GB') : 'never'}
            />
            {/* A stored floor computed before a pricing fix is stale, not wrong — and the two look
                identical without recomputing alongside it. */}
            {data.recomputedNow && (
              <Row
                label="If recomputed now"
                value={`${cents(data.recomputedNow.breakevenCents)} / ${cents(data.recomputedNow.strategyFloorCents)}`}
                sub={
                  data.recomputedNow.strategyFloorCents !== s?.strategyFloorCents
                    ? 'differs from stored — recompute this SKU'
                    : 'matches stored'
                }
              />
            )}

            <div className={`mt-2 rounded-md border px-2.5 py-2 ${s?.loaded ? 'border-teal-200 bg-teal-50' : 'border-amber-200 bg-amber-50'}`}>
              <div className="flex items-start gap-1.5 text-[11.5px]">
                {s?.loaded ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-teal-600" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />}
                <span className={s?.loaded ? 'text-teal-900' : 'text-amber-900'}>
                  {s?.loaded
                    ? 'Fully loaded — safe to run at a low margin.'
                    : `Leaves out ${(s?.omits ?? []).join(', ') || 'nothing recorded'}. Fine at 12%; do not run an aggressive strategy on this SKU until they are set.`}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-2">
      <span className="w-[120px] shrink-0 text-n-500">{label}</span>
      <span className="mono text-[11.5px] text-n-800">{value}</span>
      {sub && <span className="text-[11px] text-n-400">{sub}</span>}
    </div>
  );
}

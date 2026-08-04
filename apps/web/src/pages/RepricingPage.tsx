import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw, DownloadCloud } from 'lucide-react';
import { repricingApi, type RepricingSkuRow, type RepricingDecisionRow } from '../lib/api';

// Amazon Buy Box repricing — ops console (Phase-appropriate: readiness, SKU floors, decision
// audit, onboard + recompute actions). Read-only insight into the shadow pipeline; the engine
// submits nothing unless SKUs are LIVE and the master switch is on (server-side env).

const MARKETPLACE_LABEL: Record<string, string> = {
  A1PA6795UKMFR9: 'DE',
  A13V1IB3VIYZZH: 'FR',
  A1RKKUPIHCS9HS: 'ES',
};
const mkt = (id: string) => MARKETPLACE_LABEL[id] ?? id;
const eur = (cents: number | null) => (cents == null ? '—' : `€${(cents / 100).toFixed(2)}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

const STATE_STYLES: Record<string, string> = {
  LIVE: 'bg-teal-50 text-teal-700 border-teal-200',
  SHADOW: 'bg-blue-50 text-blue-700 border-blue-200',
  EXCLUDED: 'bg-n-100 text-n-600 border-n-200',
  QUARANTINED: 'bg-orange-50 text-orange-700 border-orange-200',
  KILLED: 'bg-red-50 text-red-700 border-red-200',
};
const OUTCOME_STYLES: Record<string, string> = {
  PRICED: 'bg-teal-50 text-teal-700 border-teal-200',
  HELD: 'bg-n-100 text-n-600 border-n-200',
  SKIPPED: 'bg-n-100 text-n-500 border-n-200',
  QUARANTINED: 'bg-orange-50 text-orange-700 border-orange-200',
};

function Badge({ value, styles }: { value: string; styles: Record<string, string> }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold ${styles[value] ?? 'bg-n-100 text-n-600 border-n-200'}`}>
      {value}
    </span>
  );
}

export function RepricingPage() {
  const qc = useQueryClient();
  const readiness = useQuery({ queryKey: ['repricing', 'readiness'], queryFn: repricingApi.readiness });
  const skus = useQuery({ queryKey: ['repricing', 'sku-pricing'], queryFn: () => repricingApi.skuPricing(100) });
  const decisions = useQuery({ queryKey: ['repricing', 'decisions'], queryFn: () => repricingApi.decisions(100) });

  const refreshAll = () => qc.invalidateQueries({ queryKey: ['repricing'] });

  const onboard = useMutation({ mutationFn: repricingApi.onboard, onSuccess: refreshAll });
  const recompute = useMutation({ mutationFn: repricingApi.recomputeFloors, onSuccess: refreshAll });

  const total = readiness.data?.total ?? 0;
  const byState = readiness.data?.byState ?? {};
  const byExclusion = readiness.data?.byExclusion ?? {};

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-[22px] font-bold tracking-tight text-n-900">Amazon Repricing</h1>
          <p className="mt-1 text-[13px] text-n-500">
            Buy Box repricing engine — running in <strong>shadow mode</strong>. Intended prices are logged; nothing is
            submitted unless a SKU is LIVE and live-writes are enabled server-side.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onboard.mutate()}
            disabled={onboard.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-semibold text-n-700 hover:border-n-300 hover:bg-n-25 disabled:opacity-50"
          >
            <DownloadCloud size={15} /> {onboard.isPending ? 'Onboarding…' : 'Onboard SKUs'}
          </button>
          <button
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-500 px-3.5 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
          >
            <RefreshCcw size={15} /> {recompute.isPending ? 'Recomputing…' : 'Recompute floors'}
          </button>
        </div>
      </div>

      {(onboard.data || recompute.data) && (
        <div className="mb-4 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-[12.5px] text-teal-800">
          {onboard.data && <span>Onboarded {onboard.data.created} new + {onboard.data.updated} updated ({onboard.data.skipped} skipped) of {onboard.data.scannedListings} listings. </span>}
          {recompute.data && <span>Recomputed floors: {recompute.data.ok}/{recompute.data.processed} OK.</span>}
        </div>
      )}

      {/* Readiness stat row */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total SKUs" value={total} />
        {['LIVE', 'SHADOW', 'EXCLUDED', 'QUARANTINED', 'KILLED'].map((s) => (
          <StatTile key={s} label={s} value={byState[s] ?? 0} />
        ))}
      </div>
      {Object.keys(byExclusion).length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-[12px] text-n-600">
          <span className="text-n-500">Excluded by reason:</span>
          {Object.entries(byExclusion)
            .filter(([k]) => k !== 'none')
            .map(([k, v]) => (
              <span key={k} className="rounded border border-n-200 bg-n-25 px-1.5 py-0.5 font-mono">{k}: {v}</span>
            ))}
        </div>
      )}

      <SkuTable rows={skus.data ?? []} loading={skus.isLoading} />
      <div className="h-6" />
      <DecisionTable rows={decisions.data ?? []} loading={decisions.isLoading} />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-n-500">{label}</div>
      <div className="mt-0.5 font-mono text-[20px] font-semibold tabular-nums text-n-900">{value}</div>
    </div>
  );
}

function SkuTable({ rows, loading }: { rows: RepricingSkuRow[]; loading: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-n-100 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-n-800">SKU pricing &amp; floors</span>
        <span className="text-[12px] text-n-500">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-n-25 text-left text-[11px] uppercase tracking-wide text-n-500">
            <tr>
              <th className="px-4 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 font-semibold">ASIN</th>
              <th className="px-3 py-2 font-semibold">Mkt</th>
              <th className="px-3 py-2 font-semibold">Fulfil</th>
              <th className="px-3 py-2 font-semibold">State</th>
              <th className="px-3 py-2 text-right font-semibold">Breakeven</th>
              <th className="px-3 py-2 text-right font-semibold">Floor</th>
              <th className="px-3 py-2 text-right font-semibold">Current</th>
              <th className="px-3 py-2 font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-n-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-n-500">No SKUs yet — run <strong>Onboard SKUs</strong> to seed from matched Amazon listings.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-n-100 hover:bg-n-25">
                  <td className="px-4 py-1.5 font-mono text-n-800">{r.sku}</td>
                  <td className="px-3 py-1.5 font-mono text-n-600">{r.asin ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono">{mkt(r.marketplaceId)}</td>
                  <td className="px-3 py-1.5">{r.fulfillment}</td>
                  <td className="px-3 py-1.5"><Badge value={r.automationState} styles={STATE_STYLES} />{r.suppressed && <span className="ml-1 text-[11px] text-orange-600">supp</span>}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{eur(r.breakevenCents)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{eur(r.strategyFloorCents)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{eur(r.currentPriceCents)}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-n-500">{r.exclusionReason ?? ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DecisionTable({ rows, loading }: { rows: RepricingDecisionRow[]; loading: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-n-100 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-n-800">Recent decisions (shadow)</span>
        <span className="text-[12px] text-n-500">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-n-25 text-left text-[11px] uppercase tracking-wide text-n-500">
            <tr>
              <th className="px-4 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 font-semibold">Mkt</th>
              <th className="px-3 py-2 font-semibold">Branch</th>
              <th className="px-3 py-2 font-semibold">Outcome</th>
              <th className="px-3 py-2 text-right font-semibold">Target</th>
              <th className="px-3 py-2 text-right font-semibold">Final</th>
              <th className="px-3 py-2 font-semibold">Submission</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-n-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-n-500">No decisions yet — they appear as live offer-change events arrive.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-n-100 hover:bg-n-25">
                  <td className="px-4 py-1.5 text-n-600">{when(r.at)}</td>
                  <td className="px-3 py-1.5 font-mono text-n-800">{r.sku}</td>
                  <td className="px-3 py-1.5 font-mono">{mkt(r.marketplaceId)}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-n-600">{r.branch ?? '—'}</td>
                  <td className="px-3 py-1.5"><Badge value={r.outcome} styles={OUTCOME_STYLES} /></td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-n-600">{eur(r.rawTargetCents)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{eur(r.finalPriceCents)}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-n-500">{r.submissionStatus ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

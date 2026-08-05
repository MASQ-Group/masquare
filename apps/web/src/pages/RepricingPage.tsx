import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw, DownloadCloud, ShieldAlert, Ban, Plus, X } from 'lucide-react';
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

  const control = useQuery({ queryKey: ['repricing', 'control'], queryFn: repricingApi.getControl });
  const setControl = useMutation({
    mutationFn: repricingApi.setControl,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repricing', 'control'] }),
  });
  const killed = control.data?.killSwitchEngaged ?? false;
  const liveWrites = control.data?.liveWritesEnabled ?? false;

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

      {/* Safety controls (§6.4): DB-backed kill switch + live-writes master (both default OFF). */}
      <div className={`mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border px-4 py-3 ${killed ? 'border-red-300 bg-red-50' : 'border-n-200 bg-n-0'}`}>
        <div className="flex items-center gap-2.5">
          <ShieldAlert size={17} className={killed ? 'text-red-600' : 'text-n-400'} />
          <span className="text-[13px] font-semibold text-n-800">Global kill switch</span>
          <button
            onClick={() => setControl.mutate({ killSwitchEngaged: !killed })}
            disabled={setControl.isPending}
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[13px] font-bold text-white disabled:opacity-50 ${killed ? 'bg-n-500 hover:bg-n-600' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {killed ? 'Kill switch ENGAGED — click to release' : 'STOP all writes'}
          </button>
          {killed && <span className="text-[12px] font-semibold text-red-700">No prices will be submitted.</span>}
        </div>
        <div className="h-6 w-px bg-n-200 max-md:hidden" />
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-n-800">Live writes</span>
          <button
            role="switch"
            aria-checked={liveWrites}
            disabled={setControl.isPending || killed}
            onClick={() => setControl.mutate({ liveWritesEnabled: !liveWrites })}
            className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${liveWrites ? 'bg-teal-500' : 'bg-n-200'}`}
            title={liveWrites ? 'Disable live writes (fall back to VALIDATION_PREVIEW dry-runs)' : 'Enable live writes for LIVE SKUs'}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${liveWrites ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <span className="text-[12px] text-n-500">{liveWrites ? 'ON — LIVE SKUs submit real prices' : 'OFF — LIVE SKUs only dry-run (VALIDATION_PREVIEW)'}</span>
        </div>
        <div className="flex-1" />
        <span className="text-[11px] text-n-400">Env kill switch also forces STOP regardless of this.</span>
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
      <div className="h-6" />
      <BlocklistCard />
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

const REASONS = ['UNAUTHORIZED', 'MAP_VIOLATOR', 'HIJACKER', 'OTHER'];

/** Seller blocklist (§5.2) — sellers excluded from the competitor set so they can't drag our price. */
function BlocklistCard() {
  const qc = useQueryClient();
  const blocklist = useQuery({ queryKey: ['repricing', 'blocklist'], queryFn: repricingApi.blocklist });
  const [sellerId, setSellerId] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [marketplaceId, setMarketplaceId] = useState('');
  const [reason, setReason] = useState('UNAUTHORIZED');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['repricing', 'blocklist'] });
  const add = useMutation({
    mutationFn: () => repricingApi.addBlocked({ sellerId, sellerName: sellerName || null, marketplaceId: marketplaceId || null, reason }),
    onSuccess: () => { setSellerId(''); setSellerName(''); setMarketplaceId(''); invalidate(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => repricingApi.removeBlocked(id), onSuccess: invalidate });

  const rows = blocklist.data ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-n-100 px-4 py-2.5">
        <Ban size={15} className="text-n-500" />
        <span className="text-[13px] font-semibold text-n-800">Seller blocklist</span>
        <span className="text-[12px] text-n-500">{rows.length}</span>
        <span className="ml-2 text-[11.5px] text-n-400">Excluded from the competitor set (unauthorized / MAP-violating / hijacker sellers).</span>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-b border-n-100 bg-n-25 px-4 py-2.5">
        <label className="flex flex-col gap-0.5"><span className="text-[10.5px] uppercase tracking-wide text-n-500">Seller ID *</span>
          <input value={sellerId} onChange={(e) => setSellerId(e.target.value)} placeholder="A1B2C3…" className="h-8 w-40 rounded-md border border-n-200 px-2 font-mono text-[12.5px] outline-none focus:border-teal-400" />
        </label>
        <label className="flex flex-col gap-0.5"><span className="text-[10.5px] uppercase tracking-wide text-n-500">Name</span>
          <input value={sellerName} onChange={(e) => setSellerName(e.target.value)} placeholder="optional" className="h-8 w-40 rounded-md border border-n-200 px-2 text-[12.5px] outline-none focus:border-teal-400" />
        </label>
        <label className="flex flex-col gap-0.5"><span className="text-[10.5px] uppercase tracking-wide text-n-500">Marketplace</span>
          <select value={marketplaceId} onChange={(e) => setMarketplaceId(e.target.value)} className="h-8 rounded-md border border-n-200 px-2 text-[12.5px] outline-none focus:border-teal-400">
            <option value="">All</option>
            <option value="A1PA6795UKMFR9">DE</option>
            <option value="A13V1IB3VIYZZH">FR</option>
            <option value="A1RKKUPIHCS9HS">ES</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5"><span className="text-[10.5px] uppercase tracking-wide text-n-500">Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 rounded-md border border-n-200 px-2 text-[12.5px] outline-none focus:border-teal-400">
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <button
          onClick={() => add.mutate()}
          disabled={!sellerId.trim() || add.isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
        >
          <Plus size={14} /> Block
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12.5px] text-n-500">No blocked sellers.</div>
      ) : (
        <table className="w-full text-[12.5px]">
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-n-100 hover:bg-n-25">
                <td className="px-4 py-1.5 font-mono text-n-800">{b.sellerId}</td>
                <td className="px-3 py-1.5 text-n-600">{b.sellerName ?? '—'}</td>
                <td className="px-3 py-1.5 font-mono">{b.marketplaceId ? mkt(b.marketplaceId) : 'All'}</td>
                <td className="px-3 py-1.5"><span className="rounded border border-n-200 bg-n-50 px-1.5 py-0.5 text-[11px] text-n-600">{b.reason ?? 'OTHER'}</span></td>
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => remove.mutate(b.id)} disabled={remove.isPending} className="inline-flex items-center gap-1 text-[12px] text-n-500 hover:text-red-600" title="Unblock">
                    <X size={13} /> Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

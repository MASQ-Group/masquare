import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FloorExplainCard } from '../components/repricing/FloorExplainCard';
import { StrategiesCard } from '../components/repricing/StrategiesCard';
import { RetentionCard } from '../components/repricing/RetentionCard';
import { MarketplaceCostsCard } from '../components/repricing/MarketplaceCostsCard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw, DownloadCloud, ShieldAlert, Ban, Plus, X, AlertTriangle, Gauge, ListChecks, ScrollText, SlidersHorizontal, Plug } from 'lucide-react';
import { Pagination, ProgressButton, Select, TabBar, TabPanel, TableScroll, type TabItem } from '@masquare/ui';
import { brandsApi, integrationsApi, repricingApi, vendorsApi, type OnboardResult, type RecomputeResult, type RoleProbe } from '../lib/api';
import { useJobProgress } from '../lib/useJobProgress';
import { PageHeader } from '../components/common/PageHeader';

// Amazon Buy Box repricing — ops console (Phase-appropriate: readiness, SKU floors, decision
// audit, onboard + recompute actions). Read-only insight into the shadow pipeline; the engine
// submits nothing unless SKUs are LIVE and the master switch is on (server-side env).

// Mirrors the Amazon marketplaces in the connector registry (api integrations/connectors.ts) —
// without these the tables show raw ids like A39IBJ37TRP1C6 instead of "AU".
const MARKETPLACE_LABEL: Record<string, string> = {
  ATVPDKIKX0DER: 'US', A2EUQ1WTGCTBG2: 'CA', A1AM78C64UM0Y8: 'MX', A2Q3Y263D00KWC: 'BR',
  A1F83G8C2ARO7P: 'UK', A28R8C7NBKEWEA: 'IE', A1PA6795UKMFR9: 'DE', A13V1IB3VIYZZH: 'FR',
  APJ6JRA9NG5V4: 'IT', A1RKKUPIHCS9HS: 'ES', A1805IZSGTT6HS: 'NL', AMEN7PMS3EDWL: 'BE',
  A2NODRKZP88ZB9: 'SE', A1C3SOZRARQ6R3: 'PL', A33AVAJ2PDY3EV: 'TR', ARBP9OOSHTCHU: 'EG',
  A17E79C6D8DWNP: 'SA', A2VIGQ35RCS4UG: 'AE', A21TJRUUN4KGV: 'IN', AE08WJ6YKNBMC: 'ZA',
  A1VC38T7YXB528: 'JP', A39IBJ37TRP1C6: 'AU', A19VAU5U5O7RUS: 'SG',
};
const mkt = (id: string) => MARKETPLACE_LABEL[id] ?? id;
// A marketplace has exactly one currency. RepricingDecision stores no currency column, so derive
// it here — otherwise a GBP target price renders as euros and reads ~17% wrong.
const MARKETPLACE_CCY: Record<string, string> = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', UK: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR',
  IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR', SE: 'SEK', PL: 'PLN', TR: 'TRY', EG: 'EGP',
  SA: 'SAR', AE: 'AED', IN: 'INR', ZA: 'ZAR', JP: 'JPY', AU: 'AUD', SG: 'SGD',
};
const ccyOfMarketplace = (marketplaceId: string) => MARKETPLACE_CCY[MARKETPLACE_LABEL[marketplaceId] ?? ''] ?? 'EUR';
// Money helper. Repricing figures are denominated in the MARKETPLACE's currency (a UK SKU's
// breakeven, floor and current price are all GBP), so never hardcode €: label with the row's own
// currency or the number reads as a different amount entirely.
const CCY_SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', CAD: 'CA$', AUD: 'A$', JPY: '¥', SEK: 'kr', PLN: 'zł', SGD: 'S$', MXN: 'MX$', TRY: '₺', AED: 'AED ', SAR: 'SAR ', INR: '₹', BRL: 'R$', ZAR: 'R' };
const money = (cents: number | null, currency?: string | null) => {
  if (cents == null) return '—';
  const ccy = (currency ?? 'EUR').toUpperCase();
  // JPY has no minor unit — Amazon still sends it x100 through our cents convention.
  const amount = (cents / 100).toFixed(ccy === 'JPY' ? 0 : 2);
  return `${CCY_SYMBOL[ccy] ?? `${ccy} `}${amount}`;
};
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

type RepricingTab = 'overview' | 'skus' | 'decisions' | 'rules' | 'connection';

const TAB_ORDER: RepricingTab[] = ['overview', 'skus', 'decisions', 'rules', 'connection'];

/**
 * Amazon Buy Box repricing — ops console.
 *
 * Grouped by what you came to do rather than by which service produces the data: watch the engine
 * (Overview), work on SKUs, read the audit, set the rules, or fix the connection. Stacked as one
 * column these ten panels ran to several screens, so the table you wanted was always below a
 * diagnostic you had already read.
 */
export function RepricingPage() {
  const qc = useQueryClient();

  // The open tab lives in the URL, so a reload keeps your place and a link to "the decision audit"
  // opens the decision audit.
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as RepricingTab | null;
  const tab: RepricingTab = raw && TAB_ORDER.includes(raw) ? raw : 'overview';
  const setTab = (t: RepricingTab) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', t);
        return next;
      },
      { replace: true },
    );

  const readiness = useQuery({ queryKey: ['repricing', 'readiness'], queryFn: repricingApi.readiness });

  const refreshAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['repricing'] });
  }, [qc]);

  // Scope for Onboard / Recompute. Both hit live SP-API per SKU, so during rollout you pilot one
  // marketplace at a time; '' means the whole estate and is deliberately not the default.
  const [scope, setScope] = useState('UK');
  const { data: allIntegrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list });
  const amazonMarkets = [...new Set(allIntegrations.filter((i) => i.channelType === 'amazon' && i.marketplace).map((i) => i.marketplace as string))].sort();

  // Recompute makes one live SP-API call per SKU, so cap the batch while piloting ('' = no cap).
  const [batch, setBatch] = useState('25');

  // Both run server-side and report progress; the page only follows them. Reloading mid-run
  // re-attaches to the run rather than appearing to have lost it.
  const onboardJob = useJobProgress('repricing.onboard', refreshAll);
  const recomputeJob = useJobProgress('repricing.recompute', refreshAll);

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
  const quarantined = byState.QUARANTINED ?? 0;

  const tabs: TabItem<RepricingTab>[] = [
    { key: 'overview', label: 'Overview', icon: <Gauge size={14} />, count: quarantined || null, tone: 'warning' },
    { key: 'skus', label: 'SKUs & floors', icon: <ListChecks size={14} />, count: total || null },
    { key: 'decisions', label: 'Decisions', icon: <ScrollText size={14} /> },
    { key: 'rules', label: 'Pricing rules', icon: <SlidersHorizontal size={14} /> },
    { key: 'connection', label: 'Connection', icon: <Plug size={14} /> },
  ];

  const scopeLabel = scope || 'all marketplaces';

  return (
    <div className="w-full">
      <PageHeader
        module="Sales channels"
        title="Amazon Repricing"
        info="Buy Box repricing engine — running in shadow mode. Intended prices are logged; nothing is submitted unless a SKU is LIVE and live-writes are enabled server-side."
        actions={
          <>
            {/* Scope guard: both actions below make one live SP-API call per SKU. */}
            <div className="w-[152px]">
              <Select
                dense
                searchable
                value={scope}
                onChange={setScope}
                placeholder="Marketplace"
                options={[...amazonMarkets.map((m) => ({ value: m, label: m + ' only' })), { value: '', label: 'All marketplaces' }]}
              />
            </div>
            <ProgressButton
              onClick={() => onboardJob.start(() => repricingApi.onboard(scope || undefined))}
              running={onboardJob.running}
              value={onboardJob.value}
              detail={onboardJob.detail}
              runningLabel={<><DownloadCloud size={15} /> Onboarding</>}
              title={'Seed repricing rows from matched Amazon listings on ' + scopeLabel}
            >
              <DownloadCloud size={15} /> Onboard SKUs
            </ProgressButton>
          </>
        }
        primary={
          <>
            <div className="w-[124px]">
              <Select
                dense
                value={batch}
                onChange={setBatch}
                options={[
                  { value: '25', label: 'first 25' },
                  { value: '100', label: 'first 100' },
                  { value: '500', label: 'first 500' },
                  { value: '', label: 'no cap' },
                ]}
              />
            </div>
            <ProgressButton
              tone="primary"
              onClick={() => recomputeJob.start(() => repricingApi.recomputeFloors(scope || undefined, batch ? Number(batch) : undefined))}
              running={recomputeJob.running}
              value={recomputeJob.value}
              detail={recomputeJob.detail}
              runningLabel={<><RefreshCcw size={15} className="animate-spin motion-reduce:animate-none" /> Recomputing</>}
              title={'Refresh fees and re-solve floors on ' + scopeLabel + ' — one live SP-API call per SKU'}
            >
              <RefreshCcw size={15} /> Recompute floors
            </ProgressButton>
          </>
        }
      />

      {/* Safety controls (§6.4): DB-backed kill switch + live-writes master (both default OFF).
          On every tab rather than filed under one — a stop control you have to go and find is not
          a stop control. Quiet while nothing is engaged, loud the moment something is. */}
      <div className={`mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-2 ${killed ? 'border-red-300 bg-red-50' : 'border-n-200 bg-n-0'}`}>
        <div className="flex items-center gap-2.5">
          <ShieldAlert size={16} className={killed ? 'text-red-600' : 'text-n-400'} />
          <button
            onClick={() => setControl.mutate({ killSwitchEngaged: !killed })}
            disabled={setControl.isPending}
            className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-[12.5px] font-bold text-white disabled:opacity-50 ${killed ? 'bg-n-500 hover:bg-n-600' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {killed ? 'Kill switch engaged — release' : 'Stop all writes'}
          </button>
          {killed && <span className="text-[12px] font-semibold text-red-700">No prices will be submitted.</span>}
        </div>
        <div className="h-5 w-px bg-n-200 max-md:hidden" />
        <div className="flex items-center gap-2.5">
          <span className="text-[12.5px] font-semibold text-n-800">Live writes</span>
          <button
            role="switch"
            aria-checked={liveWrites}
            aria-label="Live writes"
            disabled={setControl.isPending || killed}
            onClick={() => setControl.mutate({ liveWritesEnabled: !liveWrites })}
            className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${liveWrites ? 'bg-teal-500' : 'bg-n-200'}`}
            title={liveWrites ? 'Turn off live writes — LIVE SKUs fall back to dry-runs' : 'Turn on live writes for LIVE SKUs'}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${liveWrites ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <span className="text-[12px] text-n-500">{liveWrites ? 'On — LIVE SKUs submit real prices' : 'Off — LIVE SKUs dry-run only'}</span>
        </div>
        <div className="flex-1" />
        <span className="text-[11px] text-n-400">The env kill switch also forces stop, whatever this says.</span>
      </div>

      <RunOutcome job={onboardJob} kind="onboard" />
      <RunOutcome job={recomputeJob} kind="recompute" />

      <TabBar tabs={tabs} value={tab} onChange={setTab} label="Repricing sections" className="mb-5" />

      <TabPanel tabKey="overview" active={tab === 'overview'}>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Total SKUs" value={total} />
          {['LIVE', 'SHADOW', 'EXCLUDED', 'QUARANTINED', 'KILLED'].map((s) => (
            <StatTile key={s} label={s} value={byState[s] ?? 0} />
          ))}
        </div>
        {Object.keys(byExclusion).length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2 text-[12px] text-n-600">
            <span className="text-n-500">Excluded by reason:</span>
            {Object.entries(byExclusion)
              .filter(([k]) => k !== 'none')
              .map(([k, v]) => (
                <span key={k} className="rounded border border-n-200 bg-n-25 px-1.5 py-0.5 font-mono">{k}: {v}</span>
              ))}
          </div>
        )}
        <div className="flex flex-col gap-6">
          <PipelineCard />
          <QuarantineCard />
        </div>
      </TabPanel>

      <TabPanel tabKey="skus" active={tab === 'skus'}>
        <div className="flex flex-col gap-6">
          <SkuTable />
          <FloorExplainCard />
        </div>
      </TabPanel>

      <TabPanel tabKey="decisions" active={tab === 'decisions'}>
        <DecisionTable />
      </TabPanel>

      <TabPanel tabKey="rules" active={tab === 'rules'}>
        <div className="flex flex-col gap-6">
          <StrategiesCard />
          <MarketplaceCostsCard />
          <BlocklistCard />
        </div>
      </TabPanel>

      <TabPanel tabKey="connection" active={tab === 'connection'}>
        <div className="flex flex-col gap-6">
          <NotificationSetupCard />
          <RoleCheckCard />
          {/* Sits with the connection because it is about the volume the notification stream
              produces, not about how anything is priced. */}
          <RetentionCard />
        </div>
      </TabPanel>
    </div>
  );
}

/**
 * What a finished run did.
 *
 * Dismissed by hand rather than on a timer: a recompute can finish while you are reading another
 * tab, and a banner that has already faded reported nothing at all.
 */
function RunOutcome({ job, kind }: { job: ReturnType<typeof useJobProgress>; kind: 'onboard' | 'recompute' }) {
  if (job.running || (!job.result && !job.error)) return null;

  if (job.error) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
        <span className="flex-1">{job.error}</span>
        <button onClick={job.dismiss} className="shrink-0 text-red-500 hover:text-red-700" aria-label="Dismiss"><X size={14} /></button>
      </div>
    );
  }

  const recomputed = kind === 'recompute' ? (job.result as RecomputeResult) : null;
  const onboarded = kind === 'onboard' ? (job.result as OnboardResult) : null;

  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-[12.5px] text-teal-800">
      <span className="flex-1">
        {recomputed && (
          <>
            Recomputed {recomputed.ok} of {recomputed.processed} floors.
            {recomputed.stopped && <> Stopped early, so the rest still hold their previous floors.</>}
          </>
        )}
        {onboarded && (
          <>
            Onboarded {onboarded.created} new + {onboarded.updated} updated ({onboarded.skipped} skipped) of {onboarded.scannedListings} matched listings.
            {onboarded.unmatchedListings > 0 && (
              <> <b>{onboarded.unmatchedListings}</b> of {onboarded.totalListings} listings aren&rsquo;t linked to a product, so they can&rsquo;t be priced (no cost basis) — link them on Channel Listings to include them.</>
            )}
          </>
        )}
      </span>
      <button onClick={job.dismiss} className="shrink-0 text-teal-600 hover:text-teal-800" aria-label="Dismiss"><X size={14} /></button>
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

const STATES = ['LIVE', 'SHADOW', 'EXCLUDED', 'QUARANTINED', 'KILLED'];

/** SKU pricing & floors. Self-contained: onboarding seeds thousands of rows across marketplaces,
 *  so reaching one SKU needs search + filters + paging, not a fixed slice. */
function SkuTable() {
  const [q, setQ] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [brandId, setBrandId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list });
  const markets = [...new Set(integrations.filter((i) => i.channelType === 'amazon' && i.marketplace).map((i) => i.marketplace as string))].sort();
  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });

  // Any filter change returns to page 1 — otherwise a narrowed result set lands on an empty page.
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const query = useQuery({
    queryKey: ['repricing', 'sku-pricing', { q, marketplace, brandId, vendorId, state, page, pageSize }],
    queryFn: () => repricingApi.skuPricing({ q, marketplace, brandId, vendorId, state, take: pageSize, skip: (page - 1) * pageSize }),
    placeholderData: (prev) => prev,
  });
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const loading = query.isLoading;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-n-800">SKU pricing &amp; floors</span>
        <input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Search SKU or ASIN…" className="h-8 w-48 rounded-md border border-n-200 px-2.5 font-mono text-[12.5px] outline-none focus:border-teal-400" />
        <div className="w-[150px]">
          <Select dense searchable value={marketplace} onChange={reset(setMarketplace)}
            options={[{ value: '', label: 'All marketplaces' }, ...markets.map((m) => ({ value: m, label: m }))]} />
        </div>
        <div className="w-[160px]">
          <Select dense searchable value={brandId} onChange={reset(setBrandId)}
            options={[{ value: '', label: 'All brands' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} />
        </div>
        <div className="w-[160px]">
          <Select dense searchable value={vendorId} onChange={reset(setVendorId)}
            options={[{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]} />
        </div>
        <div className="w-[140px]">
          <Select dense value={state} onChange={reset(setState)}
            options={[{ value: '', label: 'All states' }, ...STATES.map((st) => ({ value: st, label: st }))]} />
        </div>
        <div className="flex-1" />
        <span className="text-[12px] text-n-500">{total.toLocaleString()} row{total === 1 ? '' : 's'}</span>
      </div>
      <TableScroll>
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-n-500">
            <tr>
              <th className="px-4 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 font-semibold">ASIN</th>
              <th className="px-3 py-2 font-semibold">Mkt</th>
              <th className="px-3 py-2 font-semibold">Fulfil</th>
              <th className="px-3 py-2 font-semibold">State</th>
              <th className="px-3 py-2 font-semibold">Strategy</th>
              <th className="px-3 py-2 text-right font-semibold">Breakeven</th>
              <th className="px-3 py-2 text-right font-semibold">Floor</th>
              <th className="px-3 py-2 text-right font-semibold">Current</th>
              <th className="px-3 py-2 font-semibold">Floors computed</th>
              <th className="px-3 py-2 font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-6 text-center text-n-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-6 text-center text-n-500">No SKUs yet — run <strong>Onboard SKUs</strong> to seed from matched Amazon listings.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-n-100 hover:bg-n-25">
                  <td className="px-4 py-1.5 font-mono text-n-800">{r.sku}</td>
                  <td className="px-3 py-1.5 font-mono text-n-600">{r.asin ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono">{mkt(r.marketplaceId)}</td>
                  <td className="px-3 py-1.5">{r.fulfillment}</td>
                  <td className="px-3 py-1.5"><Badge value={r.automationState} styles={STATE_STYLES} />{r.suppressed && <span className="ml-1 text-[11px] text-orange-600">supp</span>}</td>
                  <td className="px-3 py-1.5 text-[11.5px] text-n-600">{r.preset?.name ?? <span className="text-n-400">Balanced (default)</span>}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(r.breakevenCents, r.currency)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(r.strategyFloorCents, r.currency)}</td>
                  {/* The listing's price now. Set when the SKU is onboarded and refreshed on each
                      onboarding run, so it lags a price changed on Amazon since. */}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(r.currentPriceCents, r.currency)}</td>
                  {/* When these floors were last solved. A figure computed before a pricing fix is
                      stale until Recompute runs — without this it looks like the maths is wrong. */}
                  <td className="px-3 py-1.5 text-[11px] text-n-500">{r.floorsComputedAt ? when(r.floorsComputedAt) : <span className="text-n-400">never</span>}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-n-500">{r.exclusionReason ?? ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableScroll>
      <div className="px-4 pb-3">
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} pageSizeOptions={[50, 100, 200, 500]} />
      </div>
    </div>
  );
}

const OUTCOMES = ['PRICED', 'HELD', 'SKIPPED', 'QUARANTINED'];

/** Decision audit (§6.6) with search by SKU and outcome — the shadow-mode monitoring surface. */
function DecisionTable() {
  const [sku, setSku] = useState('');
  const [outcome, setOutcome] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // Any filter change returns to page 1 — otherwise a narrowed result set lands on an empty page.
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const decisions = useQuery({
    queryKey: ['repricing', 'decisions', { sku, outcome, page, pageSize }],
    queryFn: () => repricingApi.decisions({ take: pageSize, skip: (page - 1) * pageSize, sku, outcome }),
    placeholderData: (prev) => prev,
  });
  const rows = decisions.data?.items ?? [];
  const total = decisions.data?.total ?? 0;
  const loading = decisions.isLoading;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-n-800">Decision audit (shadow)</span>
        <div className="flex-1" />
        <input value={sku} onChange={(e) => reset(setSku)(e.target.value)} placeholder="Filter by SKU…" className="h-8 w-44 rounded-md border border-n-200 px-2.5 font-mono text-[12.5px] outline-none focus:border-teal-400" />
        <div className="w-[150px]">
          <Select
            dense
            value={outcome}
            onChange={reset(setOutcome)}
            options={[{ value: '', label: 'All outcomes' }, ...OUTCOMES.map((o) => ({ value: o, label: o }))]}
          />
        </div>
        <span className="text-[12px] text-n-500">{total.toLocaleString()} decision{total === 1 ? '' : 's'}</span>
      </div>
      <TableScroll>
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-n-500">
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
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-n-600">{money(r.rawTargetCents, ccyOfMarketplace(r.marketplaceId))}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(r.finalPriceCents, ccyOfMarketplace(r.marketplaceId))}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-n-500">{r.submissionStatus ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableScroll>
      <div className="px-4 pb-3">
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} pageSizeOptions={[50, 100, 200, 500]} />
      </div>
    </div>
  );
}

/** Quarantine queue (§5.5, §7): SKUs an unresolvable conflict took off automation. Hidden when
 *  empty; flags escalation at > 20 open or > 24h old. Resolve returns a SKU to shadow. */
function QuarantineCard() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const q = useQuery({
    queryKey: ['repricing', 'quarantine', { page, pageSize }],
    queryFn: () => repricingApi.quarantine({ take: pageSize, skip: (page - 1) * pageSize }),
    placeholderData: (prev) => prev,
  });
  const resolve = useMutation({
    mutationFn: (id: string) => repricingApi.resolveQuarantine(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repricing', 'quarantine'] });
      qc.invalidateQueries({ queryKey: ['repricing', 'sku-pricing'] });
      qc.invalidateQueries({ queryKey: ['repricing', 'readiness'] });
    },
  });
  const data = q.data;
  if (!data || data.total === 0) return null;
  const escalate = data.total > 20 || data.oldestHours > 24;
  const pageCount = Math.max(1, Math.ceil(data.total / pageSize));
  return (
    <div className={`overflow-hidden rounded-xl border ${escalate ? 'border-red-300' : 'border-orange-200'} bg-n-0`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 ${escalate ? 'bg-red-50' : 'bg-orange-50'}`}>
        <AlertTriangle size={15} className={escalate ? 'text-red-600' : 'text-orange-600'} />
        <span className="text-[13px] font-semibold text-n-800">Quarantine queue</span>
        <span className="rounded-pill bg-n-0 px-2 py-0.5 text-[11px] font-bold text-n-700">{data.total}</span>
        <span className="text-[12px] text-n-500">oldest {data.oldestHours}h</span>
        {escalate && <span className="text-[11px] font-bold uppercase tracking-wide text-red-600">escalate</span>}
        <span className="ml-2 text-[11.5px] text-n-400">
          A bound the floor cannot satisfy took these off automation. The reason names it — often Amazon&rsquo;s own
          maximum allowed price, which is not one of the columns.
        </span>
      </div>
      <TableScroll>
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-n-500">
            <tr>
              <th className="px-4 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 font-semibold">Mkt</th>
              <th className="px-3 py-2 text-right font-semibold">Floor</th>
              <th className="px-3 py-2 text-right font-semibold">Max</th>
              <th className="px-3 py-2 text-right font-semibold">Ceiling</th>
              <th className="px-3 py-2 font-semibold">Why</th>
              <th className="px-3 py-2 font-semibold">Since</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id} className="border-t border-n-100 hover:bg-n-25">
                <td className="px-4 py-1.5 font-mono text-n-800">{r.sku}</td>
                <td className="px-3 py-1.5 font-mono">{mkt(r.marketplaceId)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(r.strategyFloorCents, r.currency)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(r.maxPriceCents, r.currency)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(r.fairPricingCeilingCents, r.currency)}</td>
                <td className="px-3 py-1.5 text-[11.5px] text-n-600">{r.reason ?? '—'}</td>
                <td className="px-3 py-1.5 text-n-600">{when(r.updatedAt)}</td>
                <td className="px-3 py-1.5 text-right">
                  <button
                    onClick={() => resolve.mutate(r.id)}
                    disabled={resolve.isPending}
                    className="inline-flex h-7 items-center rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-teal-700 hover:border-teal-300 disabled:opacity-50"
                  >
                    Resolve
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <div className="px-4 pb-3">
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} pageSizeOptions={[25, 50, 100, 200]} />
      </div>
    </div>
  );
}

/**
 * Is the shadow loop actually running? "No decisions yet" has several very different causes, so
 * this walks SQS -> notifications -> snapshots -> decisions and names the first broken link.
 * Auto-refreshes while open; read-only.
 */
function PipelineCard() {
  const q = useQuery({ queryKey: ['repricing', 'pipeline'], queryFn: repricingApi.pipelineStatus, refetchInterval: 30_000 });
  const d = q.data;
  const healthy = d?.decisions.total ? true : false;
  const tone = !d ? 'border-n-200' : healthy ? 'border-teal-200' : 'border-amber-200';
  const dot = !d ? 'bg-n-300' : healthy ? 'bg-teal-500' : 'bg-amber-500';
  return (
    <div className={`overflow-hidden rounded-xl border bg-n-0 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-[13px] font-semibold text-n-800">Shadow pipeline</span>
        <span className="text-[11.5px] text-n-400">SQS → notifications → snapshots → decisions</span>
        <div className="flex-1" />
        <button onClick={() => q.refetch()} disabled={q.isFetching} className="inline-flex h-7 items-center rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 disabled:opacity-50">
          {q.isFetching ? 'Checking…' : 'Refresh'}
        </button>
      </div>
      {!d ? (
        <div className="px-4 py-3 text-[12.5px] text-n-500">Checking…</div>
      ) : (
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className={`text-[12.5px] ${healthy ? 'text-teal-700' : 'text-amber-700'}`}>{d.diagnosis}</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-n-600">
            <span>Poller <b className={d.sqs.poller === 'running' ? 'text-teal-700' : 'text-danger'}>{d.sqs.poller}</b>{d.sqs.reason ? ` (${d.sqs.reason})` : ''}</span>
            {d.sqs.queue && (
              <span>Queue {d.sqs.queue.reachable ? <b className="text-teal-700">reachable</b> : <b className="text-danger">unreachable</b>}
                {d.sqs.queue.reachable ? ` · ${d.sqs.queue.approximateMessages ?? 0} waiting` : d.sqs.queue.error ? ` · ${d.sqs.queue.error}` : ''}</span>
            )}
            {/* Since-boot message counts: separates "Amazon sent nothing" from "arrived unusable". */}
            {d.sqs.messages && (
              <span>Msgs received <b className={d.sqs.messages.receivedSinceBoot > 0 ? 'text-teal-700' : ''}>{d.sqs.messages.receivedSinceBoot}</b>
                {d.sqs.messages.discardedSinceBoot > 0 && <> · discarded <b className="text-danger">{d.sqs.messages.discardedSinceBoot}</b></>}
              </span>
            )}
            <span>Notifications 24h <b>{d.notifications.dedupedLast24h}</b></span>
            <span>Snapshots <b>{d.snapshots.total}</b> ({d.snapshots.last24h} in 24h)</span>
            <span>Decisions <b>{d.decisions.total}</b> ({d.decisions.last24h} in 24h)</span>
            <span>SKUs onboarded <b>{d.skus.onboarded}</b> · shadow <b>{d.skus.shadow}</b></span>
          </div>
          {d.sqs.env && Object.values(d.sqs.env).some((v) => !v) && (
            <div className="text-[11.5px] text-danger">
              Missing env: {Object.entries(d.sqs.env).filter(([, v]) => !v).map(([k]) => k).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** An SQS ARN and its queue URL describe the same queue in two notations — compare the parts. */
function arnMatchesUrl(arn: string | null | undefined, url: string | null | undefined): boolean {
  if (!arn || !url) return false;
  const [, , , region, account, name] = arn.split(':');
  return url.includes(region) && url.includes(account) && url.endsWith(name);
}


/**
 * Step 1 of activation (§2.2): subscribe a marketplace's SP-API notifications to the SQS queue.
 * Unlike everything else on this page this WRITES to Amazon — it creates a notification
 * destination and three subscriptions — so it is deliberately one explicit click per marketplace,
 * never automatic, and never done for all 18 at once.
 */
function NotificationSetupCard() {
  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list });
  const amazon = integrations.filter((i) => i.channelType === 'amazon');
  const [integrationId, setIntegrationId] = useState('');
  const [arn, setArn] = useState('');
  const [arnTouched, setArnTouched] = useState(false);
  const chosenMarketplace = amazon.find((i) => i.id === integrationId)?.marketplace ?? undefined;
  // The ARN is derived from the queue the poller reads for this marketplace's region, never
  // remembered. A hand-typed ARN pointing at another region is accepted by Amazon and then
  // silently delivers nothing, which is exactly how the eu-north-1 queue went unnoticed.
  const queueQ = useQuery({
    queryKey: ['repricing', 'queue', chosenMarketplace],
    queryFn: () => repricingApi.queueForMarketplace(chosenMarketplace),
    enabled: !!chosenMarketplace,
  });
  const queue = queueQ.data;
  useEffect(() => {
    if (!arnTouched && queue?.queueArn) setArn(queue.queueArn);
  }, [queue?.queueArn, arnTouched]);
  const setup = useMutation({ mutationFn: (types?: string[]) => integrationsApi.setupSpApiNotifications(integrationId, arn.trim(), types) });
  const [check, setCheck] = useState(false);
  const statusQ = useQuery({
    queryKey: ['repricing', 'subscriptions', integrationId],
    queryFn: () => repricingApi.subscriptionStatus(amazon.find((i) => i.id === integrationId)?.marketplace ?? undefined),
    enabled: check,
  });
  const st = statusQ.data;
  const chosen = amazon.find((i) => i.id === integrationId);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-n-800">Notification subscriptions</span>
        <span className="text-[11.5px] text-n-400">
          Subscribes ANY_OFFER_CHANGED · PRICING_HEALTH · FEE_PROMOTION for one marketplace to the SQS queue.
          &ldquo;Test delivery&rdquo; subscribes ORDER_CHANGE instead, as a positive control.
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-b border-n-100 bg-n-25 px-4 py-2.5">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10.5px] uppercase tracking-wide text-n-500">Marketplace</span>
          <select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} className="h-8 w-56 rounded-md border border-n-200 px-2 text-[12.5px] outline-none focus:border-teal-400">
            <option value="">Select a connection…</option>
            {amazon.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-0.5">
          <span className="text-[10.5px] uppercase tracking-wide text-n-500">SQS queue ARN</span>
          <input
            value={arn}
            onChange={(e) => { setArn(e.target.value); setArnTouched(true); }}
            placeholder={chosenMarketplace ? 'Resolving from the poller queue…' : 'Select a marketplace first'}
            className={`h-8 w-full min-w-[280px] rounded-md border px-2 font-mono text-[12px] outline-none focus:border-teal-400 ${queue?.queueArn && arn.trim() && arn.trim() !== queue.queueArn ? 'border-amber-400 bg-amber-50' : 'border-n-200'}`}
          />
        </label>
        <button
          onClick={() => setup.mutate(undefined)}
          disabled={!integrationId || !arn.trim().startsWith('arn:aws:sqs:') || setup.isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {setup.isPending ? 'Subscribing…' : 'Subscribe'}
        </button>
        {/* Positive control. The pricing notifications are only expected on listings that compete,
            so silence is ambiguous: it can mean "delivery is broken" or "nothing changed". ORDER_CHANGE
            fires on ordinary sales, which tells those two apart. */}
        <button
          onClick={() => setup.mutate(['ORDER_CHANGE'])}
          disabled={!integrationId || !arn.trim().startsWith('arn:aws:sqs:') || setup.isPending}
          title="Subscribes ORDER_CHANGE only, to prove Amazon can deliver to this queue. Unsubscribe once proven."
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:bg-n-50 disabled:opacity-50"
        >
          Test delivery
        </button>
      </div>

      {chosenMarketplace && (
        <div className="border-b border-n-100 bg-n-25 px-4 pb-2.5 text-[11.5px]">
          {queue?.configured ? (
            <span className="text-n-500">
              {queue.region?.toUpperCase()} region → this is the queue the poller reads ({queue.envVar}). Amazon only delivers to a
              queue in the same AWS region as the marketplace&rsquo;s endpoint.
              {arnTouched && arn.trim() !== queue.queueArn && (
                <span className="ml-1 font-semibold text-amber-700">You have edited it — an ARN in another region will be accepted and then deliver nothing.</span>
              )}
            </span>
          ) : (
            <span className="text-danger">{queue?.message ?? 'Resolving the queue for this marketplace…'}</span>
          )}
        </div>
      )}

      {/* What Amazon ACTUALLY has registered. The destination is created from an SQS ARN while the
          poller reads a queue URL — if those are different queues everything reports healthy and
          nothing is ever delivered, which is invisible from our side alone. */}
      <div className="border-b border-n-100 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold text-n-700">Currently registered with Amazon</span>
          <button onClick={() => setCheck(true)} disabled={statusQ.isFetching} className="inline-flex h-7 items-center rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 disabled:opacity-50">
            {statusQ.isFetching ? 'Checking…' : check ? 'Re-check' : 'Check'}
          </button>
          {chosen && <span className="text-[11.5px] text-n-400">for {chosen.name}</span>}
        </div>
        {st && (
          <div className="mt-2 flex flex-col gap-1 text-[12px]">
            {st.message && <div className="text-danger">{st.message}</div>}
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="w-[124px] shrink-0 text-n-500">Poller reads</span>
              <span className="mono break-all text-[11px] text-n-700">{st.pollerQueueUrl ?? '— not set —'}</span>
            </div>
            {(st.destinations ?? []).length === 0 && <div className="text-danger">No destinations registered — Amazon has nowhere to publish.</div>}
            {(st.destinations ?? []).map((dd) => (
              <div key={dd.destinationId} className="flex flex-wrap items-baseline gap-2">
                <span className="w-[124px] shrink-0 text-n-500">Publishes to</span>
                <span className={`mono break-all text-[11px] ${arnMatchesUrl(dd.sqsArn, st.pollerQueueUrl) ? 'text-teal-700' : 'text-danger'}`}>{dd.sqsArn ?? '—'}</span>
                {!arnMatchesUrl(dd.sqsArn, st.pollerQueueUrl) && <span className="text-[11px] font-semibold text-danger">≠ the queue we read</span>}
              </div>
            ))}
            {/* A subscription can be live yet feed the WRONG destination (e.g. a queue we have since
                moved region). "Subscribed" alone hides that, so name the queue each one publishes to. */}
            <div className="mt-1 flex flex-col gap-0.5">
              {(st.subscriptions ?? []).map((sub) => {
                const dest = (st.destinations ?? []).find((dd) => dd.destinationId === sub.destinationId);
                const right = dest ? arnMatchesUrl(dest.sqsArn, st.pollerQueueUrl) : false;
                return (
                  <div key={sub.type} className="flex flex-wrap items-baseline gap-2">
                    <span className={`w-[124px] shrink-0 ${sub.subscribed ? 'text-teal-700' : 'text-danger'}`}>
                      {sub.subscribed ? '✓' : '✕'} {sub.type}
                    </span>
                    {sub.subscribed ? (
                      <span className={`text-[11px] ${right ? 'text-teal-700' : 'text-danger'}`}>
                        {dest ? (right ? '→ our queue' : `→ ${dest.sqsArn} — WRONG QUEUE, re-subscribe to re-point`) : '→ destination unknown'}
                      </span>
                    ) : (
                      <span className="text-[11px] text-n-500">{sub.message}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 text-[12.5px]">
        {!setup.data && !setup.isError && (
          <span className="text-n-500">
            Pick one marketplace to start with{chosen ? ` (${chosen.name})` : ''} — this writes to Amazon, so do it
            deliberately, one at a time. Nothing is priced: it only starts the flow of events into the queue.
          </span>
        )}
        {setup.isError && <span className="text-danger">{(setup.error as Error)?.message ?? 'Subscription failed.'}</span>}
        {setup.data && (
          <div className="flex flex-col gap-1">
            <div className={setup.data.ok ? 'font-semibold text-teal-700' : 'font-semibold text-danger'}>
              {setup.data.ok ? 'Subscribed.' : setup.data.message ?? 'Some subscriptions failed.'}
              {setup.data.destinationId && <span className="ml-2 font-mono text-[11px] font-normal text-n-500">destination {setup.data.destinationId}</span>}
            </div>
            {setup.data.results.map((r) => (
              <div key={r.type} className="flex items-baseline gap-2">
                <span className={`w-[170px] font-mono text-[11.5px] ${r.ok ? 'text-teal-700' : 'text-danger'}`}>{r.ok ? '✓' : '✕'} {r.type}</span>
                <span className="text-[11.5px] text-n-500">{r.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One role result. Only 'denied' (401/403) is a real problem — a call that got through but
 *  returned no estimate still proves the role is granted, so it must not read as a failure. */
function RoleCell({ probe }: { probe: RoleProbe }) {
  const style = probe.state === 'granted' ? 'font-semibold text-teal-700' : probe.state === 'denied' ? 'font-semibold text-danger' : 'text-amber-700';
  const label = probe.state === 'granted' ? '✓ granted' : probe.state === 'denied' ? '✕ NOT granted' : '? inconclusive';
  return (
    <>
      <span className={style}>{label}</span>
      {probe.state !== 'granted' && <div className="text-[11px] text-n-500">{probe.message}</div>}
      {probe.state === 'granted' && !probe.ok && <div className="text-[11px] text-n-400">{probe.message}</div>}
    </>
  );
}

/** Pre-flight: do the Amazon connections actually hold the SP-API roles this module needs?
 *  Read-only (a fees estimate + a destinations list) — safe to run before activation. Not fetched
 *  on mount: each check makes live SP-API calls, so it runs only when asked. */
function RoleCheckCard() {
  const [run, setRun] = useState(false);
  const q = useQuery({ queryKey: ['repricing', 'roles'], queryFn: repricingApi.roleDiagnostics, enabled: run, staleTime: 60_000 });
  const d = q.data;
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-n-800">SP-API role check</span>
        <span className="text-[11.5px] text-n-400">
          Read-only pre-flight — confirms Pricing &amp; Notifications are granted. Nothing is written or priced.
        </span>
        <div className="flex-1" />
        {d && (
          <span className="text-[12px] text-n-500">
            Pricing <b className={d.pricingOk === d.total ? 'text-teal-700' : 'text-danger'}>{d.pricingOk}/{d.total}</b>
            {' · '}Notifications <b className={d.notificationsOk === d.total ? 'text-teal-700' : 'text-danger'}>{d.notificationsOk}/{d.total}</b>
          </span>
        )}
        <button
          onClick={() => (run ? q.refetch() : setRun(true))}
          disabled={q.isFetching}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          {q.isFetching ? 'Checking…' : run ? 'Re-check' : 'Run check'}
        </button>
      </div>

      {q.isError && <div className="px-4 py-3 text-[12.5px] text-danger">{(q.error as Error)?.message ?? 'Check failed.'}</div>}
      {!run && !q.isFetching && (
        <div className="px-4 py-4 text-[12.5px] text-n-500">
          Run this before activating: it calls each Amazon connection once to confirm the app really has the
          <b> Product Pricing</b> and <b>Notifications</b> roles. A missing role otherwise only shows up as a 403 mid-sync.
        </div>
      )}
      {d && (
        <TableScroll>
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-n-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Connection</th>
                <th className="px-3 py-2 font-semibold">Mkt</th>
                <th className="px-3 py-2 font-semibold">Pricing</th>
                <th className="px-3 py-2 font-semibold">Notifications</th>
              </tr>
            </thead>
            <tbody>
              {d.results.map((r) => (
                <tr key={r.integrationId} className="border-t border-n-100 hover:bg-n-25">
                  <td className="px-4 py-1.5 text-n-800">{r.name}</td>
                  <td className="px-3 py-1.5 font-mono">{r.marketplace ?? '—'}</td>
                  <td className="px-3 py-1.5"><RoleCell probe={r.pricing} /></td>
                  <td className="px-3 py-1.5"><RoleCell probe={r.notifications} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
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

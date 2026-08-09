import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CalendarRange, CheckCircle2, ChevronRight, Clock, Download, ExternalLink, Eye, EyeOff, Globe,
  KeyRound, ListChecks, MoreHorizontal, Pause, Pencil, Play, Plug, Plus, RefreshCw, Search, Trash2, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { integrationsApi, salesChannelsApi, type ChannelIntegration } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { IntegrationModal } from '../components/integrations/IntegrationModal';
import { MappingVerifyModal } from '../components/integrations/MappingVerifyModal';
import { ListingsPreviewModal } from '../components/integrations/ListingsPreviewModal';
import { BackfillModal } from '../components/integrations/BackfillModal';
import { GroupBackfillModal } from '../components/integrations/GroupBackfillModal';
import { ChannelLogoTile } from '../components/integrations/ChannelLogoTile';
import { Flag } from '../components/common/Flag';

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Relative "time ago" for the last-sync cell. */
function relTime(iso: string | null): string {
  if (!iso) return 'Never synced';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  const d = Math.floor(mins / 1440);
  return d === 1 ? 'Yesterday' : `${d} d ago`;
}

type ChipTone = 'teal' | 'neutral' | 'danger' | 'warning' | 'muted';
const CHIP_TONE: Record<ChipTone, string> = {
  teal: 'bg-teal-50 text-teal-700',
  neutral: 'bg-n-100 text-n-600',
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
  muted: 'bg-n-50 text-n-400',
};

/** A finished sync's message has the "N created, N updated…" shape; a sync that could not
 *  run at all (thrown error) does not. This distinguishes a partial success (some per-order
 *  errors, but the run completed) from a real failure — the former shows chips like any other
 *  channel, the latter shows the red error line. */
const syncCompleted = (i: ChannelIntegration) => /\d+ created\b/.test(i.lastSyncMessage ?? '');

/** True only when the last sync genuinely failed to run (not merely per-order errors). */
const syncFailed = (i: ChannelIntegration) => i.lastSyncStatus === 'error' && !syncCompleted(i);

/** Parse the stored last-sync summary into result chips, mirroring the design.
 *  The message format is fixed by the sync service: "N created, N updated,
 *  N cancelled, N errors[, N fees backfilled]…". Per-order errors still show chips
 *  (with a danger "errors" chip) — only a run that couldn't complete shows no chips. */
function syncChips(i: ChannelIntegration): { text: string; tone: ChipTone }[] {
  if (!i.lastSyncRunAt || !syncCompleted(i)) return [];
  const msg = i.lastSyncMessage ?? '';
  const num = (re: RegExp) => { const m = msg.match(re); return m ? Number(m[1]) : 0; };
  const created = num(/(\d+) created/);
  const updated = num(/(\d+) updated/);
  const cancelled = num(/(\d+) cancelled/);
  const skipped = num(/(\d+) cancelled\/refunded skipped/);
  const errors = num(/(\d+) errors/);
  const fees = num(/(\d+) fees/);
  const chips: { text: string; tone: ChipTone }[] = [];
  if (created > 0) chips.push({ text: `+${created} new`, tone: 'teal' });
  if (updated > 0) chips.push({ text: `~${updated} updated`, tone: 'neutral' });
  if (cancelled > 0) chips.push({ text: `${cancelled} cancelled`, tone: 'neutral' });
  if (skipped > 0) chips.push({ text: `${skipped} skipped`, tone: 'neutral' });
  if (errors > 0) chips.push({ text: `${errors} errors`, tone: 'danger' });
  if (fees > 0) chips.push({ text: `${fees} fees`, tone: 'warning' });
  if (chips.length === 0) chips.push({ text: 'No changes', tone: 'muted' });
  return chips;
}

// Health classification — a clean partition so the stat cards add up to the total.
// A completed sync with only per-order errors is not a failure (errors surface as a chip).
const hasError = (i: ChannelIntegration) => i.lastTestStatus === 'fail' || syncFailed(i);
const isHealthy = (i: ChannelIntegration) => !hasError(i) && !!i.mappingVerifiedAt && !!i.lastSyncRunAt && (i.lastSyncStatus === 'ok' || syncCompleted(i)) && i.status === 'active';
const needsAttention = (i: ChannelIntegration) => !hasError(i) && !isHealthy(i);

type Tab = 'all' | 'healthy' | 'attention' | 'errors';
type ModalTarget = ChannelIntegration | null | undefined; // undefined = closed, null = new

/** Group integrations by channel family (Amazon / eBay / OnBuy), preserving order. */
function groupByFamily(rows: ChannelIntegration[]): [string, ChannelIntegration[]][] {
  const map = new Map<string, ChannelIntegration[]>();
  for (const r of rows) { if (!map.has(r.channelType)) map.set(r.channelType, []); map.get(r.channelType)!.push(r); }
  return [...map.entries()];
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<ModalTarget>(undefined);
  const [mapVerify, setMapVerify] = useState<ChannelIntegration | undefined>();
  const [backfill, setBackfill] = useState<ChannelIntegration | undefined>();
  const [groupBackfill, setGroupBackfill] = useState<{ label: string; list: ChannelIntegration[] } | undefined>();
  const [syncTime, setSyncTime] = useState('05:00');
  const [listingsPreview, setListingsPreview] = useState<ChannelIntegration | undefined>();

  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [maskSecrets, setMaskSecrets] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const { data: integrations = [], isLoading } = useQuery({ queryKey: ['integrations'], queryFn: () => integrationsApi.list() });
  const { data: channelLogos = {} } = useQuery({ queryKey: ['channel-logos'], queryFn: () => integrationsApi.channelLogos() });
  const refetchLogos = () => qc.invalidateQueries({ queryKey: ['channel-logos'] });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations'] });

  // Sync automation: the configurable daily auto-sync time.
  const { data: syncSettings } = useQuery({ queryKey: ['integrations', 'sync-settings'], queryFn: () => integrationsApi.getSyncSettings() });
  useEffect(() => { if (syncSettings?.channelSyncTime) setSyncTime(syncSettings.channelSyncTime); }, [syncSettings?.channelSyncTime]);
  const saveSyncTime = useMutation({
    mutationFn: (t: string) => integrationsApi.setSyncSettings(t),
    onSuccess: (r) => { toast.success(`Daily sync time set to ${r.channelSyncTime} (UTC)`); qc.invalidateQueries({ queryKey: ['integrations', 'sync-settings'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });
  const setAutoSync = useMutation({
    mutationFn: ({ scope, enabled }: { scope: { ids?: string[]; channelType?: string; all?: boolean }; enabled: boolean }) => integrationsApi.bulkSetAutoSync(scope, enabled),
    onSuccess: ({ updated }) => { toast.success(`Auto-sync ${updated ? `updated on ${updated}` : 'unchanged'} connection${updated === 1 ? '' : 's'}`); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not update'),
  });

  // Each integration sells on a channel with a native country — that country's flag sits
  // beside the account name. Falls back to the marketplace code (Flag aliases UK -> GB)
  // when an integration has not been pointed at a channel yet.
  const { data: salesChannels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const countryByChannelId = useMemo(
    () => new Map(salesChannels.map((c) => [c.id, c.nativeCountry?.isoCode ?? null])),
    [salesChannels],
  );
  const countryOf = (i: ChannelIntegration) =>
    (i.targetSalesChannelId ? countryByChannelId.get(i.targetSalesChannelId) : null) ?? i.marketplace ?? null;

  const canSync = (i: ChannelIntegration) => !!i.mappingVerifiedAt && !!i.targetSalesChannelId && !!i.targetCompanyId && i.status === 'active';

  // ---- mutations -------------------------------------------------------
  const del = useMutation({
    mutationFn: (id: string) => integrationsApi.remove(id),
    onSuccess: () => { toast.success('Integration removed'); invalidate(); },
  });
  const sync = useMutation({
    mutationFn: (id: string) => integrationsApi.sync(id),
    onMutate: (id) => setSyncingId(id),
    onSuccess: (res) => {
      if (res.ok) toast.success(`Sync complete — ${res.created} created, ${res.updated} updated${res.cancelled ? `, ${res.cancelled} cancelled skipped` : ''}`);
      else toast.error(res.message ?? 'Sync failed');
      invalidate();
      qc.invalidateQueries({ queryKey: ['sales-transactions'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Sync failed'),
    onSettled: () => setSyncingId(null),
  });
  /** Sequential sync of a set — never hits a channel's API in parallel. Used by
   *  "Sync all", "Sync group" and "Sync selected". */
  const bulkSync = useMutation({
    mutationFn: async (targets: ChannelIntegration[]) => {
      const ready = targets.filter(canSync);
      setBulkProgress({ done: 0, total: ready.length });
      const results: { name: string; ok: boolean; created: number; updated: number; error?: string }[] = [];
      for (const t of ready) {
        try { const res = await integrationsApi.sync(t.id); results.push({ name: t.name, ok: res.ok, created: res.created, updated: res.updated, error: res.ok ? undefined : res.message }); }
        catch (e: any) { results.push({ name: t.name, ok: false, created: 0, updated: 0, error: e?.response?.data?.message ?? 'Sync failed' }); }
        setBulkProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
      return results;
    },
    onSuccess: (results) => {
      if (results.length === 0) { toast.info('No selected connections are ready to sync — verify mapping and target first'); return; }
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      const tally = `${ok.reduce((s, r) => s + r.created, 0)} created, ${ok.reduce((s, r) => s + r.updated, 0)} updated`;
      if (failed.length === 0) toast.success(`Synced ${ok.length} connection${ok.length === 1 ? '' : 's'} — ${tally}`);
      else if (ok.length === 0) toast.error(`All ${failed.length} sync${failed.length === 1 ? '' : 's'} failed — ${failed[0].name}: ${failed[0].error}`);
      else toast.warning(`Synced ${ok.length} of ${results.length} — ${tally}. Failed: ${failed.map((f) => f.name).join(', ')}`);
      invalidate();
      qc.invalidateQueries({ queryKey: ['sales-transactions'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Sync failed'),
    onSettled: () => setBulkProgress(null),
  });
  /** Pause = disable, Resume = enable. Bulk status change over selected. */
  const setStatus = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: 'active' | 'disabled' }) => {
      for (const id of ids) await integrationsApi.update(id, { status });
      return { count: ids.length, status };
    },
    onSuccess: ({ count, status }) => { toast.success(`${count} connection${count === 1 ? '' : 's'} ${status === 'disabled' ? 'paused' : 'resumed'}`); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not update'),
  });

  // ---- derived ---------------------------------------------------------
  const stats = useMemo(() => ({
    total: integrations.length,
    healthy: integrations.filter(isHealthy).length,
    attention: integrations.filter(needsAttention).length,
    errors: integrations.filter(hasError).length,
  }), [integrations]);

  const q = query.trim().toLowerCase();
  const matchesQuery = (i: ChannelIntegration) =>
    !q || [i.name, i.marketplace, i.marketplaceLabel, i.connectorLabel, ...i.secretFields.map((s) => s.fieldKey)]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  const matchesTab = (i: ChannelIntegration) =>
    tab === 'all' || (tab === 'healthy' && isHealthy(i)) || (tab === 'attention' && needsAttention(i)) || (tab === 'errors' && hasError(i));

  const visible = integrations.filter((i) => matchesQuery(i) && matchesTab(i));
  const groups = groupByFamily(integrations)
    .map(([family, all]) => ({ family, all, rows: all.filter((i) => visible.includes(i)) }))
    .filter((g) => (q || tab !== 'all' ? g.rows.length > 0 : true));

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const selectedRows = integrations.filter((i) => selected[i.id]);
  const syncableCount = integrations.filter(canSync).length;

  const toggleSel = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const setGroupSel = (rows: ChannelIntegration[], on: boolean) =>
    setSelected((s) => { const n = { ...s }; rows.forEach((r) => { n[r.id] = on; }); return n; });

  // ---- render ----------------------------------------------------------
  const TABS: { key: Tab; label: string; count?: number; show: boolean }[] = [
    { key: 'all', label: 'All', show: true },
    { key: 'attention', label: 'Needs attention', count: stats.attention, show: stats.attention > 0 },
    { key: 'errors', label: 'Errors', count: stats.errors, show: stats.errors > 0 },
  ];

  return (
    <div className="w-full">
      <PageHeader
        module="Setup"
        title="Marketplace integrations"
        info="Connected marketplace accounts syncing orders, fees & refunds into the platform. API keys are encrypted and never leave it."
        summary={`${stats.total} connection${stats.total === 1 ? '' : 's'} · ${stats.healthy} healthy${stats.attention ? ` · ${stats.attention} attention` : ''}`}
        actions={
          <button
            className="hbtn"
            disabled={syncableCount === 0 || bulkSync.isPending}
            title={syncableCount === 0 ? 'No connections are ready to sync — verify mapping and set the target first' : `Sync all ${syncableCount} ready connection${syncableCount === 1 ? '' : 's'} now`}
            onClick={() => bulkSync.mutate(integrations)}
          >
            <RefreshCw size={15} className={bulkSync.isPending ? 'animate-spin' : ''} />
            {bulkProgress ? `Syncing ${bulkProgress.done}/${bulkProgress.total}…` : `Sync all${syncableCount ? ` (${syncableCount})` : ''}`}
          </button>
        }
        primary={<button className="hbtn-primary" onClick={() => setModal(null)}><Plus size={16} /> Add connection</button>}
      />

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading…</div>}

      {!isLoading && integrations.length === 0 && (
        <div className="card mt-6 flex flex-col items-center gap-3 py-14 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-n-100 text-n-400"><Plug size={22} /></div>
          <div className="text-[14px] font-medium text-n-700">No integrations yet</div>
          <p className="max-w-sm text-[12.5px] text-n-500">Add your first channel integration to start pulling sales data automatically.</p>
          <button className="btn btn-ghost" onClick={() => setModal(null)}><Plus size={16} /> Add connection</button>
        </div>
      )}

      {!isLoading && integrations.length > 0 && (
        <>
          {/* Health summary — full stat cards on desktop; a compact one-row mini-KPI strip on mobile
              (guide Principle 4). Both drive the same tab filter. */}
          <div className="mt-5 grid grid-cols-4 gap-3.5 max-[900px]:grid-cols-2 max-[767px]:hidden">
            <StatCard label="Connections" value={stats.total} sub="total" icon={<Plug size={17} />} tone="teal" active={tab === 'all'} onClick={() => setTab('all')} />
            <StatCard label="Healthy" value={stats.healthy} sub="syncing OK" icon={<CheckCircle2 size={17} />} tone="teal" active={tab === 'healthy'} onClick={() => setTab('healthy')} />
            <StatCard label="Needs attention" value={stats.attention} sub="mapping / never synced" icon={<AlertTriangle size={17} />} tone="warning" active={tab === 'attention'} onClick={() => setTab('attention')} />
            <StatCard label="Sync errors" value={stats.errors} sub="in last run" icon={<XCircle size={17} />} tone="danger" active={tab === 'errors'} onClick={() => setTab('errors')} />
          </div>
          <div className="mt-4 hidden grid-cols-4 gap-1.5 max-[767px]:grid">
            {([
              { label: 'Connections', value: stats.total, tab: 'all', color: 'text-n-900' },
              { label: 'Healthy', value: stats.healthy, tab: 'healthy', color: 'text-teal-600' },
              { label: 'Attention', value: stats.attention, tab: 'attention', color: 'text-warning' },
              { label: 'Errors', value: stats.errors, tab: 'errors', color: 'text-danger' },
            ] as const).map((s) => (
              <button
                key={s.label}
                onClick={() => setTab(s.tab)}
                className={`flex flex-col items-center gap-0.5 rounded-[10px] bg-n-0 px-1 py-2 ${tab === s.tab ? 'border-[1.5px] border-teal-500' : 'border border-n-200'}`}
              >
                <span className={`text-[18px] font-bold ${s.color}`}>{s.value}</span>
                <span className="text-center text-[10.5px] leading-tight text-n-500">{s.label}</span>
              </button>
            ))}
          </div>

          {/* Sync automation */}
          {(() => {
            const autoOn = integrations.filter((i) => i.autoSyncEnabled).length;
            const allOn = syncableCount > 0 && integrations.filter(canSync).every((i) => i.autoSyncEnabled);
            return (
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-n-200 bg-n-0 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Clock size={16} className="text-n-400" />
                  <span className="text-[13px] font-semibold text-n-800">Daily auto-sync at</span>
                  <input type="time" value={syncTime} onChange={(e) => setSyncTime(e.target.value)} className="h-9 rounded-md border border-n-200 bg-n-0 px-2.5 font-mono text-[13px] text-n-900 outline-none focus:border-teal-400" />
                  <span className="text-[12px] text-n-400">UTC</span>
                  <button
                    className="btn btn-ghost h-9"
                    disabled={saveSyncTime.isPending || syncTime === syncSettings?.channelSyncTime}
                    onClick={() => saveSyncTime.mutate(syncTime)}
                  >
                    {saveSyncTime.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <div className="h-6 w-px bg-n-200 max-md:hidden" />
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-semibold text-n-800">Auto-sync all connections</span>
                  <button
                    role="switch"
                    aria-checked={allOn}
                    disabled={setAutoSync.isPending || syncableCount === 0}
                    onClick={() => setAutoSync.mutate({ scope: { all: true }, enabled: !allOn })}
                    className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${allOn ? 'bg-teal-500' : 'bg-n-200'}`}
                    title={allOn ? 'Disable daily auto-sync for all connections' : 'Enable daily auto-sync for all connections'}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${allOn ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                  <span className="text-[12px] text-n-500">{autoOn} of {integrations.length} on</span>
                </div>
                <div className="flex-1" />
                <button className="btn btn-ghost h-9" onClick={() => setGroupBackfill({ label: 'all connections', list: integrations })}>
                  <CalendarRange size={15} /> Pull older orders…
                </button>
              </div>
            );
          })()}

          {/* Toolbar */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-n-200 bg-n-0 p-[3px]">
              {TABS.filter((t) => t.show).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex h-[34px] items-center gap-2 rounded-md px-3 text-[13px] font-semibold transition-colors ${tab === t.key ? 'bg-teal-500 text-white' : 'text-n-600 hover:text-n-900'}`}
                >
                  {t.label}
                  {t.count != null && <span className={`rounded-full px-1.5 text-[11px] font-bold ${tab === t.key ? 'bg-white/25 text-white' : 'bg-n-100 text-warning'}`}>{t.count}</span>}
                </button>
              ))}
            </div>
            <div className="flex h-[42px] min-w-[220px] flex-1 items-center gap-2.5 rounded-lg border border-n-200 bg-n-0 px-3.5">
              <Search size={16} className="text-n-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search account, country, credential…" className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-n-900 outline-none placeholder:text-n-400" />
            </div>
            <button
              onClick={() => setMaskSecrets((m) => !m)}
              className="flex h-[42px] items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-3.5 text-[12.5px] font-medium text-n-600 hover:border-n-300"
              title={maskSecrets ? 'Reveal credential hints (last 4)' : 'Hide credential hints'}
            >
              {maskSecrets ? <EyeOff size={15} /> : <Eye size={15} />} Secrets
            </button>
          </div>

          {/* Bulk bar */}
          {selectedIds.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-teal-300 bg-teal-50 px-4 py-2.5">
              <span className="text-[13.5px] font-semibold text-n-900">{selectedIds.length} connection{selectedIds.length === 1 ? '' : 's'} selected</span>
              <div className="h-4 w-px bg-teal-200" />
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
                disabled={bulkSync.isPending}
                onClick={() => bulkSync.mutate(selectedRows)}
              >
                <RefreshCw size={14} className={bulkSync.isPending ? 'animate-spin' : ''} /> Sync selected
              </button>
              {selectedRows.some((i) => i.status === 'active') && (
                <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ ids: selectedRows.filter((i) => i.status === 'active').map((i) => i.id), status: 'disabled' })}>
                  <Pause size={14} /> Pause
                </button>
              )}
              {selectedRows.some((i) => i.status === 'disabled') && (
                <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ ids: selectedRows.filter((i) => i.status === 'disabled').map((i) => i.id), status: 'active' })}>
                  <Play size={14} /> Resume
                </button>
              )}
              <div className="flex-1" />
              <button className="inline-flex h-8 items-center px-2 text-[12.5px] font-semibold text-n-600 hover:text-n-900" onClick={() => setSelected({})}>Clear</button>
            </div>
          )}

          {/* Groups */}
          <div className="mt-4 flex flex-col gap-4">
            {groups.map(({ family, all, rows }) => {
              const open = !collapsedGroups[family];
              const gHealthy = all.filter(isHealthy).length;
              const gAttn = all.filter(needsAttention).length;
              const gErr = all.filter(hasError).length;
              const allSelected = all.length > 0 && all.every((r) => selected[r.id]);
              return (
                <div key={family} className="overflow-hidden rounded-xl border border-n-200 bg-n-0">
                  {/* Group header */}
                  <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 bg-n-25 px-4 py-3 ${open ? 'border-b border-n-100' : ''}`}>
                    <button onClick={() => setCollapsedGroups((c) => ({ ...c, [family]: !c[family] }))} className="grid h-6 w-6 place-items-center rounded text-n-400 hover:bg-n-100 hover:text-n-700" title={open ? 'Collapse' : 'Expand'}>
                      <ChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                    </button>
                    <ChannelLogoTile channelType={family} label={all[0].connectorLabel} url={channelLogos[family]} onChanged={refetchLogos} />
                    <span className="text-[15px] font-bold text-n-900">{all[0].connectorLabel}</span>
                    <span className="rounded-full bg-n-100 px-2 py-0.5 text-[12px] font-bold text-n-600">{all.length}</span>
                    <div className="flex flex-1 items-center gap-3.5 pl-2">
                      {gHealthy > 0 && <HealthChip dot="var(--teal-500)" color="text-teal-700" text={`${gHealthy} healthy`} />}
                      {gAttn > 0 && <HealthChip dot="var(--warning)" color="text-warning" text={`${gAttn} to verify`} />}
                      {gErr > 0 && <HealthChip dot="var(--danger)" color="text-danger" text={`${gErr} error${gErr === 1 ? '' : 's'}`} />}
                    </div>
                    {(() => {
                      const gReady = all.filter(canSync);
                      const gAllOn = gReady.length > 0 && gReady.every((i) => i.autoSyncEnabled);
                      const gAutoOn = all.filter((i) => i.autoSyncEnabled).length;
                      return (
                        <label className="mr-1 flex items-center gap-1.5 text-[12px] text-n-600" title={`Daily auto-sync for ${all[0].connectorLabel} (${gAutoOn}/${all.length} on)`}>
                          <button
                            role="switch"
                            aria-checked={gAllOn}
                            disabled={setAutoSync.isPending || gReady.length === 0}
                            onClick={() => setAutoSync.mutate({ scope: { channelType: family }, enabled: !gAllOn })}
                            className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-40 ${gAllOn ? 'bg-teal-500' : 'bg-n-200'}`}
                          >
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${gAllOn ? 'left-[18px]' : 'left-0.5'}`} />
                          </button>
                          Auto-sync
                        </label>
                      );
                    })()}
                    <button
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
                      disabled={all.filter(canSync).length === 0}
                      title="Pull older orders for this marketplace"
                      onClick={() => setGroupBackfill({ label: all[0].connectorLabel, list: all })}
                    >
                      <CalendarRange size={14} /> Older orders
                    </button>
                    <button
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
                      disabled={bulkSync.isPending || all.filter(canSync).length === 0}
                      title={all.filter(canSync).length === 0 ? 'No connections in this marketplace are ready to sync' : `Sync ${all.filter(canSync).length} ready connection(s)`}
                      onClick={() => bulkSync.mutate(all)}
                    >
                      <RefreshCw size={14} className={bulkSync.isPending ? 'animate-spin' : ''} /> Sync group
                    </button>
                  </div>

                  {open && (
                    <div className="overflow-x-auto">
                      <div className="min-w-[900px]">
                        {/* column header */}
                        <div className="grid h-10 items-center border-b border-n-100 px-4 text-[11px] font-semibold uppercase tracking-wide text-n-500" style={GRID}>
                          <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={allSelected} onChange={(e) => setGroupSel(all, e.target.checked)} title="Select all in group" />
                          <div>Account</div>
                          <div>Status</div>
                          <div>Health</div>
                          <div>Last sync</div>
                          <div />
                        </div>

                        {rows.map((i, idx) => (
                          <IntegrationRow
                            key={i.id}
                            i={i}
                            countryCode={countryOf(i)}
                            logoUrl={channelLogos[i.channelType]}
                            last={idx === rows.length - 1}
                            selected={!!selected[i.id]}
                            expanded={!!expanded[i.id]}
                            syncing={syncingId === i.id && sync.isPending}
                            maskSecrets={maskSecrets}
                            canSync={canSync(i)}
                            onToggleSel={() => toggleSel(i.id)}
                            onToggleExpand={() => setExpanded((e) => ({ ...e, [i.id]: !e[i.id] }))}
                            onSync={() => sync.mutate(i.id)}
                            onEdit={() => setModal(i)}
                            onBackfill={() => setBackfill(i)}
                            onMapping={() => setMapVerify(i)}
                            onPreviewListings={() => setListingsPreview(i)}
                            onRemove={() => confirm(`Remove integration “${i.name}”? Stored keys will be deleted.`) && del.mutate(i.id)}
                          />
                        ))}

                        {rows.length === 0 && (
                          <div className="px-4 py-7 text-center text-[13px] text-n-400">No connections match your filters in this marketplace.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {groups.length === 0 && (
            <div className="mt-7 text-center text-[14px] text-n-400">No connections match {query ? `“${query}”` : 'this filter'}.</div>
          )}
        </>
      )}

      {modal !== undefined && (
        <IntegrationModal integration={modal ?? undefined} onClose={() => setModal(undefined)} onSaved={() => { setModal(undefined); invalidate(); }} />
      )}
      {mapVerify && (
        <MappingVerifyModal integration={mapVerify} onClose={() => setMapVerify(undefined)} onVerified={() => { setMapVerify(undefined); invalidate(); }} />
      )}
      {backfill && (
        <BackfillModal integration={backfill} onClose={() => setBackfill(undefined)} onDone={() => { invalidate(); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); }} />
      )}
      {groupBackfill && (
        <GroupBackfillModal scopeLabel={groupBackfill.label} integrations={groupBackfill.list} onClose={() => setGroupBackfill(undefined)} onDone={() => { invalidate(); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); }} />
      )}
      {listingsPreview && (
        <ListingsPreviewModal integration={listingsPreview} onClose={() => setListingsPreview(undefined)} />
      )}
    </div>
  );
}

const GRID = { gridTemplateColumns: '36px minmax(200px,1.6fr) 110px minmax(190px,1.1fr) minmax(220px,1.2fr) 150px' } as const;

function StatCard({ label, value, sub, icon, tone, active, onClick }: {
  label: string; value: number; sub: string; icon: React.ReactNode; tone: 'teal' | 'warning' | 'danger'; active: boolean; onClick: () => void;
}) {
  const tint = tone === 'teal' ? 'bg-teal-50 text-teal-700' : tone === 'warning' ? 'bg-warning-bg text-warning' : 'bg-danger-bg text-danger';
  const num = tone === 'teal' ? 'text-n-900' : tone === 'warning' ? 'text-warning' : 'text-danger';
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border bg-n-0 p-4 text-left transition-shadow ${active ? 'border-teal-400 ring-1 ring-teal-400' : 'border-n-200 hover:border-n-300'}`}
    >
      <div className="flex items-center gap-2.5">
        <span className={`grid h-[30px] w-[30px] place-items-center rounded-lg ${tint}`}>{icon}</span>
        <span className="text-[12px] font-semibold text-n-600">{label}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className={`text-[27px] font-bold tabular-nums tracking-tight ${num}`}>{value}</span>
        <span className="text-[12.5px] text-n-400">{sub}</span>
      </div>
    </button>
  );
}

function HealthChip({ dot, color, text }: { dot: string; color: string; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${color}`}>
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} /> {text}
    </span>
  );
}

function IntegrationRow({
  i, last, selected, expanded, syncing, maskSecrets, canSync, countryCode, logoUrl,
  onToggleSel, onToggleExpand, onSync, onEdit, onBackfill, onMapping, onPreviewListings, onRemove,
}: {
  i: ChannelIntegration; last: boolean; selected: boolean; expanded: boolean; syncing: boolean; maskSecrets: boolean; canSync: boolean;
  onToggleSel: () => void; onToggleExpand: () => void; onSync: () => void; onEdit: () => void; onBackfill: () => void; onMapping: () => void; onPreviewListings: () => void; onRemove: () => void;
  countryCode?: string | null;
  // Some channels (eBay) run one account across every marketplace, so a single country flag
  // is misleading — show the channel logo (or a globe) instead.
  logoUrl?: string | null;
}) {
  const error = hasError(i);
  const chips = syncChips(i);
  return (
    <div className={error ? 'shadow-[inset_3px_0_0_var(--danger)]' : selected ? 'shadow-[inset_3px_0_0_var(--teal-500)]' : ''}>
      <div
        className={`grid items-center px-4 ${last && !expanded ? '' : 'border-b border-n-100'} ${selected ? 'bg-teal-50/50' : error ? 'bg-danger-bg/30' : 'hover:bg-n-25'}`}
        style={{ ...GRID, minHeight: 60 }}
      >
        <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={selected} onChange={onToggleSel} />

        {/* account */}
        <button onClick={onToggleExpand} className="flex min-w-0 items-center gap-2.5 pr-3 text-left">
          <ChevronRight size={14} className={`shrink-0 text-n-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          {/* Flag + name only: the group header above already says which connector this is,
              and the country reads off the flag, so the code and sub-line were repetition. */}
          <div className="flex min-w-0 items-center gap-2">
            {i.channelType === 'ebay'
              ? (logoUrl
                  ? <img src={logoUrl} alt="eBay" className="h-4 w-6 shrink-0 rounded object-contain" />
                  : <Globe size={15} className="shrink-0 text-n-400" />)
              : <Flag code={countryCode} className="shrink-0" />}
            <span className="truncate text-[14px] font-semibold text-n-900">{i.name}</span>
          </div>
        </button>

        {/* status */}
        <div>
          {i.status === 'active'
            ? <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-0.5 text-[12px] font-semibold text-teal-700"><span className="h-1.5 w-1.5 rounded-full bg-teal-500" />active</span>
            : <span className="inline-flex items-center gap-1.5 rounded-full bg-n-100 px-2.5 py-0.5 text-[12px] font-semibold text-n-500"><span className="h-1.5 w-1.5 rounded-full bg-n-400" />paused</span>}
        </div>

        {/* health */}
        <div className="flex flex-col gap-1 pr-2.5">
          {i.lastTestStatus === 'ok' && <HealthLine ok text="Connection OK" />}
          {i.lastTestStatus === 'fail' && <HealthLine text="Auth failed" tone="danger" />}
          {!i.lastTestStatus && <HealthLine text="Not tested" tone="muted" />}
          {i.mappingVerifiedAt ? <HealthLine ok text="Mapping verified" /> : <HealthLine text="Mapping not verified" tone="warning" />}
        </div>

        {/* last sync */}
        <div className="min-w-0 pr-3">
          <div className={`text-[13px] font-semibold ${syncing ? 'text-teal-700' : syncFailed(i) ? 'text-danger' : !i.lastSyncRunAt ? 'text-warning' : 'text-n-700'}`}>
            {syncing ? 'Syncing…' : relTime(i.lastSyncRunAt)}
          </div>
          {!syncing && syncFailed(i) && <div className="mt-0.5 truncate text-[11.5px] text-danger" title={i.lastSyncMessage ?? undefined}>{i.lastSyncMessage ?? 'Last sync failed'}</div>}
          {!syncing && chips.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {chips.map((c, n) => <span key={n} className={`rounded px-1.5 py-px text-[11px] font-semibold tabular-nums ${CHIP_TONE[c.tone]}`}>{c.text}</span>)}
            </div>
          )}
        </div>

        {/* actions */}
        <div className="flex items-center justify-end gap-1.5">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-2.5 text-[12.5px] font-semibold text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSync || syncing}
            title={canSync ? 'Pull orders now' : 'Verify the mapping and set the target channel/company first'}
            onClick={onSync}
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing' : 'Sync now'}
          </button>
          <button className="grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 hover:border-n-300 hover:text-n-800" title="Details" onClick={onToggleExpand}>
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="grid grid-cols-[1.1fr_1fr] gap-7 border-b border-n-100 bg-n-25/60 px-4 py-4 pl-[58px] max-[760px]:grid-cols-1" style={{ gridColumn: '1 / -1' }}>
          {/* credentials */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Credentials</div>
            <div className="mt-2.5 flex flex-col gap-2">
              {i.secretFields.map((s) => (
                <div key={s.fieldKey} className="flex items-center gap-2.5">
                  <KeyRound size={14} className="shrink-0 text-n-400" />
                  <span className="min-w-[130px] text-[12.5px] text-n-500">{s.fieldKey}</span>
                  <span className="mono rounded border border-n-200 bg-n-50 px-2 py-0.5 text-[12px] text-n-700">
                    {!s.set ? 'not set' : maskSecrets ? '••••••••' : `•••• ${s.last4}`}
                  </span>
                </div>
              ))}
              {i.secretFields.length === 0 && <div className="text-[12.5px] text-n-400">No credentials for this connector.</div>}
            </div>
            <p className="mt-2 text-[11px] text-n-400">Keys are encrypted at rest (AES-256-GCM) and never displayed in full.</p>
            <div className="mt-3.5 flex flex-wrap gap-2">
              <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300" onClick={onEdit}><Pencil size={14} /> Edit connection</button>
              <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50" disabled={!canSync} title={canSync ? 'Import all orders in a past date range' : 'Verify the mapping and set the target first'} onClick={onBackfill}><Download size={14} /> Pull older orders</button>
              {['amazon', 'ebay', 'onbuy'].includes(i.channelType) && (
                <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300" title="Fetch a few live listings to preview — nothing is saved" onClick={onPreviewListings}><Eye size={14} /> Preview listings</button>
              )}
              <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-danger-bd bg-n-0 px-3 text-[12.5px] font-semibold text-danger hover:bg-danger-bg" onClick={onRemove}><Trash2 size={14} /> Remove</button>
            </div>
          </div>

          {/* field mapping + last result */}
          <div>
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Field mapping</div>
              <button className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-teal-700 hover:underline" onClick={onMapping}>
                {i.mappingVerifiedAt ? 'Review mapping' : 'Verify field mapping'} <ExternalLink size={13} />
              </button>
            </div>
            <div className={`mt-2.5 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${i.mappingVerifiedAt ? 'border-teal-100 bg-teal-50/60' : 'border-warning-bd bg-warning-bg/50'}`}>
              {i.mappingVerifiedAt ? <CheckCircle2 size={16} className="shrink-0 text-teal-600" /> : <ListChecks size={16} className="shrink-0 text-warning" />}
              <span className="text-[12.5px] text-n-700">{i.mappingVerifiedAt ? 'All order fields mapped and verified.' : 'Verify the field mapping before the next sync.'}</span>
            </div>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-n-500">Last sync result</div>
            <div className="mt-1.5 text-[12.5px] leading-relaxed text-n-600">{i.lastSyncRunAt ? (i.lastSyncMessage ?? '—') : 'No sync has run yet for this connection.'}</div>
            {i.lastSyncRunAt && <div className="mt-1 text-[12px] text-n-400">Synced {fmtDateTime(i.lastSyncRunAt)}{i.autoSyncEnabled ? ' · auto-sync daily' : ''}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function HealthLine({ ok, text, tone }: { ok?: boolean; text: string; tone?: 'danger' | 'warning' | 'muted' }) {
  const color = ok ? 'text-teal-700' : tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-n-400';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-medium ${color}`}>
      {ok ? <CheckCircle2 size={14} /> : tone === 'danger' ? <XCircle size={14} /> : <AlertTriangle size={14} />} {text}
    </span>
  );
}

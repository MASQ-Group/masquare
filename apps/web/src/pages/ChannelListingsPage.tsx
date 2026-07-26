import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown, Edit3, ExternalLink, Grid2x2, LayoutGrid, Layers, Package, Pause, RefreshCw, Search, SlidersHorizontal, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Pagination, Select } from '@masquare/ui';
import { channelListingsApi, type ChannelListingCell, type ChannelListingChannel } from '../lib/api';
import { formatAmount } from '../lib/format';
import { Flag } from '../components/common/Flag';
import { usePersistentState } from '../lib/usePersistentState';
import { CHANNEL_GROUPS, channelGroupOf, sortChannelsCanonical, type ChannelGroup } from '../lib/channelGroups';

// Design status palette.
const STATUS: Record<string, { label: string; color: string; dot: string; bg: string }> = {
  live: { label: 'Live', color: '#0E7A73', dot: '#14A79D', bg: '#E1F3F1' },
  low: { label: 'Low stock', color: '#B4791E', dot: '#E8A33D', bg: '#FBF1DE' },
  oos: { label: 'Out of stock', color: '#C63B1B', dot: '#E5714E', bg: '#FBE7E1' },
  paused: { label: 'Paused', color: '#5A665F', dot: '#9AA6A1', bg: '#EEF1F0' },
  error: { label: 'Error', color: '#C63B1B', dot: '#C63B1B', bg: '#FBE7E1' },
};
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} d ago`;
};
const money = (v: number | null, ccy: string | null) => (v == null ? '—' : formatAmount(v, ccy || 'GBP'));
const eur = (v: number | null) => (v == null ? '—' : formatAmount(v, 'EUR'));
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);

/** Small "sample data" chip for the placeholder analytics we don't yet compute. */
const Sample = () => <span className="ml-2 rounded-full bg-n-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-n-400">Sample</span>;

// Per-status cell tint + 3px left-accent bar (design: amber=low, red=out, grey=paused, neutral=live).
const TONE: Record<string, { edge: string; bg: string }> = {
  live: { edge: '#EBEEEC', bg: '#ffffff' },
  low: { edge: '#E8A33D', bg: '#FFFDF8' },
  oos: { edge: '#E5714E', bg: '#FFFBFA' },
  paused: { edge: '#D6DBD8', bg: '#ffffff' },
  error: { edge: '#E5714E', bg: '#FFFBFA' },
};

/** A labelled metric block used in the cell's grid mode. */
function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3 py-[11px]">
      <div className="mb-[3px] text-[9.5px] font-bold uppercase tracking-[0.07em] text-n-400">{label}</div>
      {children}
    </div>
  );
}

/**
 * Adaptive channel matrix cell — "Channel Listings · Matrix cell, final spec".
 * One component, driven by a 200px container query on its own width:
 *  - ≥200px  → labelled auto-fit grid (4→3→2 blocks), everything visible.
 *  - <200px  → compact: Inventory + Price stay; Status→dot, Profit→chip, full values on hover/focus.
 * Data order is always Inventory → Price → Profit → Status. Square corners; the 3px left
 * accent echoes listing status. Numbers are tabular (.mono) so columns align.
 */
function ChannelCell({ cell, solo }: { cell?: ChannelListingCell; solo?: boolean }) {
  const [open, setOpen] = useState<null | 'status' | 'profit'>(null);

  if (!cell) {
    return (
      <div className="chc flex flex-col justify-center gap-1 border-l border-n-100 px-3 py-3">
        <span className="text-[12px] text-n-300">Not listed</span>
        <button title="List on this channel (coming with push sync)" className="w-fit text-left text-[11px] font-semibold text-teal-700 hover:text-teal-600">+ List</button>
      </div>
    );
  }

  const st = STATUS[cell.status] ?? STATUS.live;
  const tone = cell.loss ? { edge: '#E5714E', bg: '#FDF1EE' } : TONE[cell.status] ?? TONE.live;
  const profitColor = cell.loss ? '#C63B1B' : '#0E7A73';
  const qty = cell.quantity ?? 0;

  // Reveal on hover AND keyboard focus (spec: use a popover, never `title`).
  const discl = (key: 'status' | 'profit') => ({
    tabIndex: 0,
    onMouseEnter: () => setOpen(key),
    onMouseLeave: () => setOpen((o) => (o === key ? null : o)),
    onFocus: () => setOpen(key),
    onBlur: () => setOpen((o) => (o === key ? null : o)),
  });

  return (
    <div className="chc border-l border-n-100" style={{ background: tone.bg }}>
      {/* GRID MODE — ≥200px */}
      <div className="chc-grid">
        <Block label="Inventory">
          <div className="flex items-baseline gap-1">
            <span className="mono text-[18px] font-bold leading-none text-n-900">{qty}</span>
            <span className="text-[11px] text-n-400">units</span>
          </div>
        </Block>
        <Block label="Price">
          <span className="mono text-[16px] font-bold leading-none text-n-900">{money(cell.price, cell.currency)}</span>
        </Block>
        <Block label="Est. profit">
          <div className={solo ? 'flex items-baseline gap-1.5' : 'flex flex-col gap-0.5'} style={{ color: profitColor }}>
            <span className="mono text-[16px] font-bold leading-none">{eur(cell.profitEur)}</span>
            <span className="text-[11px] font-semibold leading-tight">{pct(cell.marginPct)}</span>
          </div>
        </Block>
        <Block label="Status">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: st.color }}>
            <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: st.dot }} />{st.label}
          </span>
        </Block>
      </div>

      {/* COMPACT MODE — <200px */}
      <div className="chc-compact relative px-3 py-[11px]">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-baseline gap-0.5">
            <span className="mono text-[18px] font-bold leading-none text-n-900">{qty}</span>
            <span className="text-[10px] text-n-400">u</span>
          </div>
          <span className="relative cursor-default p-0.5 outline-none" aria-label={`Status: ${st.label}`} {...discl('status')}>
            <span className="inline-block h-[9px] w-[9px] rounded-full" style={{ background: st.dot }} />
            {open === 'status' && (
              <span className="absolute right-[-4px] top-5 z-20 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-bold shadow-lg" style={{ color: st.color, background: st.bg, borderColor: `${st.color}22` }}>{st.label}</span>
            )}
          </span>
        </div>
        <div className="mono mt-[7px] whitespace-nowrap text-[15px] font-bold text-n-900">{money(cell.price, cell.currency)}</div>
        <span className="relative mt-2 inline-flex cursor-default items-center gap-1 rounded-full border py-0.5 pl-[5px] pr-[7px] outline-none" style={{ background: cell.loss ? '#FDF1EE' : '#F3FAF9', borderColor: cell.loss ? '#F0B3A2' : '#E1F0EE' }} aria-label={`Estimated profit ${eur(cell.profitEur)}, ${pct(cell.marginPct)} margin`} {...discl('profit')}>
          {cell.loss ? <TrendingDown size={13} style={{ color: profitColor }} /> : <TrendingUp size={13} style={{ color: profitColor }} />}
          <span className="mono text-[11px] font-bold" style={{ color: profitColor }}>{pct(cell.marginPct)}</span>
          {open === 'profit' && (
            <span className="absolute left-0 top-[26px] z-20 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-bold shadow-lg" style={{ color: profitColor, background: cell.loss ? '#FBE7E1' : '#E1F3F1', borderColor: `${profitColor}22` }}>Est. profit {eur(cell.profitEur)} · {pct(cell.marginPct)}</span>
          )}
        </span>
      </div>
    </div>
  );
}

// A toolbar dropdown holding a checkbox list. Closes on outside click / Escape.
function FilterMenu({
  icon, label, summary, active, children, width = 300,
}: { icon: ReactNode; label: string; summary: string; active?: boolean; children: ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className={`flex h-[42px] items-center gap-2 rounded-md border px-3.5 text-[13px] font-semibold ${active ? 'border-teal-300 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-700 hover:bg-n-25'}`}>
        {icon}<span>{label}</span>
        <span className={`text-[12px] font-normal ${active ? 'text-teal-600' : 'text-n-400'}`}>{summary}</span>
        <ChevronDown size={15} className={active ? 'text-teal-500' : 'text-n-400'} />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1.5 max-h-[70vh] overflow-y-auto rounded-xl border border-n-200 bg-n-0 p-1.5 shadow-lg" style={{ width }}>
          {children}
        </div>
      )}
    </div>
  );
}

// A single checkbox row inside a FilterMenu.
function CheckRow({
  checked, indeterminate, onClick, children,
}: { checked: boolean; indeterminate?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-n-50">
      <span className={`grid h-[17px] w-[17px] flex-none place-items-center rounded border ${checked || indeterminate ? 'border-teal-500 bg-teal-500 text-white' : 'border-n-300 bg-n-0'}`}>
        {checked && <Check size={12} strokeWidth={3} />}
        {!checked && indeterminate && <span className="h-[2px] w-[9px] rounded bg-white" />}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </button>
  );
}

// The caret half of the "Sync now" split button — pick specific channels or whole
// groups to sync, instead of syncing every connected channel.
function SyncMenu({
  groups, channelsInGroup, onSync, busy,
}: {
  groups: ChannelGroup[];
  channelsInGroup: (key: string) => ChannelListingChannel[];
  onSync: (ids: string[]) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setMany = (ids: string[], on: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const count = sel.size;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} disabled={busy} aria-label="Choose channels to sync"
        className="inline-flex h-10 items-center rounded-r-md border-l border-teal-600/40 bg-teal-500 px-2 text-white hover:bg-teal-600 disabled:opacity-60">
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-[330px] rounded-xl border border-n-200 bg-n-0 shadow-lg">
          <div className="flex items-center justify-between border-b border-n-100 px-3 py-2.5">
            <span className="text-[12.5px] font-semibold text-n-800">Sync specific channels</span>
            {count > 0 && <button onClick={() => setSel(new Set())} className="text-[11.5px] font-semibold text-n-500 hover:text-n-700">Clear</button>}
          </div>
          <div className="max-h-[52vh] overflow-y-auto p-1.5">
            {groups.map((g) => {
              const chans = channelsInGroup(g.key);
              const ids = chans.map((c) => c.id);
              const on = ids.filter((id) => sel.has(id)).length;
              return (
                <div key={g.key} className="mt-1.5 first:mt-0">
                  <CheckRow checked={on === ids.length} indeterminate={on > 0 && on < ids.length} onClick={() => setMany(ids, on < ids.length)}>
                    <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-n-500">{g.label}</span>
                    <span className="text-[11px] text-n-400">{ids.length}</span>
                  </CheckRow>
                  {chans.map((c) => (
                    <div key={c.id} className="pl-4">
                      <CheckRow checked={sel.has(c.id)} onClick={() => toggle(c.id)}>
                        <Flag code={c.countryIso} />
                        <span className="flex-1 truncate text-[13px] font-medium text-n-800">{c.name}</span>
                        <span className="text-[11px] text-n-400">{c.currency ?? ''}</span>
                      </CheckRow>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="border-t border-n-100 p-2">
            <button disabled={!count || busy} onClick={() => { onSync([...sel]); setOpen(false); }}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-teal-500 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50">
              <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Sync selected{count ? ` (${count})` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ChannelListingsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = usePersistentState<'listings' | 'analytics'>('channelListings.tab', 'listings');
  const [view, setView] = usePersistentState<'matrix' | 'product'>('channelListings.view', 'matrix');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  // Per-channel column visibility persists across reloads; empty = all channels shown.
  const [hiddenArr, setHiddenArr] = usePersistentState<string[]>('channelListings.hiddenChannels', []);
  const hidden = useMemo(() => new Set(hiddenArr), [hiddenArr]);
  const pageSize = 25;

  const { data: channels = [] } = useQuery({ queryKey: ['channel-listings-channels'], queryFn: () => channelListingsApi.channels() });
  const { data, isLoading } = useQuery({ queryKey: ['channel-listings', { q, page }], queryFn: () => channelListingsApi.dashboard({ q: q || undefined, page, pageSize }) });

  const sync = useMutation({
    mutationFn: (integrationIds?: string[]) => channelListingsApi.sync(integrationIds),
    onSuccess: (r) => {
      const ok = r.channels.filter((c) => c.ok);
      const fail = r.channels.filter((c) => !c.ok);
      const failNote = fail.length ? ` · ${fail.length} skipped${fail[0].message ? ` (${fail[0].message})` : ''}` : '';
      toast.success(`Synced ${r.total} listings across ${ok.length} channel${ok.length === 1 ? '' : 's'}${failNote}`);
      qc.invalidateQueries({ queryKey: ['channel-listings'] });
      qc.invalidateQueries({ queryKey: ['channel-listings-channels'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Sync failed'),
  });

  // Columns always follow the canonical group sequence; visibility is one per-channel set.
  const orderedChannels = useMemo(() => sortChannelsCanonical(channels), [channels]);
  const shownChannels = useMemo(() => orderedChannels.filter((c) => !hidden.has(c.id)), [orderedChannels, hidden]);
  const connectedCount = orderedChannels.length;
  const withListingsCount = useMemo(() => channels.filter((c) => c.listingCount > 0).length, [channels]);
  const lastSynced = useMemo(() => channels.map((c) => c.lastPulledAt).filter(Boolean).sort().slice(-1)[0] ?? null, [channels]);

  // Only the groups that actually have a connected channel, in canonical order.
  const presentGroups = useMemo(
    () => CHANNEL_GROUPS.filter((g) => orderedChannels.some((c) => channelGroupOf(c)?.key === g.key)),
    [orderedChannels],
  );
  const channelsInGroup = (key: string) => orderedChannels.filter((c) => channelGroupOf(c)?.key === key);
  const toggleChannel = (id: string) => setHiddenArr((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const setChannelsVisible = (ids: string[], visible: boolean) => setHiddenArr((a) => {
    const s = new Set(a);
    ids.forEach((id) => (visible ? s.delete(id) : s.add(id)));
    return [...s];
  });
  const shownCount = shownChannels.length;

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Status filter is applied client-side over the loaded page (server does search + channel).
  const matchStatus = (cell?: ChannelListingCell) => {
    if (!cell) return false;
    if (statusFilter === 'all') return true;
    if (statusFilter === 'loss') return cell.loss;
    if (statusFilter === 'issues') return cell.loss || ['error', 'oos', 'low', 'paused'].includes(cell.status);
    return cell.status === statusFilter;
  };
  const visibleRows = useMemo(() => {
    if (statusFilter === 'all') return rows;
    return rows.filter((r) => shownChannels.some((c) => matchStatus(r.cells[c.id])));
  }, [rows, statusFilter, shownChannels]);

  const gridCols = `minmax(240px,1.4fr) ${shownChannels.map(() => 'minmax(150px,1fr)').join(' ')}`;

  return (
    <div className="w-full">
      {/* header */}
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[260px]">
          <div className="eyebrow mb-1.5">Sales channels</div>
          <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Channel listings</h1>
          <p className="mt-1 text-[13.5px] text-n-500">Everything live across your connected marketplaces — quantities, prices and listing health in one place.</p>
        </div>
        <div className="flex items-center gap-2.5 pt-1">
          <div className="flex items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3 py-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-teal-500 shadow-[0_0_0_3px_rgba(20,167,157,.13)]" />
            <span className="text-[12.5px] font-semibold text-n-700">{connectedCount} channel{connectedCount === 1 ? '' : 's'} · {withListingsCount} with listings</span>
            <span className="text-[12px] text-n-400">· synced {ago(lastSynced)}</span>
          </div>
          <div className="flex">
            <button onClick={() => sync.mutate(undefined)} disabled={sync.isPending}
              className="inline-flex h-10 items-center gap-2 rounded-l-md bg-teal-500 px-4 text-[13.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-60">
              <RefreshCw size={16} className={sync.isPending ? 'animate-spin' : ''} /> {sync.isPending ? 'Syncing…' : 'Sync all'}
            </button>
            <SyncMenu groups={presentGroups} channelsInGroup={channelsInGroup} busy={sync.isPending} onSync={(ids) => sync.mutate(ids)} />
          </div>
        </div>
      </div>

      {/* tabs */}
      <div className="mb-5 flex items-center gap-6 border-b border-n-200">
        {([['analytics', 'Analytics'], ['listings', 'Listings']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`-mb-px flex items-center gap-2 border-b-[2.5px] px-1 py-2.5 text-[14px] font-semibold transition ${tab === key ? 'border-teal-500 text-n-900' : 'border-transparent text-n-500 hover:text-n-700'}`}>
            {label}{key === 'listings' && <span className="text-[12px] font-semibold text-n-400">{total.toLocaleString()}</span>}
          </button>
        ))}
      </div>

      {tab === 'analytics' && <AnalyticsTab channels={orderedChannels} />}

      {tab === 'listings' && (
        <>
          {/* toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <div className="flex h-[42px] min-w-[220px] flex-1 items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3.5">
              <Search size={16} className="text-n-400" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search SKU or product title…" className="flex-1 bg-transparent text-[13.5px] text-n-900 outline-none placeholder:text-n-400" />
            </div>

            {/* Group filter — show whole marketplace regions at once */}
            {presentGroups.length > 0 && (
              <FilterMenu icon={<Layers size={15} />} label="Groups"
                summary={`${presentGroups.filter((g) => channelsInGroup(g.key).some((c) => !hidden.has(c.id))).length}/${presentGroups.length}`}
                active={presentGroups.some((g) => channelsInGroup(g.key).every((c) => hidden.has(c.id)))}>
                <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-n-400">Channel groups</span>
                  <button onClick={() => setChannelsVisible(orderedChannels.map((c) => c.id), true)} className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-600">Show all</button>
                </div>
                {presentGroups.map((g) => {
                  const ids = channelsInGroup(g.key).map((c) => c.id);
                  const visible = ids.filter((id) => !hidden.has(id)).length;
                  return (
                    <CheckRow key={g.key} checked={visible === ids.length} indeterminate={visible > 0 && visible < ids.length}
                      onClick={() => setChannelsVisible(ids, visible === 0)}>
                      <span className="flex-1 text-[13px] font-medium text-n-800">{g.label}</span>
                      <span className="text-[11px] text-n-400">{ids.length}</span>
                    </CheckRow>
                  );
                })}
              </FilterMenu>
            )}

            {/* Per-channel column filter */}
            {orderedChannels.length > 0 && (
              <FilterMenu icon={<SlidersHorizontal size={15} />} label="Channels" width={330}
                summary={`${shownCount}/${orderedChannels.length}`} active={hidden.size > 0}>
                <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-n-400">Show columns</span>
                  <div className="flex gap-2.5">
                    <button onClick={() => setChannelsVisible(orderedChannels.map((c) => c.id), true)} className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-600">All</button>
                    <button onClick={() => setChannelsVisible(orderedChannels.map((c) => c.id), false)} className="text-[11.5px] font-semibold text-n-500 hover:text-n-700">None</button>
                  </div>
                </div>
                {presentGroups.map((g) => (
                  <div key={g.key} className="mt-1.5 first:mt-0">
                    <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-n-400">{g.label}</div>
                    {channelsInGroup(g.key).map((c) => (
                      <CheckRow key={c.id} checked={!hidden.has(c.id)} onClick={() => toggleChannel(c.id)}>
                        <Flag code={c.countryIso} />
                        <span className="flex-1 truncate text-[13px] font-medium text-n-800">{c.name}</span>
                        <span className="text-[11px] text-n-400">{c.currency ?? ''}</span>
                      </CheckRow>
                    ))}
                  </div>
                ))}
              </FilterMenu>
            )}

            <Select className="w-44" value={statusFilter} onChange={setStatusFilter} options={[
              { value: 'all', label: 'All statuses' }, { value: 'loss', label: 'Loss-making only' }, { value: 'issues', label: 'Issues only' },
              { value: 'oos', label: 'Out of stock' }, { value: 'low', label: 'Low stock' }, { value: 'error', label: 'Errors' }, { value: 'paused', label: 'Paused' },
            ]} />
            <div className="flex h-[42px] overflow-hidden rounded-md border border-n-200 bg-n-0">
              <button onClick={() => setView('matrix')} className={`flex items-center gap-1.5 px-3.5 text-[13px] font-semibold ${view === 'matrix' ? 'bg-teal-50 text-teal-700' : 'text-n-600 hover:bg-n-25'}`}><Grid2x2 size={15} /> Matrix</button>
              <div className="w-px bg-n-200" />
              <button onClick={() => setView('product')} className={`flex items-center gap-1.5 px-3.5 text-[13px] font-semibold ${view === 'product' ? 'bg-teal-50 text-teal-700' : 'text-n-600 hover:bg-n-25'}`}><LayoutGrid size={15} /> By product</button>
            </div>
          </div>

          {/* summary line */}
          {orderedChannels.length > 0 && (
            <div className="mb-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-n-500">
              <span>Showing <strong className="font-semibold text-n-700">{visibleRows.length}</strong> of <strong className="font-semibold text-n-700">{total.toLocaleString()}</strong> SKUs</span>
              <span className="text-n-300">·</span>
              <span><strong className="font-semibold text-n-700">{shownCount}</strong> of {orderedChannels.length} channels{withListingsCount > 0 ? ` · ${withListingsCount} with listings` : ''}</span>
            </div>
          )}

          {isLoading && <div className="card p-10 text-center text-[13px] text-n-500">Loading…</div>}
          {!isLoading && total === 0 && (
            <div className="card p-12 text-center">
              <Package size={30} className="mx-auto text-n-300" />
              <p className="mt-3 text-[14px] font-medium text-n-700">No channel listings pulled yet</p>
              <p className="mt-1 text-[13px] text-n-500">Hit <strong>Sync now</strong> to pull what's live on your connected Amazon marketplaces.</p>
            </div>
          )}

          {/* MATRIX */}
          {!isLoading && total > 0 && view === 'matrix' && (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <div style={{ minWidth: 600 }}>
                  <div className="grid items-stretch border-b border-n-100 bg-n-25" style={{ gridTemplateColumns: gridCols }}>
                    <div className="flex items-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500">Product</div>
                    {shownChannels.map((c) => (
                      <div key={c.id} className="flex flex-col gap-0.5 border-l border-n-100 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Flag code={c.countryIso} />
                          <span className="text-[12.5px] font-bold text-n-900">{c.name}</span>
                        </div>
                        <span className="text-[11px] text-n-400">Inventory · Price {c.currency ?? ''} · Profit · Status</span>
                      </div>
                    ))}
                  </div>
                  {visibleRows.map((r) => (
                    <div key={r.productId} className="grid items-stretch border-b border-n-50 hover:bg-n-25/60" style={{ gridTemplateColumns: gridCols }}>
                      <Link to={`/channel-listings/${r.productId}`} className="flex items-center gap-3 px-4 py-3 text-inherit">
                        <div className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-n-100 bg-n-50 text-n-300"><Package size={18} /></div>
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-semibold text-n-900" title={r.title}>{r.title}</div>
                          <div className="code mt-0.5 whitespace-normal break-words text-[11.5px] leading-snug text-teal-700">{r.sku} <span className="text-n-300">· {r.masterStock ?? '—'} avail.</span></div>
                        </div>
                      </Link>
                      {shownChannels.map((c) => (
                        <ChannelCell key={c.id} cell={r.cells[c.id]} solo={shownChannels.length === 1} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* BY PRODUCT */}
          {!isLoading && total > 0 && view === 'product' && (
            <div className="flex flex-col gap-3.5">
              {visibleRows.map((r) => (
                <div key={r.productId} className="card p-4">
                  <div className="flex items-center gap-3.5">
                    <Link to={`/channel-listings/${r.productId}`} className="grid h-11 w-11 flex-none place-items-center rounded-lg border border-n-100 bg-n-50 text-n-300"><Package size={22} /></Link>
                    <div className="min-w-0 flex-1">
                      <Link to={`/channel-listings/${r.productId}`} className="block truncate text-[15px] font-semibold text-n-900 hover:text-teal-700">{r.title}</Link>
                      <div className="mt-0.5 flex items-center gap-2 text-[12.5px]">
                        <span className="code text-teal-700">{r.sku}</span><span className="text-n-300">·</span>
                        <span className="text-n-500">{r.masterStock ?? '—'} available</span>
                        {r.brand && <><span className="text-n-300">·</span><span className="text-n-500">{r.brand}</span></>}
                      </div>
                    </div>
                    <span className="rounded-full px-3 py-1 text-[12px] font-bold text-teal-700" style={{ background: '#E1F3F1' }}>Listed on {r.listedCount}/{connectedCount}</span>
                  </div>
                  <div className="mt-3.5 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
                    {shownChannels.map((c) => {
                      const cell = r.cells[c.id];
                      const st = cell ? STATUS[cell.status] ?? STATUS.live : null;
                      return (
                        <div key={c.id} className="rounded-xl border p-3" style={cell ? (cell.loss ? { borderColor: '#F0B3A2', background: '#FDF1EE' } : { borderColor: 'var(--n-200)' }) : { borderStyle: 'dashed', borderColor: 'var(--n-200)', background: 'var(--n-25)' }}>
                          <div className="flex items-center gap-2">
                            <Flag code={c.countryIso} />
                            <span className="flex-1 text-[12.5px] font-bold text-n-900">{c.name}</span>
                            {cell && st && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ color: st.color, background: st.bg }}>{st.label}</span>}
                          </div>
                          {cell ? (
                            <>
                              {/* Quantity leads; price is the supporting figure. */}
                              <div className="mt-2 flex items-baseline gap-2">
                                <span className="mono text-[24px] font-bold leading-none text-n-900">{cell.quantity ?? '—'}</span>
                                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-n-400">in stock</span>
                              </div>
                              <div className="mono mt-1 text-[13px] text-n-600">{money(cell.price, cell.currency)}</div>
                              {cell.profitEur != null && (
                                <div className={`mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-bold ${cell.loss ? 'bg-[#FBE7E1] text-[#C63B1B]' : 'bg-[#E1F3F1] text-[#0E7A73]'}`}>
                                  {cell.loss && <AlertTriangle size={12} />}
                                  <span>{cell.loss ? 'Loss' : 'Profit'}</span>
                                  <span className="mono">{eur(cell.profitEur)}</span>
                                  <span className="opacity-40">·</span>
                                  <span className="mono">{pct(cell.marginPct)} margin</span>
                                </div>
                              )}
                              <div className="mt-2 flex items-center gap-1.5">
                                <button title="Edit price (coming with push sync)" className="grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 hover:bg-n-50"><Edit3 size={13} /></button>
                                <button title="Push / sync (coming)" className="grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 hover:bg-n-50"><RefreshCw size={13} /></button>
                                <button title="Pause (coming)" className="grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 hover:bg-n-50"><Pause size={13} /></button>
                                <div className="flex-1" />
                                {cell.asin && <a href={`https://www.amazon.com/dp/${cell.asin}`} target="_blank" rel="noreferrer" title="View on Amazon" className="grid h-7 w-7 place-items-center text-n-400 hover:text-teal-700"><ExternalLink size={13} /></a>}
                              </div>
                            </>
                          ) : (
                            <div className="pt-1.5 text-[12.5px] font-semibold text-n-300">Not listed on {c.name}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <div className="text-[13px] text-n-500">{visibleRows.length} of {total.toLocaleString()} SKUs shown</div>
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Analytics tab (placeholder metrics we don't yet compute) ----------
function AnalyticsTab({ channels }: { channels: ChannelListingChannel[] }) {
  const kpis = [
    { label: 'Active listings', value: channels.reduce((s, c) => s + c.listingCount, 0).toLocaleString(), sub: `across ${channels.length} channels`, delta: '+3.1%' },
    { label: 'Out of stock', value: '412', sub: 'need attention', delta: '−8%' },
    { label: 'Avg. price spread', value: '£14.20', sub: 'across channels', delta: '+2%' },
    { label: 'Listing errors', value: '23', sub: 'to resolve', delta: '−5' },
  ];
  const coverage = channels.map((c) => ({ name: c.name, countryIso: c.countryIso, count: c.listingCount, color: c.color, pct: Math.min(100, Math.round((c.listingCount / 3412) * 100)) }));
  const health = [
    { label: 'Live', count: 7910, color: '#14A79D', pct: 90 },
    { label: 'Low stock', count: 420, color: '#E8A33D', pct: 5 },
    { label: 'Out of stock', count: 289, color: '#E5714E', pct: 3 },
    { label: 'Paused / error', count: 123, color: '#9AA6A1', pct: 2 },
  ];
  return (
    <div className="max-w-[1320px]">
      <div className="mb-1 flex items-center text-[12.5px] text-n-400">Channel analytics <Sample /> — indicative figures; live metrics wire up in a later phase.</div>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        {kpis.map((k) => (
          <div key={k.label} className="card p-4">
            <div className="flex items-center justify-between"><span className="text-[12px] font-semibold text-n-500">{k.label}</span><span className="text-[12px] font-bold text-teal-700">{k.delta}</span></div>
            <div className="mono mt-2 text-[24px] font-bold text-n-900">{k.value}</div>
            <div className="mt-1 text-[11px] text-n-400">{k.sub}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: '1.35fr 1fr' }}>
        <div className="card p-5">
          <div className="text-[15px] font-bold text-n-900">Catalogue coverage per channel <Sample /></div>
          <div className="mt-5 flex flex-col gap-4">
            {coverage.map((c) => (
              <div key={c.name}>
                <div className="mb-1.5 flex items-center gap-2.5">
                  <Flag code={c.countryIso} />
                  <span className="flex-1 text-[13.5px] font-semibold text-n-900">{c.name}</span>
                  <span className="text-[13px] text-n-500">{c.count} listed</span>
                  <span className="mono w-12 text-right text-[14px] font-bold text-n-900">{c.pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-n-100"><div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: c.color }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <div className="text-[15px] font-bold text-n-900">Listing health <Sample /></div>
          <div className="mt-5 flex h-4 overflow-hidden rounded-full bg-n-100">{health.map((h) => <div key={h.label} style={{ width: `${h.pct}%`, background: h.color }} />)}</div>
          <div className="mt-4 flex flex-col gap-0.5">
            {health.map((h) => (
              <div key={h.label} className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-n-25">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: h.color }} />
                <span className="flex-1 text-[13.5px] text-n-700">{h.label}</span>
                <span className="mono text-[14px] font-bold text-n-900">{h.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Columns3, Download, Filter, Lock, Pencil, Plus, RefreshCw, RotateCcw, Save, Search, Trash2, Unlock, X } from 'lucide-react';
import { toast } from 'sonner';
import { DateRangePicker, ModalShell, Pagination, Select } from '@masquare/ui';
import { countriesApi, profitTiersApi, salesChannelsApi, salesTransactionsApi, settingsApi, type ProfitTier, type SalesTransaction, type TransactionAlert, type TxGroupBy, type TxGroupRow, type TxFilterParams } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../components/ConfirmProvider';
import { usePersistentState } from '../lib/usePersistentState';
import { formatDate, formatMoney } from '../lib/format';
import { SalesTransactionSummaryModal } from '../components/sales/SalesTransactionSummaryModal';
import { ResolveTransactionModal } from '../components/sales/ResolveTransactionModal';
import { SalesExportModal } from '../components/sales/SalesExportModal';
import { SkuCell } from '../components/sales/SkuCell';
import { CountryTag } from '../components/common/Flag';
import { ChannelChip, useChannelChips } from '../components/common/ChannelChip';
import { PageHeader } from '../components/common/PageHeader';

interface TxFilters {
  salesChannelId: string[];
  destinationCountryId: string[];
  status: string[];
  profitTierId: string[];
  shipmentStatus: string[];
  fulfilmentType: string[];
  feeType: string[];
  resolution: string[];
  sku: string;
}
const EMPTY_FILTERS: TxFilters = { salesChannelId: [], destinationCountryId: [], status: [], profitTierId: [], shipmentStatus: [], fulfilmentType: [], feeType: [], resolution: [], sku: '' };

// --- Date period presets (local dates, YYYY-MM-DD) --------------------------
type DatePreset = 'all' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'custom';
const pad2 = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** from/to for a preset — full calendar period; day 0 of next month = last day of this month. */
const datePresetRange = (p: DatePreset): { from: string; to: string } => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const r = (a: Date, b: Date) => ({ from: ymd(a), to: ymd(b) });
  switch (p) {
    case 'thisMonth': return r(new Date(y, m, 1), new Date(y, m + 1, 0));
    case 'lastMonth': return r(new Date(y, m - 1, 1), new Date(y, m, 0));
    case 'thisQuarter': { const q = Math.floor(m / 3) * 3; return r(new Date(y, q, 1), new Date(y, q + 3, 0)); }
    case 'thisYear': return r(new Date(y, 0, 1), new Date(y, 11, 31));
    default: return { from: '', to: '' };
  }
};
const GROUP_BY_OPTS: { value: string; label: string }[] = [
  { value: '', label: 'No grouping' },
  { value: 'channelGroup', label: 'Group: Channel group' },
  { value: 'channel', label: 'Group: Sales channel' },
  { value: 'sku', label: 'Group: SKU' },
  { value: 'brand', label: 'Group: Brand' },
  { value: 'vendor', label: 'Group: Vendor' },
];
const GROUP_LABELS: Record<string, string> = { channelGroup: 'Channel group', channel: 'Sales channel', sku: 'SKU', brand: 'Brand', vendor: 'Vendor' };
const DATE_PRESET_OPTS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'thisMonth', label: 'Current month' },
  { value: 'lastMonth', label: 'Previous month' },
  { value: 'thisQuarter', label: 'Current quarter' },
  { value: 'thisYear', label: 'Current year' },
  { value: 'custom', label: 'Custom range' },
];
const STATUS_OPTS = [{ id: 'draft', name: 'Draft' }, { id: 'submitted', name: 'Submitted' }];
const SHIPMENT_OPTS = [{ id: 'shipped', name: 'Shipped' }, { id: 'not_shipped', name: 'Not shipped' }];
// Defective-order states, for the "Resolution" filter facet.
const RESOLUTION_OPTS = [{ id: 'cancelled', name: 'Cancelled' }, { id: 'returned', name: 'Returned / refunded' }, { id: 'replaced', name: 'Replaced' }];
const FULFILMENT_OPTS = [{ id: 'FBA', name: 'FBA' }, { id: 'FBM', name: 'FBM' }];
const FEE_OPTS = [{ id: 'actual', name: 'Actual (posted)' }, { id: 'estimated', name: 'Estimated (~)' }];

type ColKey =
  | 'date' | 'ref' | 'status' | 'shipped' | 'fulfilment' | 'channel' | 'destination' | 'skus' | 'qty'
  | 'netSales' | 'total' | 'salesFee' | 'estSalesFee' | 'amazonPoints' | 'salesTax' | 'feePct' | 'estShip' | 'actualShip' | 'profit' | 'profitPct'
  | 'vatPct' | 'weight' | 'fx';

type SortKey = 'date' | 'profit' | 'profitPct';

const ALL_COLUMNS: { key: ColKey; label: string; standard: boolean; right?: boolean; sort?: SortKey }[] = [
  { key: 'date', label: 'Date', standard: true, sort: 'date' },
  { key: 'ref', label: 'Transaction ID', standard: true },
  { key: 'status', label: 'Status', standard: true },
  { key: 'shipped', label: 'Shipment', standard: true },
  { key: 'fulfilment', label: 'Fulfilment', standard: true },
  { key: 'channel', label: 'Sales channel', standard: true },
  { key: 'destination', label: 'Destination', standard: true },
  { key: 'skus', label: 'SKUs', standard: true },
  { key: 'qty', label: 'Qty', standard: true, right: true },
  { key: 'netSales', label: 'Net sales', standard: true, right: true },
  { key: 'total', label: 'Total', standard: true, right: true },
  { key: 'salesFee', label: 'Sales fee', standard: true, right: true },
  { key: 'estSalesFee', label: 'Est. sales fee', standard: false, right: true },
  { key: 'amazonPoints', label: 'Amazon points', standard: false, right: true },
  { key: 'salesTax', label: 'Tax charged', standard: false, right: true },
  { key: 'feePct', label: 'Fee %', standard: true, right: true },
  { key: 'estShip', label: 'Est. ship', standard: true, right: true },
  { key: 'actualShip', label: 'Actual ship', standard: true, right: true },
  { key: 'profit', label: 'Profit (€)', standard: true, right: true, sort: 'profit' },
  { key: 'profitPct', label: 'Profit (%)', standard: true, right: true, sort: 'profitPct' },
  { key: 'vatPct', label: 'Dest. VAT %', standard: false, right: true },
  { key: 'weight', label: 'Weight (kg)', standard: false, right: true },
  { key: 'fx', label: 'FX rate', standard: false, right: true },
];
const ALL_KEYS = ALL_COLUMNS.map((c) => c.key);
const DEFAULT_STANDARD = ALL_COLUMNS.filter((c) => c.standard).map((c) => c.key);
const orderedFrom = (set: Set<ColKey>) => ALL_COLUMNS.filter((c) => set.has(c.key)).map((c) => c.key);

const money = (amount: number | null | undefined, currency: string) => formatMoney({ amount: amount ?? null, currency });

/** One collapsible group in the grouped view: a header row (label + count + subtotals) that
 *  expands to lazily fetch and render the group's own transactions with the normal columns. */
function GroupBlock({ group, groupBy, params, colCount, renderRow }: {
  group: TxGroupRow; groupBy: TxGroupBy; params: TxFilterParams; colCount: number; renderRow: (t: SalesTransaction) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['sales-tx-group-members', groupBy, group.key, params],
    queryFn: () => salesTransactionsApi.groupMembers(params, groupBy, group.key),
    enabled: open,
  });
  return (
    <tbody>
      <tr className="cursor-pointer bg-n-25 hover:bg-n-50" onClick={() => setOpen((o) => !o)}>
        <td colSpan={colCount} className="border-b border-n-200 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <ChevronRight size={15} className={`shrink-0 text-n-400 transition-transform ${open ? 'rotate-90' : ''}`} />
            <span className="text-[13px] font-semibold text-n-800">{group.label}</span>
            <span className="mono rounded-pill bg-n-100 px-2 py-0.5 text-[11px] font-semibold text-n-500">{group.orders}</span>
            <div className="mono ml-auto flex items-center gap-5 text-[12px] tabular-nums text-n-600">
              <span title="Units">{group.units} u</span>
              <span title="Revenue ex-VAT">{money(group.revenueEur, 'EUR')}</span>
              <span className={`font-semibold ${group.profitEur < 0 ? 'text-danger' : 'text-n-800'}`} title="Profit">{money(group.profitEur, 'EUR')}</span>
              <span className={`w-14 text-right ${group.marginPct != null && group.marginPct < 0 ? 'text-danger' : 'text-n-500'}`} title="Margin">{group.marginPct == null ? '—' : `${group.marginPct.toFixed(1)}%`}</span>
            </div>
          </div>
        </td>
      </tr>
      {open && q.isLoading && <tr><td colSpan={colCount} className="px-4 py-4 text-center text-[12.5px] text-n-400">Loading transactions…</td></tr>}
      {open && q.data && q.data.length === 0 && <tr><td colSpan={colCount} className="px-4 py-4 text-center text-[12.5px] text-n-400">No transactions.</td></tr>}
      {open && q.data?.map(renderRow)}
    </tbody>
  );
}

export function SalesTransactionsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { activeCompanyId, user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [searchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const [qInput, setQInput] = useState(urlQ);
  const [q, setQ] = useState(urlQ);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Deep link from the global search: /sales-transactions?q=… applies (and re-applies) the search.
  useEffect(() => { if (urlQ) { setQInput(urlQ); setQ(urlQ); setPage(1); } }, [urlQ]);
  const [viewing, setViewing] = useState<SalesTransaction | undefined>(undefined);
  const [resolving, setResolving] = useState<SalesTransaction | undefined>(undefined);
  const [reqOpen, setReqOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // view controls
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Filters persist across reloads (localStorage) until the user clears them.
  const [storedFilters, setFilters] = usePersistentState<TxFilters>('salesTx.filters', EMPTY_FILTERS);
  // Merge with defaults so a filter object persisted before a new facet existed (e.g. resolution)
  // never reads as undefined and crashes the page.
  const filters = useMemo<TxFilters>(() => ({ ...EMPTY_FILTERS, ...storedFilters }), [storedFilters]);
  const [alertsOnly, setAlertsOnly] = usePersistentState('salesTx.alertsOnly', false);
  const [needsReturnOnly, setNeedsReturnOnly] = usePersistentState('salesTx.needsReturn', false);
  const [dateRange, setDateRange] = usePersistentState<{ from: string; to: string }>('salesTx.dateRange', { from: '', to: '' });
  // Which preset the current range corresponds to (else 'custom', or 'all' when empty).
  const activeDatePreset = useMemo<DatePreset>(() => {
    if (!dateRange.from && !dateRange.to) return 'all';
    for (const p of ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear'] as DatePreset[]) {
      const r = datePresetRange(p);
      if (r.from === dateRange.from && r.to === dateRange.to) return p;
    }
    return 'custom';
  }, [dateRange]);
  const [filterOpen, setFilterOpen] = useState(false);
  // Group-by view: '' = the normal transaction list; otherwise an aggregated summary.
  const [groupBy, setGroupBy] = usePersistentState<'' | TxGroupBy>('salesTx.groupBy', '');
  const [eurOnly, setEurOnly] = useState(false);
  const [cols, setCols] = useState<Set<ColKey>>(new Set(DEFAULT_STANDARD));
  const [colsCustomized, setColsCustomized] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  // The Columns menu is portalled to the body (fixed), anchored to its button, so it's never
  // clipped or hidden behind the sidebar when the toolbar wraps to a second row.
  const colsBtnRef = useRef<HTMLButtonElement>(null);
  const colsMenuRef = useRef<HTMLDivElement>(null);
  const [colsPos, setColsPos] = useState<{ top: number; left: number } | null>(null);
  const openCols = () => {
    const r = colsBtnRef.current?.getBoundingClientRect();
    // Left-align the menu to the button so it opens rightward into the main area (never toward
    // the sidebar). Menu is w-60 (240px); clamp so it can't run off the right viewport edge.
    if (r) setColsPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 248) });
    setColsOpen(true);
  };
  useEffect(() => {
    if (!colsOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!colsMenuRef.current?.contains(t) && !colsBtnRef.current?.contains(t)) setColsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setColsOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [colsOpen]);
  const [exportOpen, setExportOpen] = useState(false);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => settingsApi.get() });
  // Admin-defined standard column set (falls back to the built-in default).
  const standardCols = useMemo<ColKey[]>(() => {
    const raw = settings?.salesTxStandardColumns;
    const valid = raw?.filter((k): k is ColKey => (ALL_KEYS as string[]).includes(k)) ?? [];
    return valid.length ? valid : DEFAULT_STANDARD;
  }, [settings]);
  // Apply the standard set as the default until the user customises columns this session.
  useEffect(() => { if (!colsCustomized) setCols(new Set(standardCols)); }, [standardCols, colsCustomized]);

  const toggleCol = (key: ColKey) => { setCols((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; }); setColsCustomized(true); };
  const resetCols = () => { setCols(new Set(standardCols)); setColsCustomized(false); };
  const saveStandard = useMutation({
    mutationFn: () => settingsApi.update({ salesTxStandardColumns: orderedFrom(cols) }),
    onSuccess: () => { toast.success('Standard view saved for everyone'); setColsCustomized(false); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save standard view'),
  });

  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const chipFor = useChannelChips();
  const { data: profitTiers = [] } = useQuery({ queryKey: ['profit-tiers'], queryFn: () => profitTiersApi.list() });
  const { data: countries = [] } = useQuery({ queryKey: ['countries'], queryFn: () => countriesApi.list() });

  const toggleFilter = (key: keyof TxFilters, id: string) => {
    setPage(1);
    setFilters((f) => {
      const arr = (f[key] as string[] | undefined) ?? [];
      return { ...EMPTY_FILTERS, ...f, [key]: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] };
    });
  };
  const clearAllFilters = () => { setFilters(EMPTY_FILTERS); setAlertsOnly(false); setNeedsReturnOnly(false); setDateRange({ from: '', to: '' }); setPage(1); };

  const tierName = (t: ProfitTier) => t.name || `Tier ${t.sortOrder + 1}`;
  const nameOf = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? id;
  const activeChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = [];
    filters.salesChannelId.forEach((id) => chips.push({ label: `Channel: ${nameOf(channels, id)}`, onRemove: () => toggleFilter('salesChannelId', id) }));
    filters.destinationCountryId.forEach((id) => chips.push({ label: `Destination: ${nameOf(countries, id)}`, onRemove: () => toggleFilter('destinationCountryId', id) }));
    filters.status.forEach((id) => chips.push({ label: `Status: ${nameOf(STATUS_OPTS, id)}`, onRemove: () => toggleFilter('status', id) }));
    filters.shipmentStatus.forEach((id) => chips.push({ label: `Shipment: ${nameOf(SHIPMENT_OPTS, id)}`, onRemove: () => toggleFilter('shipmentStatus', id) }));
    filters.fulfilmentType.forEach((id) => chips.push({ label: `Fulfilment: ${id}`, onRemove: () => toggleFilter('fulfilmentType', id) }));
    filters.feeType.forEach((id) => chips.push({ label: `Sales fee: ${nameOf(FEE_OPTS, id)}`, onRemove: () => toggleFilter('feeType', id) }));
    filters.resolution.forEach((id) => chips.push({ label: `Resolution: ${nameOf(RESOLUTION_OPTS, id)}`, onRemove: () => toggleFilter('resolution', id) }));
    filters.profitTierId.forEach((id) => { const t = profitTiers.find((x) => x.id === id); chips.push({ label: `Tier: ${t ? tierName(t) : id}`, onRemove: () => toggleFilter('profitTierId', id) }); });
    if (filters.sku.trim()) chips.push({ label: `SKU: ${filters.sku.trim()}`, onRemove: () => setFilters((f) => ({ ...f, sku: '' })) });
    if (alertsOnly) chips.push({ label: 'Alerts only', onRemove: () => setAlertsOnly(false) });
    if (needsReturnOnly) chips.push({ label: 'Needs return decision', onRemove: () => setNeedsReturnOnly(false) });
    if (dateRange.from || dateRange.to) chips.push({ label: `Date: ${dateRange.from ? formatDate(dateRange.from) : '…'} – ${dateRange.to ? formatDate(dateRange.to) : '…'}`, onRemove: () => setDateRange({ from: '', to: '' }) });
    return chips;
  }, [filters, alertsOnly, dateRange, channels, countries, profitTiers]);
  const filterCount = filters.salesChannelId.length + filters.destinationCountryId.length + filters.status.length + filters.shipmentStatus.length + filters.fulfilmentType.length + filters.feeType.length + filters.profitTierId.length + (filters.sku.trim() ? 1 : 0);
  const { data: unlockReqs = [] } = useQuery({
    queryKey: ['unlock-requests'], queryFn: () => salesTransactionsApi.listUnlockRequests(),
    enabled: isAdmin, refetchInterval: isAdmin ? 15000 : false,
  });
  const decide = useMutation({
    mutationFn: ({ id, grant }: { id: string; grant: boolean }) => salesTransactionsApi.decideUnlock(id, grant),
    onSuccess: (_r, v) => { toast.success(v.grant ? 'Unlock granted' : 'Request denied'); qc.invalidateQueries({ queryKey: ['unlock-requests'] }); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); },
  });

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);

  const params = {
    q: q || undefined,
    companyId: activeCompanyId || undefined,
    salesChannelId: filters.salesChannelId.length ? filters.salesChannelId : undefined,
    destinationCountryId: filters.destinationCountryId.length ? filters.destinationCountryId : undefined,
    status: filters.status.length ? filters.status : undefined,
    profitTierId: filters.profitTierId.length ? filters.profitTierId : undefined,
    shipmentStatus: filters.shipmentStatus.length ? filters.shipmentStatus : undefined,
    fulfilmentType: filters.fulfilmentType.length ? filters.fulfilmentType : undefined,
    resolution: filters.resolution.length ? filters.resolution : undefined,
    feeType: filters.feeType.length ? filters.feeType : undefined,
    sku: filters.sku.trim() || undefined,
    hasAlert: alertsOnly || undefined,
    needsReturn: needsReturnOnly || undefined,
    dateFrom: dateRange.from || undefined,
    dateTo: dateRange.to || undefined,
    sortBy, sortDir, page, pageSize,
  };
  // The filter (everything except page/sort) that a "select all matching" applies to.
  const filterKey = JSON.stringify({ q, c: activeCompanyId, f: filters, a: alertsOnly, nr: needsReturnOnly, d: dateRange });
  // Export uses the same filters, minus pagination — the whole matching set, current sort.
  const { page: _p, pageSize: _ps, ...exportParams } = params;
  const isFiltered = useMemo(
    () => !!q || !!filters.sku.trim() || alertsOnly || !!dateRange.from || !!dateRange.to ||
      Object.values(filters).some((v) => Array.isArray(v) && v.length > 0),
    [q, filters, alertsOnly, dateRange],
  );
  const { data, isLoading } = useQuery({ queryKey: ['sales-transactions', params], queryFn: () => salesTransactionsApi.list(params) });
  // Grouped summary (only when a group-by is active). Same filters as the list, no pagination.
  const groupedQ = useQuery({
    queryKey: ['sales-tx-grouped', groupBy, filterKey],
    queryFn: () => salesTransactionsApi.grouped(exportParams, groupBy as TxGroupBy),
    enabled: !!groupBy,
  });
  const del = useMutation({
    mutationFn: (id: string) => salesTransactionsApi.remove(id),
    onSuccess: () => { toast.success('Transaction removed'); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); },
  });
  const recalc = useMutation({
    mutationFn: (ids?: string[]) => salesTransactionsApi.recalculate(ids),
    onSuccess: (r, ids) => {
      const bits = [];
      if (r.updated > 0) bits.push(`${r.updated} transaction${r.updated === 1 ? '' : 's'} updated`);
      if (r.relinkedItems > 0) bits.push(`${r.relinkedItems} line${r.relinkedItems === 1 ? '' : 's'} re-linked`);
      const scoped = !!ids?.length;
      toast.success(
        bits.length
          ? `Recalculated — ${bits.join(', ')}`
          : scoped ? `${r.checked} selected — already up to date` : 'Everything is already up to date',
      );
      qc.invalidateQueries({ queryKey: ['sales-transactions'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Recalculation failed'),
    onSettled: () => setRecalcScope(null),
  });
  // Track which scope is running so only the clicked button spins.
  const [recalcScope, setRecalcScope] = useState<'all' | 'selected' | null>(null);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const visible = useMemo(() => ALL_COLUMNS.filter((c) => cols.has(c.key)), [cols]);

  // Bulk selection
  const pageIds = items.map((t) => t.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allOnPageSelected) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });
  const clearSel = () => setSelected(new Set());
  // Select every transaction matching the current filters (across all pages), not just this page.
  const selectAllMatching = useMutation({
    mutationFn: () => salesTransactionsApi.allIds(params),
    onSuccess: (r) => setSelected(new Set(r.ids)),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not select all'),
  });
  // The selection is relative to the active filter — reset it when the filter (not page) changes.
  useEffect(() => { setSelected(new Set()); }, [filterKey]);
  const bulk = useMutation({
    mutationFn: (status: 'draft' | 'submitted') => salesTransactionsApi.bulkStatus([...selected], status),
    onSuccess: (res, status) => {
      toast.success(`${res.updated} ${status === 'submitted' ? 'submitted' : 'saved as draft'}${res.skipped ? `, ${res.skipped} skipped (locked)` : ''}`);
      clearSel();
      qc.invalidateQueries({ queryKey: ['sales-transactions'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Bulk action failed'),
  });
  // Use text chips for Status/Shipment while the column set is compact enough to stay on
  // one line; switch to space-saving circles once more columns are shown.
  const chipMode: 'text' | 'circle' = visible.length <= 9 ? 'text' : 'circle';

  const netCell = (t: SalesTransaction) => {
    if (eurOnly) return t.exchangeRate != null ? money(t.totals.netSales * t.exchangeRate, 'EUR') : '—';
    return money(t.totals.netSales, t.currency ?? 'EUR');
  };
  // Server-computed, and only for channels that opt in (Global settings → Sales Channels).
  const totalCell = (t: SalesTransaction) => {
    if (t.transactionTotal == null) {
      return <span className="text-n-400" title="Transaction total is turned off for this sales channel">—</span>;
    }
    if (eurOnly) return t.exchangeRate != null ? money(t.transactionTotal * t.exchangeRate, 'EUR') : '—';
    return money(t.transactionTotal, t.currency ?? 'EUR');
  };
  const feeCell = (t: SalesTransaction) => {
    // Effective fee = actual, or the estimate while Amazon hasn't posted the referral fee.
    const val = eurOnly
      ? (() => { const r = t.feeExchangeRate ?? t.exchangeRate; return r != null ? money(t.effectiveSalesFee * r, 'EUR') : '—'; })()
      : money(t.effectiveSalesFee, t.feeCurrency ?? t.currency ?? 'EUR');
    return t.salesFeeEstimated
      ? <span className="text-amber-700" title="Estimated — Amazon hasn't posted the actual referral fee yet">~{val}</span>
      : val;
  };
  const estFeeCell = (t: SalesTransaction) => {
    if (t.estimatedSalesFee <= 0) return <span className="text-n-400">—</span>;
    if (eurOnly) return t.estimatedSalesFeeEur != null ? money(t.estimatedSalesFeeEur, 'EUR') : '—';
    return money(t.estimatedSalesFee, t.feeCurrency ?? t.currency ?? 'EUR');
  };

  // Profit (%) chip, coloured by the matching profit tier from Global Settings.
  const profitPctChip = (t: SalesTransaction) => {
    if (t.profitPct == null) return '—';
    const tier = profitTiers.find((x: ProfitTier) => t.profitPct! >= x.fromPct && t.profitPct! <= x.toPct);
    const style = tier ? { background: tier.bgColor, color: tier.fontColor } : undefined;
    return (
      <span className={`tag mono ${tier ? '' : 'border border-n-200 bg-n-100 text-n-600'}`} style={style} title={tier?.name ?? undefined}>
        {t.profitPct.toFixed(2)}%
      </span>
    );
  };

  const renderCell = (key: ColKey, t: SalesTransaction) => {
    switch (key) {
      case 'date': return formatDate(t.date);
      case 'ref': return <span className="font-medium text-n-800">{t.transactionRef}</span>;
      case 'status': return (
        <span className="inline-flex items-center gap-1.5">
          {chipMode === 'text'
            ? (t.status === 'submitted'
                ? <span className="tag inline-flex items-center gap-1 whitespace-nowrap border border-teal-100 bg-teal-50 text-teal-700"><Lock size={11} /> Submitted</span>
                : <span className="tag whitespace-nowrap border border-orange-100 bg-orange-50 text-orange-700">Draft</span>)
            : <span className={`inline-block h-2.5 w-2.5 rounded-full ${t.status === 'submitted' ? 'bg-teal-500' : 'bg-orange-400'}`} title={t.status === 'submitted' ? 'Submitted' : 'Draft'} />}
          {t.unlockedForEdit && <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" title="Unlocked for edit" />}
          {t.hasPendingUnlock && <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-500" title="Unlock request pending" />}
        </span>
      );
      // Partial = some shipments out, more to come. Distinct from both shipped and untouched.
      case 'shipped': {
        const partial = t.fulfilmentStatus === 'partial';
        const label = t.shipped ? 'Shipped' : partial ? `Partial (${t.outboundShipmentCount})` : 'Not shipped';
        const title = partial
          ? `${t.outboundShipmentCount} shipment${t.outboundShipmentCount === 1 ? '' : 's'} recorded — not yet fully shipped`
          : label;
        return chipMode === 'text'
          ? (
            <span
              className={`tag whitespace-nowrap border ${t.shipped ? 'border-teal-100 bg-teal-50 text-teal-700' : partial ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-n-200 bg-n-100 text-n-500'}`}
              title={title}
            >
              {label}
            </span>
          )
          : <span className={`inline-block h-2.5 w-2.5 rounded-full ${t.shipped ? 'bg-teal-500' : partial ? 'bg-amber-400' : 'bg-n-300'}`} title={title} />;
      }
      case 'fulfilment': return t.fulfilmentType
        ? <span className={`tag whitespace-nowrap border ${t.fulfilmentType === 'FBA' ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-sky-100 bg-sky-50 text-sky-700'}`} title={t.fulfilmentType === 'FBA' ? 'Fulfilled by Amazon' : 'Fulfilled by merchant'}>{t.fulfilmentType}</span>
        : <span className="text-n-400">—</span>;
      case 'channel': return t.salesChannel ? <ChannelChip name={t.salesChannel.name} {...chipFor(t.salesChannelId)} /> : '—';
      case 'destination': return t.destinationCountry ? <CountryTag code={t.destinationCountry.isoCode} name={t.destinationCountry.name} /> : '—';
      case 'skus': return <SkuCell skus={t.items.map((it) => it.sku)} />;
      case 'qty': return t.totals.quantity;
      case 'netSales': return netCell(t);
      case 'total': return t.transactionTotal != null
        ? <span className="font-semibold text-n-800">{totalCell(t)}</span>
        : totalCell(t);
      case 'salesFee': return feeCell(t);
      case 'estSalesFee': return estFeeCell(t);
      case 'amazonPoints': return t.amazonPoints > 0
        ? (eurOnly ? (t.amazonPointsEur != null ? money(t.amazonPointsEur, 'EUR') : '—') : money(t.amazonPoints, t.feeCurrency ?? t.currency ?? 'EUR'))
        : <span className="text-n-400">—</span>;
      case 'salesTax': return t.salesTax > 0
        ? (eurOnly ? (t.salesTaxEur != null ? money(t.salesTaxEur, 'EUR') : '—') : money(t.salesTax, t.currency ?? 'EUR'))
        : <span className="text-n-400">—</span>;
      case 'feePct': return t.salesFeePct == null ? '—'
        : t.salesFeeEstimated
          ? <span className="text-amber-700" title="Based on the estimated sales fee — Amazon hasn't posted the actual referral fee yet">~{t.salesFeePct}%</span>
          : `${t.salesFeePct}%`;
      case 'estShip': return t.estimatedShippingCost != null
        ? <span title={t.fulfilmentType === 'FBA' ? 'FBA: avg inbound-to-Amazon cost + Amazon FBA fee' : undefined}>{money(t.estimatedShippingCost, 'EUR')}</span>
        : '—';
      case 'actualShip': return t.actualShippingCost != null ? money(t.actualShippingCost, 'EUR') : '—';
      case 'profit': return t.profit != null ? <span className="font-medium" style={{ color: t.profit >= 0 ? '#14A79D' : 'var(--danger)' }}>{money(t.profit, 'EUR')}</span> : '—';
      case 'profitPct': return profitPctChip(t);
      case 'vatPct': return t.destinationCountryVatPct != null ? `${t.destinationCountryVatPct}%` : '—';
      case 'weight': return t.overallPackageWeight != null ? t.overallPackageWeight : '—';
      case 'fx': return t.exchangeRate != null ? t.exchangeRate : '—';
    }
  };

  const cellClass = (key: ColKey, right?: boolean) => {
    // Numeric columns render in the primary font (`.mono` = tabular figures);
    // the transaction id is a machine code and uses `.code` (the mono font).
    const mono = ['date', 'qty', 'netSales', 'total', 'salesFee', 'estSalesFee', 'amazonPoints', 'salesTax', 'feePct', 'estShip', 'actualShip', 'profit', 'profitPct', 'vatPct', 'weight', 'fx'].includes(key);
    const code = key === 'ref';
    // Single-line cells keep every data row the same height.
    return `border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700 whitespace-nowrap ${mono ? 'mono' : ''} ${code ? 'code' : ''} ${right ? 'text-right' : ''}`;
  };

  // One transaction row — shared by the flat list and the grouped view's expanded members.
  const txRow = (t: SalesTransaction): ReactNode => (
    <tr
      key={t.id}
      className={`cursor-pointer ${t.resolution !== 'none' ? 'bg-violet-50 hover:bg-violet-100/70' : t.hasAlerts ? 'bg-orange-50 hover:bg-orange-100/70' : selected.has(t.id) ? 'bg-teal-50/60 hover:bg-teal-50' : 'hover:bg-teal-50'}`}
      onClick={() => setViewing(t)}
    >
      <td className="border-b border-n-100 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} />
          {t.hasAlerts && <AlertBadge alerts={t.alerts} />}
          {t.resolution !== 'none' && (() => {
            const label = t.resolution === 'cancelled' ? 'Cxl' : t.resolution === 'replaced' ? 'Rep' : 'Ref';
            const needsAction = t.resolution !== 'cancelled' && !t.returnHandled;
            return (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${t.resolution === 'cancelled' ? 'bg-n-100 text-n-500' : needsAction ? 'bg-warning-bg text-warning' : 'bg-teal-50 text-teal-700'}`}
                title={t.resolution === 'cancelled' ? 'Cancelled order' : `${t.resolution === 'replaced' ? 'Replaced' : 'Returned / refunded'}${needsAction ? ' — return decision needed' : ' — resolved'}`}
              >
                {label}{needsAction ? '!' : ''}
              </span>
            );
          })()}
        </div>
      </td>
      {visible.map((c) => <td key={c.key} className={cellClass(c.key, c.right)}>{renderCell(c.key, t)}</td>)}
      <td className="border-b border-n-100 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-1">
          <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800" title="Edit transaction" onClick={() => navigate(`/sales-transactions/${t.id}/edit`)}><Pencil size={15} /></button>
          <button
            className={`relative grid h-8 w-8 place-items-center rounded-md hover:bg-n-100 hover:text-n-800 ${t.resolution !== 'none' ? 'text-orange-600' : 'text-n-500'}`}
            title={t.resolution === 'none' ? 'Resolve / return' : 'Edit resolution'}
            onClick={() => setResolving(t)}
          >
            <RotateCcw size={15} />
            {t.resolution !== 'none' && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-orange-500" />}
          </button>
          <button className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger" title="Remove" onClick={() => window.confirm(`Remove transaction ${t.transactionRef}?`) && del.mutate(t.id)}><Trash2 size={15} /></button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="w-full">
      <PageHeader
        module="Sales"
        title="Sales transactions"
        info="Register and review sales across all channels. Revenue/profit analytics build on this data."
        actions={
          <button
            className={`hbtn ${alertsOnly ? '!border-orange-300 !bg-orange-50 !text-orange-700' : ''}`}
            title="Show only orders with an alert (e.g. a SKU not in the product catalogue)"
            onClick={() => { setAlertsOnly((v) => !v); setPage(1); }}
          >
            <AlertTriangle size={15} className={alertsOnly ? '' : 'opacity-60'} /> Alerts
          </button>
        }
        overflow={[
          { label: needsReturnOnly ? 'Returns filter · on' : 'Returns filter', onClick: () => { setNeedsReturnOnly((v) => !v); setPage(1); } },
          { label: recalc.isPending && recalcScope === 'all' ? 'Recalculating…' : 'Recalculate all', disabled: recalc.isPending, onClick: () => { setRecalcScope('all'); recalc.mutate(undefined); } },
          ...(isAdmin ? [{ label: `Unlock requests${unlockReqs.length ? ` (${unlockReqs.length})` : ''}`, onClick: () => setReqOpen(true) }] : []),
          { label: 'Export', disabled: total === 0, onClick: () => setExportOpen(true) },
        ]}
        primary={<button className="hbtn-primary" onClick={() => navigate('/sales-transactions/new')}><Plus size={16} /> Register transaction</button>}
        toolbar={
          <>
            <div className="flex h-8 flex-[0_1_300px] items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-2.5 focus-within:border-teal-400">
              <Search size={15} className="text-n-400" />
              <input className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none" placeholder="Search transaction ID or SKU…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
            </div>
            <div className="relative">
              <button className="hbtn" onClick={() => setFilterOpen((v) => !v)}>
                <Filter size={15} className="opacity-60" /> Filters
                {filterCount > 0 && <span className="mono rounded-pill bg-teal-100 px-1.5 text-[11px] text-teal-700">{filterCount}</span>}
              </button>
              {filterOpen && (
                <TxFilterPanel
                  onClose={() => setFilterOpen(false)}
                  channels={channels}
                  profitTiers={profitTiers}
                  countries={countries}
                  filters={filters}
                  onToggle={toggleFilter}
                  onSku={(v) => { setFilters((f) => ({ ...f, sku: v })); setPage(1); }}
                  tierName={tierName}
                />
              )}
            </div>
            <div className="w-40"><Select dense value={activeDatePreset} onChange={(v) => { const p = v as DatePreset; if (p === 'custom') return; setDateRange(datePresetRange(p)); setPage(1); }} options={DATE_PRESET_OPTS} /></div>
            <div className="w-[248px]"><DateRangePicker value={dateRange} onChange={(r) => { setDateRange(r); setPage(1); }} placeholder="Custom range" clearable className="h-8" /></div>
            <div className="w-48"><Select dense value={groupBy} onChange={(v) => setGroupBy(v as '' | TxGroupBy)} options={GROUP_BY_OPTS} /></div>
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-3 text-[13px] font-medium text-n-700">
              <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={eurOnly} onChange={(e) => setEurOnly(e.target.checked)} />
              EUR
            </label>
            <button ref={colsBtnRef} className="hbtn ml-auto" onClick={() => (colsOpen ? setColsOpen(false) : openCols())}>
              <Columns3 size={15} className="opacity-60" /> Columns
            </button>
            {colsOpen && colsPos && createPortal(
              <div ref={colsMenuRef} className="fixed z-[90] max-h-[26rem] w-60 overflow-auto rounded-lg border border-n-200 bg-n-0 p-2 shadow-lg" style={{ top: colsPos.top, left: colsPos.left }}>
                {ALL_COLUMNS.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-n-50">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={cols.has(c.key)} onChange={() => toggleCol(c.key)} />
                    <span className="text-[13px] text-n-700">{c.label}</span>
                  </label>
                ))}
                <button className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-teal-700 hover:bg-teal-50" onClick={resetCols}>Reset to standard view</button>
                {isAdmin && (
                  <button className="mt-0.5 flex w-full items-center gap-1.5 rounded-md border-t border-n-100 px-2 py-1.5 text-left text-[12px] font-semibold text-n-700 hover:bg-n-50 disabled:opacity-50" disabled={saveStandard.isPending} onClick={() => saveStandard.mutate()}>
                    <Save size={13} className="opacity-70" /> {saveStandard.isPending ? 'Saving…' : 'Save current as standard view'}
                  </button>
                )}
              </div>,
              document.body,
            )}
          </>
        }
      />

      {activeChips.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {activeChips.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-pill border border-teal-100 bg-teal-50 px-3 py-1 text-[12.5px] font-medium text-teal-800">
              {c.label}
              <button onClick={c.onRemove} className="grid h-4 w-4 place-items-center rounded-full text-teal-600 hover:bg-teal-100"><X size={12} /></button>
            </span>
          ))}
          <button className="text-[12.5px] font-medium text-orange-600 hover:underline" onClick={clearAllFilters}>Clear all</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2.5 rounded-lg border border-teal-200 bg-teal-50/70 px-3.5 py-2.5">
          <span className="text-[13px] font-semibold text-teal-800">{selected.size} selected</span>
          {total > selected.size && (
            <button className="text-[12.5px] font-medium text-teal-700 hover:underline disabled:opacity-50" disabled={selectAllMatching.isPending} onClick={() => selectAllMatching.mutate()}>
              {selectAllMatching.isPending ? 'Selecting…' : `Select all ${total} matching`}
            </button>
          )}
          {selected.size >= total && total > items.length && <span className="text-[12px] text-teal-600">· all matching selected</span>}
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-teal-300 bg-n-0 px-3 text-[13px] font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-50"
            title="Re-check only the selected transactions against current settings — faster than sweeping every order"
            disabled={recalc.isPending}
            onClick={() => { setRecalcScope('selected'); recalc.mutate([...selected]); }}
          >
            <RefreshCw size={14} className={`opacity-70 ${recalc.isPending && recalcScope === 'selected' ? 'animate-spin' : ''}`} />
            {recalc.isPending && recalcScope === 'selected' ? 'Recalculating…' : 'Recalculate'}
          </button>
          <button className="btn btn-ghost h-8" disabled={bulk.isPending} onClick={() => bulk.mutate('draft')}>Save as draft</button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50" disabled={bulk.isPending} onClick={async () => { if (await confirm({ title: `Submit ${selected.size} transaction${selected.size === 1 ? '' : 's'}?`, message: 'They will be finalised. If stock deduction is on, their items come off stock now.', confirmLabel: 'Submit' })) bulk.mutate('submitted'); }}>Submit</button>
          <button className="ml-auto text-[12.5px] font-medium text-n-500 hover:text-n-800" onClick={clearSel}>Clear</button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <th className="border-b border-n-200 bg-n-25 px-3 py-3 text-left">
                  {!groupBy && <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={allOnPageSelected} onChange={toggleAll} title="Select all on this page" />}
                </th>
                {visible.map((c) => (
                  <th key={c.key} className={`border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${c.right ? 'text-right' : 'text-left'}`}>
                    {c.sort ? (
                      <button
                        className={`inline-flex items-center gap-1 uppercase hover:text-n-800 ${sortBy === c.sort ? 'text-n-800' : 'text-n-500'}`}
                        onClick={() => {
                          if (sortBy === c.sort) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
                          else { setSortBy(c.sort!); setSortDir('desc'); }
                          setPage(1);
                        }}
                      >
                        {c.label} {sortBy === c.sort && (sortDir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                      </button>
                    ) : c.label}
                  </th>
                ))}
                <th className="border-b border-n-200 bg-n-25" />
              </tr>
            </thead>
            {groupBy ? (
              groupedQ.isLoading ? (
                <tbody><tr><td colSpan={visible.length + 2} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr></tbody>
              ) : !groupedQ.data || groupedQ.data.groups.length === 0 ? (
                <tbody><tr><td colSpan={visible.length + 2} className="px-4 py-12 text-center text-[13px] text-n-500">No transactions match.</td></tr></tbody>
              ) : (
                <>
                  {groupedQ.data.groups.map((g) => (
                    <GroupBlock key={g.key} group={g} groupBy={groupBy} params={exportParams} colCount={visible.length + 2} renderRow={txRow} />
                  ))}
                  <tbody>
                    <tr className="bg-n-25 font-semibold">
                      <td colSpan={visible.length + 2} className="border-t-2 border-n-200 px-3 py-3">
                        <div className="flex items-center gap-2.5 text-[13px] text-n-800">
                          <span>Total · {groupedQ.data.totals.orders} order{groupedQ.data.totals.orders === 1 ? '' : 's'}</span>
                          <div className="mono ml-auto flex items-center gap-5 text-[12.5px] tabular-nums">
                            <span>{groupedQ.data.totals.units} u</span>
                            <span>{money(groupedQ.data.totals.revenueEur, 'EUR')}</span>
                            <span className={groupedQ.data.totals.profitEur < 0 ? 'text-danger' : ''}>{money(groupedQ.data.totals.profitEur, 'EUR')}</span>
                            <span className="w-14 text-right text-n-500">{groupedQ.data.totals.revenueEur > 0 ? `${((groupedQ.data.totals.profitEur / groupedQ.data.totals.revenueEur) * 100).toFixed(1)}%` : '—'}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </>
              )
            ) : (
              <tbody>
                {isLoading && <tr><td colSpan={visible.length + 2} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
                {!isLoading && items.length === 0 && <tr><td colSpan={visible.length + 2} className="px-4 py-12 text-center text-[13px] text-n-500">No transactions match. Register your first sale.</td></tr>}
                {items.map(txRow)}
              </tbody>
            )}
          </table>
        </div>
      </div>

      {!groupBy && <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />}

      {viewing !== undefined && resolving === undefined && (
        <SalesTransactionSummaryModal
          transaction={viewing}
          onClose={() => setViewing(undefined)}
          onEdit={() => { const id = viewing!.id; setViewing(undefined); navigate(`/sales-transactions/${id}/edit`); }}
          onResolve={() => { setResolving(viewing); setViewing(undefined); }}
        />
      )}
      {resolving !== undefined && (
        <ResolveTransactionModal
          transaction={resolving}
          onClose={() => setResolving(undefined)}
          onSaved={() => { setResolving(undefined); qc.invalidateQueries({ queryKey: ['sales-transactions'] }); }}
        />
      )}
      {exportOpen && (
        <SalesExportModal params={exportParams} total={total} filtered={isFiltered} onClose={() => setExportOpen(false)} />
      )}
      {reqOpen && (
        <ModalShell open title="Unlock Requests" primaryLabel="Close" onPrimary={() => setReqOpen(false)} onClose={() => setReqOpen(false)}>
          {unlockReqs.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-n-500">No pending unlock requests.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {unlockReqs.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg border border-n-200 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="code text-[13px] font-medium text-n-800">{r.transactionRef}</div>
                    <div className="text-[12px] text-n-500">Requested by {r.requestedBy}</div>
                  </div>
                  <button className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12.5px] font-semibold text-white hover:bg-primary-hover" onClick={() => decide.mutate({ id: r.id, grant: true })}>Grant</button>
                  <button className="inline-flex h-8 items-center rounded-md border border-n-200 px-3 text-[12.5px] font-semibold text-n-700 hover:bg-n-50" onClick={() => decide.mutate({ id: r.id, grant: false })}>Deny</button>
                </div>
              ))}
            </div>
          )}
        </ModalShell>
      )}
    </div>
  );
}

/** Alert indicator: a warning icon that opens a styled notification popover on hover.
 *  Portaled to <body> with fixed positioning so it escapes the table's overflow clip. */
function AlertBadge({ alerts }: { alerts: TransactionAlert[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pos != null;

  const toggle = () => {
    if (open) { setPos(null); return; }
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 300) });
  };

  // Stay open until the user closes it: dismiss on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !ref.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <span
      ref={ref}
      className={`grid h-5 w-5 cursor-pointer place-items-center rounded ${open ? 'bg-orange-100 text-orange-600' : 'text-orange-500 hover:text-orange-600'}`}
      title="Show order alerts"
      onClick={(e) => { e.stopPropagation(); toggle(); }}
    >
      <AlertTriangle size={15} />
      {open && createPortal(
        <div
          ref={popRef}
          className="fixed z-[90] w-80 rounded-lg border border-orange-200 bg-n-0 p-3 shadow-lg"
          style={{ top: pos!.top, left: pos!.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-orange-600">
            <AlertTriangle size={12} /> {alerts.length === 1 ? 'Order alert' : `${alerts.length} order alerts`}
          </div>
          <ul className="flex flex-col gap-2">
            {alerts.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px] leading-snug text-n-700">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${a.severity === 'error' ? 'bg-danger' : 'bg-warning'}`} />
                <div className="min-w-0">
                  <div>{a.message}{a.items?.length ? ':' : ''}</div>
                  {a.items?.length ? (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {a.items.map((it, j) => (
                        <li key={j} className="mono rounded bg-n-50 px-1.5 py-0.5 text-[11.5px] text-n-800">{it}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </span>
  );
}

/** Combined filter dropdown for the sales-transactions list (mirrors the Products filter panel). */
function TxFilterPanel({
  onClose, channels, profitTiers, countries, filters, onToggle, onSku, tierName,
}: {
  onClose: () => void;
  channels: { id: string; name: string }[];
  profitTiers: ProfitTier[];
  countries: { id: string; name: string; isoCode: string }[];
  filters: TxFilters;
  onToggle: (key: keyof TxFilters, id: string) => void;
  onSku: (v: string) => void;
  tierName: (t: ProfitTier) => string;
}) {
  const [countryQ, setCountryQ] = useState('');
  const shownCountries = useMemo(() => {
    const q = countryQ.trim().toLowerCase();
    const list = q ? countries.filter((c) => c.name.toLowerCase().includes(q) || c.isoCode.toLowerCase().includes(q)) : countries;
    return list.slice(0, 60);
  }, [countries, countryQ]);

  const Check = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-n-50">
      <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={checked} onChange={onChange} />
      <span className="truncate text-[13px] text-n-700">{label}</span>
    </label>
  );
  const GroupTitle = ({ children }: { children: ReactNode }) => (
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">{children}</div>
  );

  return (
    <div
      className="absolute left-0 top-9 z-50 grid w-[620px] max-w-[calc(100vw-2rem)] grid-cols-2 gap-x-5 gap-y-4 rounded-lg border border-n-200 bg-n-0 p-4 shadow-lg max-[760px]:w-[92vw] max-[760px]:grid-cols-1"
      onMouseLeave={onClose}
    >
      <div>
        <GroupTitle>Sales channel</GroupTitle>
        <div className="max-h-40 overflow-auto pr-1">
          {channels.length === 0 && <p className="text-[12px] text-n-400">None</p>}
          {channels.map((c) => <Check key={c.id} checked={filters.salesChannelId.includes(c.id)} onChange={() => onToggle('salesChannelId', c.id)} label={c.name} />)}
        </div>
      </div>

      <div>
        <GroupTitle>Destination country</GroupTitle>
        <input className="input mb-1.5 h-8" placeholder="Search countries…" value={countryQ} onChange={(e) => setCountryQ(e.target.value)} />
        <div className="max-h-32 overflow-auto pr-1">
          {shownCountries.map((c) => <Check key={c.id} checked={filters.destinationCountryId.includes(c.id)} onChange={() => onToggle('destinationCountryId', c.id)} label={c.name} />)}
          {shownCountries.length === 0 && <p className="text-[12px] text-n-400">No matches</p>}
        </div>
      </div>

      <div>
        <GroupTitle>Profit tier</GroupTitle>
        <div className="max-h-40 overflow-auto pr-1">
          {profitTiers.length === 0 && <p className="text-[12px] text-n-400">No tiers defined</p>}
          {profitTiers.map((t) => <Check key={t.id} checked={filters.profitTierId.includes(t.id)} onChange={() => onToggle('profitTierId', t.id)} label={`${tierName(t)} (${t.fromPct}–${t.toPct}%)`} />)}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <GroupTitle>Status</GroupTitle>
          {STATUS_OPTS.map((o) => <Check key={o.id} checked={filters.status.includes(o.id)} onChange={() => onToggle('status', o.id)} label={o.name} />)}
        </div>
        <div>
          <GroupTitle>Shipment status</GroupTitle>
          {SHIPMENT_OPTS.map((o) => <Check key={o.id} checked={filters.shipmentStatus.includes(o.id)} onChange={() => onToggle('shipmentStatus', o.id)} label={o.name} />)}
        </div>
        <div>
          <GroupTitle>Fulfilment type</GroupTitle>
          {FULFILMENT_OPTS.map((o) => <Check key={o.id} checked={filters.fulfilmentType.includes(o.id)} onChange={() => onToggle('fulfilmentType', o.id)} label={o.name} />)}
        </div>
        <div>
          <GroupTitle>Sales fee</GroupTitle>
          {FEE_OPTS.map((o) => <Check key={o.id} checked={filters.feeType.includes(o.id)} onChange={() => onToggle('feeType', o.id)} label={o.name} />)}
        </div>
        <div>
          <GroupTitle>Resolution (defective orders)</GroupTitle>
          {RESOLUTION_OPTS.map((o) => <Check key={o.id} checked={filters.resolution.includes(o.id)} onChange={() => onToggle('resolution', o.id)} label={o.name} />)}
        </div>
      </div>

      <div className="col-span-2 max-[760px]:col-span-1">
        <GroupTitle>SKU</GroupTitle>
        <input className="input code h-8" placeholder="Filter by SKU (contains)…" value={filters.sku} onChange={(e) => onSku(e.target.value)} />
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, ClipboardCopy, Info, Minus, Search, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Pagination, Select } from '@masquare/ui';
import { availabilityApi, brandsApi, channelListingsApi, productTypesApi, vendorsApi, type AvailabilityRow, type ChannelPushResult } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { usePersistentState } from '../lib/usePersistentState';
import { CHANNEL_GROUPS, channelGroupOf, channelPlatform, type ChannelPlatform } from '../lib/channelGroups';

// The three ways a quantity can move: a person, a vendor file, or a sale. There is no Return —
// a return never changes availability, and a cancellation before shipment is the sale reversing
// itself, so it reads as Sale. Legacy rows may still carry the old value until they are cleared.
const SOURCE_LABEL: Record<string, string> = { manual: 'Manual', vendor_import: 'Vendor file', sale: 'Sale' };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export function AvailabilityPage() {
  const qc = useQueryClient();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [brandId, setBrandId] = usePersistentState('availability.brand', '');
  const [vendorId, setVendorId] = usePersistentState('availability.vendor', '');
  const [productTypeId, setProductTypeId] = usePersistentState('availability.type', '');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  // Per-row edit buffer (productId -> typed string), so several rows can be edited before saving.
  const [edits, setEdits] = useState<Record<string, string>>({});
  // Selected products for a channel quantity push.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pushOpen, setPushOpen] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);
  useEffect(() => { setPage(1); }, [brandId, vendorId, productTypeId]);

  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const { data: types = [] } = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });

  const params = { q: q || undefined, brandId: brandId || undefined, vendorId: vendorId || undefined, productTypeId: productTypeId || undefined, page, pageSize };
  const { data, isLoading } = useQuery({ queryKey: ['availability', params], queryFn: () => availabilityApi.list(params) });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const save = useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) => availabilityApi.setQuantity(productId, quantity),
    onSuccess: (_r, v) => {
      setEdits((e) => { const n = { ...e }; delete n[v.productId]; return n; });
      qc.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save quantity'),
  });

  const hasFilters = !!(q || brandId || vendorId || productTypeId);
  const resetFilters = () => { setQInput(''); setQ(''); setBrandId(''); setVendorId(''); setProductTypeId(''); };

  const edited = (r: AvailabilityRow) => edits[r.productId] !== undefined && edits[r.productId] !== String(r.quantity ?? '');
  const commit = (r: AvailabilityRow) => {
    const raw = edits[r.productId];
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 0) { toast.error('Enter a whole number ≥ 0'); return; }
    save.mutate({ productId: r.productId, quantity: n });
  };

  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';
  const opts = (rows: { id: string; name: string }[], all: string) => [{ value: '', label: all }, ...rows.map((r) => ({ value: r.id, label: r.name }))];

  const pageIds = items.map((r) => r.productId);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAllPage = () => setSelected((s) => { const n = new Set(s); if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });

  // "Select all N" across pages — fetch every matching product id for the current filter.
  const [selectingAll, setSelectingAll] = useState(false);
  const allMatchingSelected = total > 0 && selected.size >= total;
  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const ids = await availabilityApi.ids({ q: q || undefined, brandId: brandId || undefined, vendorId: vendorId || undefined, productTypeId: productTypeId || undefined });
      setSelected(new Set(ids));
    } catch { toast.error('Could not select all products'); } finally { setSelectingAll(false); }
  };

  return (
    <div className="w-full">
      <PageHeader
        module="Catalogue & Inventory"
        title="Availability"
        info="The sellable quantity broadcast to your sales channels — the single source of truth for how much of each SKU is available. Separate from warehouse stock; set it from your vendors' availability."
        actions={selected.size > 0 ? (
          <button onClick={() => setSelected(new Set())} className="hbtn">Clear ({selected.size})</button>
        ) : undefined}
        primary={
          <button disabled={selected.size === 0} onClick={() => setPushOpen(true)}
            className="hbtn-primary"
            title={selected.size === 0 ? 'Select products to push their availability to the channels' : 'Push the selected products’ availability to all their channel listings'}>
            <Send size={15} /> Push to channels{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        }
        toolbar={
          <>
            <div className="flex h-8 min-w-[220px] max-w-[300px] flex-1 items-center gap-2 rounded-lg border border-n-200 bg-n-0 px-3">
              <Search size={15} className="text-n-400" />
              <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search SKU or title…" className="flex-1 bg-transparent text-[13px] text-n-900 outline-none placeholder:text-n-400" />
            </div>
            <Select dense className="w-40" value={brandId} onChange={setBrandId} options={opts(brands, 'All brands')} />
            <Select dense className="w-40" value={vendorId} onChange={setVendorId} options={opts(vendors, 'All vendors')} />
            <Select dense className="w-40" value={productTypeId} onChange={setProductTypeId} options={opts(types, 'All types')} />
            
            {hasFilters && <button onClick={resetFilters} className="text-[12.5px] font-semibold text-n-500 hover:text-n-700">Reset</button>}
          </>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-n-100 px-4 py-2.5 text-[12px] text-n-500">
          <span>{total} product{total === 1 ? '' : 's'}</span>
          {selected.size > 0 && <span className="text-n-400">·</span>}
          {selected.size > 0 && <span className="font-medium text-n-600">{selected.size} selected</span>}
          {/* Select-all-across-pages: shown once everything on this page is ticked and more pages exist. */}
          {allOnPage && total > pageIds.length && !allMatchingSelected && (
            <button onClick={selectAllMatching} disabled={selectingAll} className="font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-50">
              {selectingAll ? 'Selecting…' : `Select all ${total}`}
            </button>
          )}
          {allMatchingSelected && total > pageIds.length && (
            <span className="text-n-500">All {total} selected · <button onClick={() => setSelected(new Set())} className="font-semibold text-teal-600 hover:text-teal-700">Clear</button></span>
          )}
        </div>
        <div className="overflow-x-auto max-[767px]:hidden">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-[36px] text-center`}><input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={allOnPage} onChange={toggleAllPage} title="Select all on this page" /></th>
                <th className={`${th} text-left`}>SKU</th>
                <th className={`${th} text-left`}>Product</th>
                <th className={`${th} text-left`}>Brand</th>
                <th className={`${th} text-left`}>Vendor</th>
                <th className={`${th} text-left`}>Type</th>
                <th className={`${th} text-right`}>Available</th>
                <th className={`${th} text-left`}>Source</th>
                <th className={`${th} text-left`}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className={td} colSpan={9}>Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td className={`${td} py-10 text-center text-n-400`} colSpan={9}>{hasFilters ? 'No products match these filters.' : 'No products yet.'}</td></tr>}
              {items.map((r) => {
                const val = edits[r.productId] ?? String(r.quantity ?? '');
                return (
                  <tr key={r.productId} className={`group hover:bg-n-25 ${selected.has(r.productId) ? 'bg-teal-50/40' : ''}`}>
                    <td className={`${td} text-center`}><input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={selected.has(r.productId)} onChange={() => toggleOne(r.productId)} /></td>
                    <td className={`${td} code whitespace-nowrap text-n-800`}>{r.mainSku}</td>
                    <td className={`${td} max-w-[280px] truncate`} title={r.title}>{r.title}</td>
                    <td className={td}>{r.brand ?? <span className="text-n-300">—</span>}</td>
                    <td className={td}>{r.vendor ?? <span className="text-n-300">—</span>}</td>
                    <td className={td}>{r.productType ?? <span className="text-n-300">—</span>}</td>
                    <td className={`${td} text-right`}>
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          className={`mono w-20 rounded-md border px-2 py-1 text-right text-[13px] outline-none focus:border-teal-400 ${edited(r) ? 'border-teal-300 bg-teal-50/40' : 'border-n-200 bg-n-0'} ${r.quantity == null && !edited(r) ? 'text-n-300' : 'text-n-900'}`}
                          inputMode="numeric"
                          placeholder="—"
                          value={val}
                          onChange={(e) => setEdits((s) => ({ ...s, [r.productId]: e.target.value.replace(/[^\d]/g, '') }))}
                          onKeyDown={(e) => { if (e.key === 'Enter' && edited(r)) commit(r); if (e.key === 'Escape') setEdits((s) => { const n = { ...s }; delete n[r.productId]; return n; }); }}
                        />
                        {edited(r) ? (
                          <div className="flex gap-0.5">
                            <button title="Save (Enter)" disabled={save.isPending} onClick={() => commit(r)} className="grid h-7 w-7 place-items-center rounded-md border border-teal-300 bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50"><Check size={14} /></button>
                            <button title="Cancel (Esc)" onClick={() => setEdits((s) => { const n = { ...s }; delete n[r.productId]; return n; })} className="grid h-7 w-7 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 hover:text-n-700"><X size={14} /></button>
                          </div>
                        ) : <span className="w-[58px]" />}
                      </div>
                    </td>
                    <td className={td}>{r.lastSource ? <span className="tag border border-n-200 bg-n-50 text-n-500">{SOURCE_LABEL[r.lastSource] ?? r.lastSource}</span> : <span className="text-n-300">—</span>}</td>
                    <td className={`${td} whitespace-nowrap text-n-500`}>{fmtDate(r.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile: card list with the same inline availability editor (guide Principle 3). */}
        <div className="hidden flex-col gap-2 p-3 max-[767px]:flex">
          {isLoading && <div className="py-8 text-center text-[13px] text-n-500">Loading…</div>}
          {!isLoading && items.length === 0 && <div className="py-10 text-center text-[13px] text-n-500">{hasFilters ? 'No products match these filters.' : 'No products yet.'}</div>}
          {items.map((r) => {
            const val = edits[r.productId] ?? String(r.quantity ?? '');
            return (
              <div key={r.productId} className={`flex flex-col gap-2 rounded-[10px] border border-n-200 p-3 ${selected.has(r.productId) ? 'bg-teal-50/40' : ''}`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-[var(--teal-500)]" checked={selected.has(r.productId)} onChange={() => toggleOne(r.productId)} />
                  <span className="code min-w-0 flex-1 truncate text-[12.5px] font-semibold text-n-800">{r.mainSku}</span>
                  <span className="shrink-0 text-[11.5px] text-n-400">{fmtDate(r.updatedAt)}</span>
                </div>
                <div className="truncate text-[13px] text-n-700">{r.title}</div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-n-500">
                  {r.brand && <span>{r.brand}</span>}
                  {r.vendor && <span>· {r.vendor}</span>}
                  {r.productType && <span>· {r.productType}</span>}
                  {r.lastSource && <span className="tag border border-n-200 bg-n-50 text-n-500">{SOURCE_LABEL[r.lastSource] ?? r.lastSource}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-n-600">Available</span>
                  <input
                    className={`mono w-24 rounded-md border px-2 py-1.5 text-right text-[13px] outline-none focus:border-teal-400 ${edited(r) ? 'border-teal-300 bg-teal-50/40' : 'border-n-200 bg-n-0'} ${r.quantity == null && !edited(r) ? 'text-n-300' : 'text-n-900'}`}
                    inputMode="numeric"
                    placeholder="—"
                    value={val}
                    onChange={(e) => setEdits((s) => ({ ...s, [r.productId]: e.target.value.replace(/[^\d]/g, '') }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && edited(r)) commit(r); if (e.key === 'Escape') setEdits((s) => { const n = { ...s }; delete n[r.productId]; return n; }); }}
                  />
                  {edited(r) && (
                    <div className="ml-auto flex gap-1">
                      <button title="Save" disabled={save.isPending} onClick={() => commit(r)} className="grid h-8 w-8 place-items-center rounded-md border border-teal-300 bg-teal-500 text-white disabled:opacity-50"><Check size={15} /></button>
                      <button title="Cancel" onClick={() => setEdits((s) => { const n = { ...s }; delete n[r.productId]; return n; })} className="grid h-8 w-8 place-items-center rounded-md border border-n-200 bg-n-0 text-n-500"><X size={15} /></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex justify-end">
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      )}

      {pushOpen && (
        <PushModal
          productIds={[...selected]}
          titles={new Map(items.map((r) => [r.productId, { sku: r.mainSku, title: r.title }]))}
          onClose={() => setPushOpen(false)}
          onDone={() => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['availability'] }); qc.invalidateQueries({ queryKey: ['channel-listings'] }); }}
        />
      )}
    </div>
  );
}

/** Square tri-state checkbox (ticked / dashed / empty) for the platform and region rows of the
 *  channel chooser. Mirrors the design's custom box, tinted with the platform teal token. */
function CheckSquare({ checked, indeterminate, size = 16 }: { checked: boolean; indeterminate?: boolean; size?: number }) {
  const on = checked || indeterminate;
  const icon = size >= 15 ? 11 : 9;
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-[4px] border text-n-0 ${on ? 'border-teal-500 bg-teal-500' : 'border-n-300 bg-n-0'}`}
      style={{ width: size, height: size }}
    >
      {checked ? <Check size={icon} strokeWidth={3.4} /> : indeterminate ? <Minus size={icon} strokeWidth={3.4} /> : null}
    </span>
  );
}

function PushModal({ productIds, titles, onClose, onDone }: {
  productIds: string[];
  titles: Map<string, { sku: string; title: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  // Preview (dry-run) on open. It validates against each channel's API without applying any change.
  const preview = useQuery({
    queryKey: ['availability-push-preview', productIds],
    queryFn: () => channelListingsApi.push(productIds, true),
    refetchOnWindowFocus: false,
  });

  const rows = preview.data?.results ?? [];
  // Distinct channels present across the previewed products (keyed by the dashboard column id).
  const channels = useMemo(() => {
    const m = new Map<string, { label: string; marketplace: string; channelType: string; countryIso: string }>();
    for (const r of rows) if (!m.has(r.channelKey)) m.set(r.channelKey, { label: r.channel, marketplace: r.marketplace, channelType: r.channelType, countryIso: r.countryIso });
    return [...m.entries()].map(([key, v]) => ({ key, ...v }));
  }, [rows]);
  // Once a live push finishes we keep the modal open and show a detailed report instead of a toast.
  const [report, setReport] = useState<ChannelPushResult | null>(null);
  // null until the preview lands; then defaults to ALL channels (push-to-all is the default action).
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  useEffect(() => { if (preview.data && chosen === null) setChosen(new Set(channels.map((c) => c.key))); }, [preview.data, channels, chosen]);
  const chosenSet = chosen ?? new Set(channels.map((c) => c.key));
  const allChannels = channels.length > 0 && chosenSet.size >= channels.length;
  const setMany = (keys: string[], on: boolean) => setChosen((s) => { const n = new Set(s ?? channels.map((c) => c.key)); keys.forEach((k) => (on ? n.add(k) : n.delete(k))); return n; });

  // Three-level chooser: platform (Amazon/eBay/OnBuy) → regional group (Amazon Europe…) → channel.
  const PLATFORM_LABEL: Record<string, string> = { amazon: 'Amazon', ebay: 'eBay', onbuy: 'OnBuy', other: 'Other' };
  const PLATFORM_ORDER = ['amazon', 'ebay', 'onbuy', 'other'];
  const groupOrder = (key: string) => { const i = CHANNEL_GROUPS.findIndex((g) => g.key === key); return i === -1 ? 999 : i; };
  const channelTree = useMemo(() => {
    const plats = new Map<string, { platform: string; label: string; groups: Map<string, { key: string; label: string; channels: typeof channels }> }>();
    for (const c of channels) {
      const platform = (c.channelType || channelPlatform(c.label) || 'other') as ChannelPlatform;
      const grp = channelGroupOf({ name: c.label, countryIso: c.countryIso });
      const gkey = grp?.key ?? `${platform}:other`;
      const glabel = grp?.label ?? (PLATFORM_LABEL[platform] ?? platform);
      if (!plats.has(platform)) plats.set(platform, { platform, label: PLATFORM_LABEL[platform] ?? platform, groups: new Map() });
      const P = plats.get(platform)!;
      if (!P.groups.has(gkey)) P.groups.set(gkey, { key: gkey, label: glabel, channels: [] as typeof channels });
      P.groups.get(gkey)!.channels.push(c);
    }
    return [...plats.values()]
      .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform))
      .map((P) => ({
        ...P,
        groups: [...P.groups.values()]
          .sort((a, b) => groupOrder(a.key) - groupOrder(b.key))
          .map((g) => ({ ...g, channels: [...g.channels].sort((a, b) => (a.marketplace || '').localeCompare(b.marketplace || '') || a.label.localeCompare(b.label)) })),
      }));
  }, [channels]);

  const pushable = rows.filter((r) => r.ok && chosenSet.has(r.channelKey));
  // Group rows by product for a readable plan.
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) { const a = m.get(r.productId) ?? []; a.push(r); m.set(r.productId, a); }
    return [...m.entries()];
  }, [rows]);

  const commit = useMutation({
    // Push to all channels => omit the filter (server pushes to every listing). Subset => pass the chosen keys.
    mutationFn: () => channelListingsApi.push(productIds, false, allChannels ? undefined : [...chosenSet]),
    onSuccess: (r) => {
      // Keep the modal open on a detailed report; refresh the underlying list behind it.
      setReport(r);
      onDone();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Push failed'),
  });

  // --- Presentation helpers (design: compact chips + merged preview) ----------
  const REGION_SHORT: Record<string, string> = {
    'amazon-eu': 'Europe', 'amazon-americas': 'Americas', 'amazon-apac': 'Asia-Pacific', 'amazon-mena': 'MENA',
    'ebay-eu': 'Europe', 'ebay-americas': 'Americas', 'ebay-apac': 'Asia-Pacific', 'onbuy': 'UK',
  };
  const stripPlatform = (s: string) => s.replace(/^(Amazon|eBay|OnBuy)\s*/i, '').trim();
  const regionShort = (g: { key: string; label: string }) => REGION_SHORT[g.key] ?? (stripPlatform(g.label) || g.label);
  // Chip label = the per-market ISO for eBay marketplaces; the account-wide eBay listing (no
  // marketplace) shows "eBay" so it isn't a duplicate of the per-market GB chip. Amazon/OnBuy
  // use their region ISO.
  const chipLabel = (c: { countryIso: string; marketplace: string; label: string; channelType: string }) =>
    c.marketplace || (c.channelType === 'ebay' ? 'eBay' : c.countryIso) || stripPlatform(c.label) || c.label;
  const chanName = (r: { channel: string; marketplace: string }) => `${r.channel}${r.marketplace ? ` ${r.marketplace}` : ''}`;
  // "Validated" / "Skipped" / "Failed" status + a muted detail line (eBay revise / OnBuy set …).
  const statusOf = (ok: boolean, excluded: boolean) =>
    excluded ? { t: 'Skipped', c: 'text-n-400', d: 'bg-n-300' }
    : ok ? { t: 'Validated', c: 'text-teal-700', d: 'bg-teal-500' }
    : { t: 'Failed', c: 'text-rose-600', d: 'bg-rose-500' };
  const noteOf = (r: (typeof rows)[number], excluded: boolean) => {
    if (excluded) return '';
    if (!r.ok) return r.message;
    const m = r.message || '';
    return m.toLowerCase() === 'validated' ? '' : m.replace(/^validated\s*\(?/i, '').replace(/\)\s*$/, '');
  };

  // --- Push report derivation (after a live push) --------------------------
  const reportRows = report?.results ?? [];
  const failedRows = reportRows.filter((r) => !r.ok);
  const okRows = reportRows.filter((r) => r.ok);
  // Group failures by their exact reason so a systemic problem (one expired token, one bad
  // scope) surfaces as a single line with a count instead of N scattered rows.
  const failureReasons = useMemo(() => {
    const m = new Map<string, typeof failedRows>();
    for (const r of failedRows) { const key = (r.message || 'Unknown error').trim(); const a = m.get(key) ?? []; a.push(r); m.set(key, a); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);
  const copyReport = () => {
    if (!report) return;
    const skuOf = (r: (typeof reportRows)[number]) => titles.get(r.productId)?.sku ?? r.channelSku;
    const lines: string[] = [`Availability push — ${okRows.length} pushed, ${failedRows.length} failed (${reportRows.length} attempted)`];
    if (failedRows.length) {
      lines.push('', 'FAILURES');
      for (const [reason, rs] of failureReasons) { lines.push(`• ${reason} (${rs.length})`); for (const r of rs) lines.push(`    - ${chanName(r)} · ${skuOf(r)} · set ${r.targetQty}`); }
    }
    if (okRows.length) { lines.push('', 'PUSHED'); for (const r of okRows) lines.push(`• ${chanName(r)} · ${skuOf(r)} · ${r.currentQty ?? '—'} → ${r.targetQty}`); }
    navigator.clipboard.writeText(lines.join('\n')).then(() => toast.success('Report copied')).catch(() => toast.error('Could not copy'));
  };

  const singleProduct = productIds.length === 1;
  const soleTitle = singleProduct ? titles.get(productIds[0]) : undefined;
  // Whether a product's channel SKUs all equal its own SKU (then we state it once, not per row).
  const skuMatches = (sku: string | undefined, prodRows: typeof rows) => !!sku && prodRows.length > 0 && prodRows.every((r) => r.channelSku === sku);

  const rowEl = (r: (typeof rows)[number], key: string | number, sku?: string) => {
    const excluded = !chosenSet.has(r.channelKey);
    const st = statusOf(r.ok, excluded);
    const note = noteOf(r, excluded);
    const showSku = sku != null && r.channelSku !== sku;
    return (
      <div key={key} className={`grid grid-cols-[1fr_78px_minmax(94px,1.1fr)] items-center gap-1 border-t border-n-50 px-3 py-[7px] ${excluded ? 'opacity-40' : ''}`}>
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium text-n-700">{chanName(r)}</span>
          {showSku && <span className="code block truncate text-[10.5px] text-n-400">{r.channelSku}</span>}
        </span>
        <span className="mono whitespace-nowrap text-right text-[11.5px] tabular-nums text-n-600">{r.currentQty ?? '—'} → <b className="text-n-900">{r.targetQty}</b></span>
        <span className="min-w-0 pl-3">
          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold ${st.c}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.d}`} />{st.t}
          </span>
          {note && <span className={`block truncate text-[10.5px] ${r.ok ? 'text-n-400' : 'text-rose-500'}`} title={note}>{note}</span>}
        </span>
      </div>
    );
  };

  return (
    <ModalShell
      open
      title={report ? 'Push report' : 'Push availability to channels'}
      subtitle={report ? `${report.ok} pushed · ${report.failed} failed` : `${productIds.length} product${productIds.length === 1 ? '' : 's'} selected`}
      primaryLabel={report ? 'Done' : commit.isPending ? 'Pushing…' : allChannels ? `Push to all channels (${pushable.length})` : `Push to ${chosenSet.size} channel${chosenSet.size === 1 ? '' : 's'} (${pushable.length})`}
      primaryDisabled={report ? false : preview.isLoading || pushable.length === 0 || commit.isPending}
      busy={report ? false : commit.isPending}
      onPrimary={() => (report ? onClose() : commit.mutate())}
      onClose={onClose}
      initialSize={{ w: 780, h: 600 }}
    >
      <div className="flex h-full flex-col p-1">
        {report ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-teal-50 px-2.5 py-1 text-[12.5px] font-semibold text-teal-700"><CheckCircle2 size={14} />{okRows.length} pushed</span>
              {failedRows.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2.5 py-1 text-[12.5px] font-semibold text-rose-600"><AlertTriangle size={14} />{failedRows.length} failed</span>}
              <span className="text-[12px] text-n-400">{reportRows.length} listing{reportRows.length === 1 ? '' : 's'} attempted</span>
              <button onClick={copyReport} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-n-200 px-2.5 py-1 text-[12px] font-medium text-n-600 hover:border-n-300"><ClipboardCopy size={13} />Copy report</button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {failedRows.length > 0 && (
                <div className="rounded-lg border border-rose-200 bg-rose-50/40">
                  <div className="border-b border-rose-100 px-3 py-2 text-[12px] font-semibold text-rose-700">Failures — grouped by reason</div>
                  <div className="divide-y divide-rose-100">
                    {failureReasons.map(([reason, rs]) => (
                      <div key={reason} className="px-3 py-2.5">
                        <div className="mb-1.5 flex items-start gap-1.5">
                          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-rose-500" />
                          <span className="text-[12.5px] font-semibold text-rose-700">{reason}</span>
                          <span className="mono ml-auto shrink-0 rounded-pill bg-rose-100 px-1.5 text-[11px] font-semibold text-rose-600">{rs.length}</span>
                        </div>
                        <ul className="space-y-1 pl-5">
                          {rs.map((r, i) => (
                            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-n-600">
                              <span className="font-medium text-n-700">{chanName(r)}</span>
                              <span className="code text-n-500">{titles.get(r.productId)?.sku ?? r.channelSku}</span>
                              <span className="text-n-400">target {r.currentQty ?? '—'} → {r.targetQty}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {okRows.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-n-200">
                  <div className="border-b border-n-100 bg-n-25 px-3 py-2 text-[12px] font-semibold text-n-600">Pushed successfully ({okRows.length})</div>
                  <div>
                    {okRows.map((r, i) => (
                      <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-n-50 px-3 py-1.5 first:border-t-0">
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-medium text-n-700">{chanName(r)}</span>
                          <span className="code block truncate text-[10.5px] text-n-400">{titles.get(r.productId)?.sku ?? r.channelSku}</span>
                        </span>
                        <span className="mono whitespace-nowrap text-[11.5px] tabular-nums text-n-600">{r.currentQty ?? '—'} → <b className="text-n-900">{r.targetQty}</b></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {reportRows.length === 0 && <div className="py-8 text-center text-[13px] text-n-400">Nothing was pushed.</div>}
            </div>
          </div>
        ) : (
        <>
        {preview.isLoading && <div className="py-10 text-center text-[13px] text-n-400">Checking each channel…</div>}
        {preview.isError && <div className="py-10 text-center text-[13px] text-rose-500">Could not build the push preview.</div>}
        {preview.data && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Compact preview banner (design: a chip, not a full-width bar). */}
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-n-100 bg-n-25 px-3 py-1.5 text-[12px] text-n-500">
              <Info size={13} className="shrink-0 text-n-400" />
              <span>Preview only — nothing changed yet. <b className="text-n-700">{pushable.length}</b> listing{pushable.length === 1 ? '' : 's'} will match Availability{preview.data.failed > 0 && <> · <span className="text-rose-600">{preview.data.failed} cannot be pushed</span></>}.</span>
            </div>

            {rows.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-n-400">The selected products have no active channel listings to push.</div>
            ) : (
              // Two panels: stack in the standard modal; each fills the container height and scrolls
              // independently when they sit side-by-side (full page).
              <div className="flex min-h-0 flex-1 flex-wrap items-stretch gap-4">

                {/* CHANNELS PANEL — platform cards with region rows + wrapping country chips. */}
                <div className="flex min-h-0 min-w-0 flex-1 basis-[400px] flex-col">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="eyebrow">Channels to push</span>
                    <div className="flex gap-2.5 text-[12px] font-semibold">
                      <button onClick={() => setChosen(new Set(channels.map((c) => c.key)))} className="text-teal-600 hover:text-teal-700">All</button>
                      <span className="text-n-300">·</span>
                      <button onClick={() => setChosen(new Set())} className="text-n-500 hover:text-n-700">None</button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
                    {channelTree.map((P) => {
                      const pKeys = P.groups.flatMap((g) => g.channels.map((c) => c.key));
                      const pOn = pKeys.filter((k) => chosenSet.has(k)).length;
                      return (
                        <div key={P.platform} className="rounded-lg border border-n-200 p-2.5">
                          <button onClick={() => setMany(pKeys, pOn !== pKeys.length)} className="mb-2 flex w-full items-center gap-2 text-left">
                            <CheckSquare checked={pOn === pKeys.length} indeterminate={pOn > 0 && pOn < pKeys.length} />
                            <span className="text-[13.5px] font-semibold text-n-900">{P.label}</span>
                            <span className="mono text-[11px] text-n-400">{pOn}/{pKeys.length}</span>
                          </button>
                          <div className="space-y-1.5">
                            {P.groups.map((g) => {
                              const gKeys = g.channels.map((c) => c.key);
                              const gOn = gKeys.filter((k) => chosenSet.has(k)).length;
                              return (
                                <div key={g.key} className="flex flex-wrap items-center gap-1.5">
                                  <button onClick={() => setMany(gKeys, gOn !== gKeys.length)} className="flex min-w-[86px] shrink-0 items-center gap-1.5 py-0.5 text-left">
                                    <CheckSquare size={13} checked={gOn === gKeys.length} indeterminate={gOn > 0 && gOn < gKeys.length} />
                                    <span className="text-[11px] font-semibold text-n-500">{regionShort(g)}</span>
                                  </button>
                                  {g.channels.map((c) => {
                                    const on = chosenSet.has(c.key);
                                    return (
                                      <button key={c.key} onClick={() => setMany([c.key], !on)}
                                        className={`inline-flex select-none items-center gap-1 rounded-md border px-2 py-[3px] text-[11.5px] font-semibold transition ${on ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-n-200 bg-n-0 text-n-500 hover:border-teal-300'}`}>
                                        {on && <Check size={10} strokeWidth={3.2} />}
                                        {chipLabel(c)}
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* PREVIEW PANEL — compact table: Channel · Qty → New · Status (+ muted detail). */}
                <div className="flex min-h-0 min-w-0 flex-1 basis-[400px] flex-col">
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="eyebrow">Preview</span>
                    {singleProduct && soleTitle ? (
                      <>
                        <span className="code text-[11.5px] text-teal-700">{soleTitle.sku}</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-n-500">{soleTitle.title}</span>
                      </>
                    ) : (
                      <span className="text-[12px] text-n-500">{productIds.length} products</span>
                    )}
                  </div>
                  {singleProduct && skuMatches(soleTitle?.sku, groups[0]?.[1] ?? []) && (
                    <div className="mb-2 text-[11.5px] text-n-400">Channel SKU matches the product SKU on all channels.</div>
                  )}
                  <div className="mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-n-200">
                    <div className="grid grid-cols-[1fr_78px_minmax(94px,1.1fr)] gap-1 border-b border-n-100 bg-n-25 px-3 py-[7px] text-[9.5px] font-semibold uppercase tracking-wide text-n-400">
                      <span>Channel</span><span className="text-right">Qty → New</span><span className="pl-3">Status</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {singleProduct
                        ? (groups[0]?.[1] ?? []).map((r, i) => rowEl(r, i, skuMatches(soleTitle?.sku, groups[0]?.[1] ?? []) ? undefined : soleTitle?.sku))
                        : groups.map(([pid, grp]) => {
                            const label = titles.get(pid);
                            const matches = skuMatches(label?.sku, grp);
                            return (
                              <div key={pid}>
                                <div className="flex items-center gap-2 border-t border-n-100 bg-n-25 px-3 py-1.5">
                                  {label?.sku && <span className="code text-[11px] text-n-800">{label.sku}</span>}
                                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-n-500">{label?.title ?? pid}</span>
                                </div>
                                {grp.map((r, i) => rowEl(r, `${pid}-${i}`, matches ? undefined : label?.sku))}
                              </div>
                            );
                          })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        </>
        )}
      </div>
    </ModalShell>
  );
}

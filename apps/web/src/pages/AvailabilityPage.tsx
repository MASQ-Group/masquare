import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell, Pagination, Select } from '@masquare/ui';
import { availabilityApi, brandsApi, channelListingsApi, productTypesApi, vendorsApi, type AvailabilityRow } from '../lib/api';
import { usePersistentState } from '../lib/usePersistentState';

const SOURCE_LABEL: Record<string, string> = { manual: 'Manual', vendor_import: 'Vendor import', sale: 'Sale', return: 'Return' };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export function AvailabilityPage() {
  const qc = useQueryClient();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [brandId, setBrandId] = usePersistentState('availability.brand', '');
  const [vendorId, setVendorId] = usePersistentState('availability.vendor', '');
  const [productTypeId, setProductTypeId] = usePersistentState('availability.type', '');
  const [onlyUnset, setOnlyUnset] = usePersistentState('availability.unset', false);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  // Per-row edit buffer (productId -> typed string), so several rows can be edited before saving.
  const [edits, setEdits] = useState<Record<string, string>>({});
  // Selected products for a channel quantity push.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pushOpen, setPushOpen] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250); return () => clearTimeout(t); }, [qInput]);
  useEffect(() => { setPage(1); }, [brandId, vendorId, productTypeId, onlyUnset]);

  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const { data: types = [] } = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });

  const params = { q: q || undefined, brandId: brandId || undefined, vendorId: vendorId || undefined, productTypeId: productTypeId || undefined, unset: onlyUnset || undefined, page, pageSize };
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

  const hasFilters = !!(q || brandId || vendorId || productTypeId || onlyUnset);
  const resetFilters = () => { setQInput(''); setQ(''); setBrandId(''); setVendorId(''); setProductTypeId(''); setOnlyUnset(false); };

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
      const ids = await availabilityApi.ids({ q: q || undefined, brandId: brandId || undefined, vendorId: vendorId || undefined, productTypeId: productTypeId || undefined, unset: onlyUnset || undefined });
      setSelected(new Set(ids));
    } catch { toast.error('Could not select all products'); } finally { setSelectingAll(false); }
  };

  return (
    <div className="w-full">
      <div className="mb-5">
        <div className="eyebrow mb-1.5">Catalogue &amp; Inventory</div>
        <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Availability</h1>
        <p className="mt-1 text-[13.5px] text-n-500">The sellable quantity broadcast to your sales channels — the single source of truth for how much of each SKU is available. Separate from warehouse stock; set it from your vendors' availability.</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="flex h-9 min-w-[220px] max-w-[300px] flex-1 items-center gap-2 rounded-md border border-n-200 bg-n-50 px-3">
          <Search size={15} className="text-n-400" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search SKU or title…" className="flex-1 bg-transparent text-[13px] text-n-900 outline-none placeholder:text-n-400" />
        </div>
        <Select dense className="w-40" value={brandId} onChange={setBrandId} options={opts(brands, 'All brands')} />
        <Select dense className="w-40" value={vendorId} onChange={setVendorId} options={opts(vendors, 'All vendors')} />
        <Select dense className="w-40" value={productTypeId} onChange={setProductTypeId} options={opts(types, 'All types')} />
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-n-600">
          <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--teal-500)]" checked={onlyUnset} onChange={(e) => setOnlyUnset(e.target.checked)} /> Not set yet
        </label>
        {hasFilters && <button onClick={resetFilters} className="text-[12.5px] font-semibold text-n-500 hover:text-n-700">Reset</button>}
        <div className="ml-auto flex items-center gap-2.5">
          {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="text-[12.5px] font-semibold text-n-500 hover:text-n-700">Clear ({selected.size})</button>}
          <button disabled={selected.size === 0} onClick={() => setPushOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-500 px-3.5 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
            title={selected.size === 0 ? 'Select products to push their availability to the channels' : 'Push the selected products’ availability to all their channel listings'}>
            <Send size={15} /> Push to channels{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      </div>

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
        <div className="overflow-x-auto">
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
          onDone={() => { setPushOpen(false); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['availability'] }); qc.invalidateQueries({ queryKey: ['channel-listings'] }); }}
        />
      )}
    </div>
  );
}

const STATE_DOT: Record<string, string> = { ok: 'bg-emerald-500', fail: 'bg-rose-500' };

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
    const m = new Map<string, { label: string; marketplace: string }>();
    for (const r of rows) if (!m.has(r.channelKey)) m.set(r.channelKey, { label: r.channel, marketplace: r.marketplace });
    return [...m.entries()].map(([key, v]) => ({ key, ...v }));
  }, [rows]);
  // null until the preview lands; then defaults to ALL channels (push-to-all is the default action).
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  useEffect(() => { if (preview.data && chosen === null) setChosen(new Set(channels.map((c) => c.key))); }, [preview.data, channels, chosen]);
  const chosenSet = chosen ?? new Set(channels.map((c) => c.key));
  const allChannels = channels.length > 0 && chosenSet.size >= channels.length;
  const toggleChannel = (key: string) => setChosen((s) => { const n = new Set(s ?? channels.map((c) => c.key)); n.has(key) ? n.delete(key) : n.add(key); return n; });

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
      if (r.failed > 0) toast.warning(`Pushed ${r.ok} listing${r.ok === 1 ? '' : 's'}, ${r.failed} failed`);
      else toast.success(`Pushed availability to ${r.ok} listing${r.ok === 1 ? '' : 's'}`);
      onDone();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Push failed'),
  });

  const th = 'px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-n-400';
  const td = 'px-3 py-1.5 text-[12.5px] text-n-700';

  return (
    <ModalShell
      open
      title="Push availability to channels"
      subtitle={`${productIds.length} product${productIds.length === 1 ? '' : 's'} selected`}
      primaryLabel={commit.isPending ? 'Pushing…' : allChannels ? `Push to all channels (${pushable.length})` : `Push to ${chosenSet.size} channel${chosenSet.size === 1 ? '' : 's'} (${pushable.length})`}
      primaryDisabled={preview.isLoading || pushable.length === 0 || commit.isPending}
      busy={commit.isPending}
      onPrimary={() => commit.mutate()}
      onClose={onClose}
      initialSize={{ w: 760, h: 600 }}
    >
      <div className="p-1">
        {preview.isLoading && <div className="py-10 text-center text-[13px] text-n-400">Checking each channel…</div>}
        {preview.isError && <div className="py-10 text-center text-[13px] text-rose-500">Could not build the push preview.</div>}
        {preview.data && (
          <>
            <div className="mb-3 rounded-md border border-n-200 bg-n-25 px-3.5 py-2.5 text-[12.5px] text-n-600">
              Preview only — nothing has changed yet. <b className="text-n-800">{pushable.length}</b> listing{pushable.length === 1 ? '' : 's'} will be updated to match Availability
              {preview.data.failed > 0 && <> · <span className="text-rose-600">{preview.data.failed} cannot be pushed</span></>}.
            </div>

            {/* Channel chooser — all channels by default; untick any to push to specific channels only. */}
            {channels.length > 1 && (
              <div className="mb-3 rounded-lg border border-n-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Channels</span>
                  <div className="flex gap-2 text-[12px]">
                    <button onClick={() => setChosen(new Set(channels.map((c) => c.key)))} className="font-semibold text-teal-600 hover:text-teal-700">All</button>
                    <span className="text-n-300">·</span>
                    <button onClick={() => setChosen(new Set())} className="font-semibold text-n-500 hover:text-n-700">None</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {channels.map((c) => {
                    const on = chosenSet.has(c.key);
                    return (
                      <button key={c.key} onClick={() => toggleChannel(c.key)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${on ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-n-200 bg-n-0 text-n-400'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-teal-500' : 'bg-n-300'}`} />
                        {c.label}{c.marketplace ? ` ${c.marketplace}` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {rows.length === 0 && (
              <div className="py-8 text-center text-[13px] text-n-400">The selected products have no active channel listings to push.</div>
            )}
            <div className="space-y-3">
              {groups.map(([pid, grp]) => {
                const label = titles.get(pid);
                return (
                  <div key={pid} className="overflow-hidden rounded-lg border border-n-200">
                    <div className="flex items-center gap-2 border-b border-n-100 bg-n-25 px-3 py-2">
                      {label?.sku && <span className="code text-[12px] text-n-800">{label.sku}</span>}
                      <span className="truncate text-[12.5px] text-n-500">{label?.title ?? pid}</span>
                    </div>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="text-left">
                          <th className={th}>Channel</th>
                          <th className={th}>Channel SKU</th>
                          <th className={`${th} text-right`}>Current</th>
                          <th className={`${th} text-right`}>New</th>
                          <th className={th}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grp.map((r, i) => {
                          const excluded = !chosenSet.has(r.channelKey);
                          return (
                            <tr key={i} className={`border-t border-n-50 ${excluded ? 'opacity-40' : ''}`}>
                              <td className={`${td} whitespace-nowrap`}>{r.channel}{r.marketplace ? <span className="ml-1 text-n-400">{r.marketplace}</span> : null}{excluded ? <span className="ml-1.5 text-[11px] text-n-400">(skipped)</span> : null}</td>
                              <td className={`${td} code text-n-500`}>{r.channelSku}</td>
                              <td className={`${td} mono text-right text-n-500`}>{r.currentQty ?? '—'}</td>
                              <td className={`${td} mono text-right font-semibold text-n-900`}>{r.targetQty}</td>
                              <td className={td}>
                                <span className="inline-flex items-center gap-1.5">
                                  <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[r.ok ? 'ok' : 'fail']}`} />
                                  <span className={r.ok ? 'text-n-500' : 'text-rose-600'}>{r.message}</span>
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

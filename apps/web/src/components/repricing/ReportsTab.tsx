import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DownloadCloud } from 'lucide-react';
import { Pagination, Select, TableScroll, downloadSheet } from '@masquare/ui';
import { brandsApi, integrationsApi, productTypesApi, repricingApi, vendorsApi, type RepricingReportRow } from '../../lib/api';
import { SkuReportModal } from './SkuReportModal';

/**
 * What the repricer has actually done, per SKU per marketplace, over a span of days.
 *
 * Reads the nightly summaries rather than the raw decisions, so a quarter loads as fast as a week.
 * The headline figures cover everything the filters match; the table shows a page of it, busiest
 * first.
 *
 * Two currencies live on this screen and they are labelled, never mixed: prices are in the
 * marketplace's own currency (a UK listing is priced in pounds), while revenue and profit are
 * converted to euros at the rate stored on each order, because five marketplaces cannot be added up
 * in five currencies.
 */

const SPANS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
];
const STATES = ['LIVE', 'SHADOW', 'EXCLUDED', 'QUARANTINED', 'KILLED'];
const PAGE_SIZE = 50;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const eur = (cents: number | null | undefined) => (cents == null ? '—' : `€${(cents / 100).toFixed(2)}`);
const SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', SEK: 'kr ', PLN: 'zł ' };
const price = (cents: number | null | undefined, ccy: string | null) => {
  if (cents == null) return '—';
  const c = (ccy ?? 'EUR').toUpperCase();
  return `${SYMBOL[c] ?? `${c} `}${(cents / 100).toFixed(c === 'JPY' ? 0 : 2)}`;
};
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);

/** What the profit figures were worked out from, said plainly. */
const FEE_BASIS_NOTE: Record<string, string> = {
  actual: 'Profit uses the fees Amazon settled.',
  estimated: 'Profit uses estimated fees — Amazon has not settled them yet.',
  mixed: 'Some profit figures use settled fees and some estimates; Amazon settles days after the order.',
  none: 'No fees were available, so profit counts only the cost of the goods.',
};

export function ReportsTab() {
  const [span, setSpan] = useState('30');
  const [marketplace, setMarketplace] = useState('');
  const [brandId, setBrandId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [productTypeId, setProductTypeId] = useState('');
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<RepricingReportRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const to = isoDay(new Date());
  const from = isoDay(new Date(Date.now() - (Number(span) - 1) * 86_400_000));

  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list });
  const markets = [...new Set(integrations.filter((i) => i.channelType === 'amazon' && i.marketplace).map((i) => i.marketplace as string))].sort();
  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list() });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: () => vendorsApi.list() });
  const { data: productTypes = [] } = useQuery({ queryKey: ['product-types'], queryFn: () => productTypesApi.list() });

  // Any filter change returns to page 1 — a narrowed result set would otherwise land on an empty page.
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const filters = { from, to, marketplace, brandId, vendorId, productTypeId, state, q };
  const query = useQuery({
    queryKey: ['repricing', 'analytics', 'report', { ...filters, page }],
    queryFn: () => repricingApi.report({ ...filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });
  const rows = query.data?.items ?? [];
  const totals = query.data?.totals;
  const skus = query.data?.skus ?? 0;
  const pageCount = Math.max(1, Math.ceil(skus / PAGE_SIZE));

  const exportAll = async () => {
    setExporting(true);
    try {
      const { rows: flat } = await repricingApi.exportReport(filters);
      if (flat.length === 0) {
        toast.error('Nothing to export for these filters.');
        return;
      }
      const headers = Object.keys(flat[0]);
      await downloadSheet(`repricing-statistics-${from}-to-${to}`, [headers, ...flat.map((r) => headers.map((h) => r[h] ?? ''))], 'xlsx');
      toast.success(`Exported ${flat.length} SKU${flat.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('Could not build the spreadsheet.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {open && <SkuReportModal row={open} from={from} to={to} onClose={() => setOpen(null)} />}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-n-100 px-4 py-2.5">
          <span className="text-[13px] font-semibold text-n-800">Repricing statistics</span>
          <div className="w-[150px]"><Select dense value={span} onChange={reset(setSpan)} options={SPANS} /></div>
          <input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Search SKU or ASIN…" className="h-8 w-44 rounded-md border border-n-200 px-2.5 font-mono text-[12.5px] outline-none focus:border-teal-400" />
          <div className="w-[140px]">
            <Select dense searchable value={marketplace} onChange={reset(setMarketplace)}
              options={[{ value: '', label: 'All marketplaces' }, ...markets.map((m) => ({ value: m, label: m }))]} />
          </div>
          <div className="w-[150px]">
            <Select dense searchable value={brandId} onChange={reset(setBrandId)}
              options={[{ value: '', label: 'All brands' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} />
          </div>
          <div className="w-[150px]">
            <Select dense searchable value={vendorId} onChange={reset(setVendorId)}
              options={[{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]} />
          </div>
          <div className="w-[150px]">
            <Select dense searchable value={productTypeId} onChange={reset(setProductTypeId)}
              options={[{ value: '', label: 'All product types' }, ...productTypes.map((t) => ({ value: t.id, label: t.name }))]} />
          </div>
          <div className="w-[130px]">
            <Select dense value={state} onChange={reset(setState)}
              options={[{ value: '', label: 'All states' }, ...STATES.map((s) => ({ value: s, label: s }))]} />
          </div>
          <div className="flex-1" />
          <button type="button" className="hbtn" disabled={exporting || skus === 0} onClick={() => void exportAll()}>
            <DownloadCloud size={13} className="mr-1 inline" />{exporting ? 'Building…' : 'Export'}
          </button>
        </div>

        {/* The headline covers every SKU the filters match, not the page on screen. */}
        <div className="grid grid-cols-2 gap-px bg-n-100 sm:grid-cols-4 lg:grid-cols-7">
          <Kpi label="SKUs" value={skus.toLocaleString()} note={`${from} → ${to}`} />
          <Kpi label="Evaluations" value={(totals?.evaluations ?? 0).toLocaleString()} note={`${(totals?.priced ?? 0).toLocaleString()} priced · ${(totals?.held ?? 0).toLocaleString()} held`} />
          <Kpi label="Price changes" value={(totals?.priceChanges ?? 0).toLocaleString()} note={totals?.vetoed ? `${totals.vetoed} vetoed` : undefined} />
          <Kpi label="Buy Box won" value={pct(totals?.buyBoxWinPct)} note={totals?.buyBoxSamples ? `${totals.buyBoxSamples.toLocaleString()} samples` : 'not sampled yet'} />
          <Kpi label="At the floor" value={pct(totals?.atFloorPct)} note="of samples" />
          <Kpi label="Units sold" value={(totals?.unitsSold ?? 0).toLocaleString()} note={totals?.afterChangePct != null ? `${pct(totals.afterChangePct)} after a change` : undefined} />
          <Kpi label="Profit (€)" value={eur(totals?.profitCents)} note={totals?.marginPct != null ? `${totals.marginPct}% margin · ${eur(totals.revenueCents)} revenue` : eur(totals?.revenueCents)} />
        </div>

        <TableScroll>
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-n-500">
              <tr>
                <th className="px-4 py-2 font-semibold">SKU</th>
                <th className="px-3 py-2 font-semibold">Mkt</th>
                <th className="px-3 py-2 font-semibold">Product</th>
                <th className="px-3 py-2 font-semibold">State</th>
                <th className="px-3 py-2 text-right font-semibold">Start</th>
                <th className="px-3 py-2 text-right font-semibold">End</th>
                <th className="px-3 py-2 text-right font-semibold">Move</th>
                <th className="px-3 py-2 text-right font-semibold">Changes</th>
                <th className="px-3 py-2 text-right font-semibold">Evals</th>
                <th className="px-3 py-2 text-right font-semibold">Buy Box</th>
                <th className="px-3 py-2 text-right font-semibold">At floor</th>
                <th className="px-3 py-2 text-right font-semibold">Units</th>
                <th className="px-3 py-2 text-right font-semibold">After change</th>
                <th className="px-3 py-2 text-right font-semibold">Revenue €</th>
                <th className="px-3 py-2 text-right font-semibold">Profit €</th>
                <th className="px-3 py-2 font-semibold"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr><td colSpan={16} className="px-4 py-6 text-center text-n-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-4 py-8 text-center text-n-500">
                    Nothing recorded for these filters yet. Statistics are built nightly — use <strong>Rebuild statistics</strong> above to summarise what is already in the system.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.marketplaceId}-${r.sku}`} className="cursor-pointer border-t border-n-100 hover:bg-n-25" onClick={() => setOpen(r)}>
                    <td className="px-4 py-1.5 font-mono text-n-800">{r.sku}</td>
                    <td className="px-3 py-1.5 font-mono">{r.marketplace}</td>
                    <td className="max-w-[220px] truncate px-3 py-1.5 text-n-600" title={r.productName ?? undefined}>{r.productName ?? '—'}</td>
                    <td className="px-3 py-1.5 text-[11.5px] text-n-600">{r.state ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-n-500">{price(r.priceOpenCents, r.currency)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-n-800">{price(r.priceCloseCents, r.currency)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${r.priceMovePct == null ? 'text-n-400' : r.priceMovePct < 0 ? 'text-orange-700' : r.priceMovePct > 0 ? 'text-teal-700' : 'text-n-500'}`}>
                      {r.priceMovePct == null ? '—' : `${r.priceMovePct > 0 ? '+' : ''}${r.priceMovePct}%`}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.priceChanges}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-n-600" title={`${r.priced} priced · ${r.held} held · ${r.skipped} skipped`}>{r.evaluations}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.buyBoxWinPct)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-n-600">{pct(r.atFloorPct)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.unitsSold}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-n-600" title="Units sold within 24 hours of one of our price changes">
                      {r.unitsSold > 0 ? `${r.unitsAfterChange} (${pct(r.afterChangePct)})` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{eur(r.revenueCents)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${r.profitCents != null && r.profitCents < 0 ? 'text-danger' : ''}`} title={r.marginPct != null ? `${r.marginPct}% margin` : undefined}>
                      {eur(r.profitCents)}
                    </td>
                    <td className="px-3 py-1.5 text-right"><span className="text-[11.5px] font-semibold text-teal-700">History</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroll>

        <div className="px-4 pb-3">
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      </div>

      <p className="px-1 text-[11.5px] leading-relaxed text-n-500">
        Prices are in each marketplace&rsquo;s own currency; revenue and profit are converted to euros at the rate stored on the order.
        {totals?.feeBasis ? ` ${FEE_BASIS_NOTE[totals.feeBasis] ?? ''}` : ''} A day is counted in UTC, and a sale counts as
        following a price change when it happened within 24 hours of one.
      </p>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-n-0 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-n-500">{label}</div>
      <div className="font-mono text-[16px] tabular-nums text-n-900">{value}</div>
      {note && <div className="truncate text-[11px] text-n-500" title={note}>{note}</div>}
    </div>
  );
}

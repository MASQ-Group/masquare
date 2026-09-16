import { useQuery } from '@tanstack/react-query';
import { ModalShell } from '@masquare/ui';
import { repricingApi, type RepricingReportRow } from '../../lib/api';
import { PriceHistoryChart } from './PriceHistoryChart';

/**
 * One SKU's repricing history: what we charged, what the Buy Box cost, and what sold while it did.
 *
 * Opened from a row of the report, so the span it reads is the span the report is showing — a chart
 * that silently covered a different period from the table above it would be a trap.
 */
export function SkuReportModal({ row, from, to, onClose }: { row: RepricingReportRow; from: string; to: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['repricing', 'analytics', 'sku', row.sku, row.marketplace, from, to],
    queryFn: () => repricingApi.skuReport({ sku: row.sku, marketplace: row.marketplace, from, to }),
  });
  const d = q.data;
  const ccy = row.currency ?? d?.listing?.currency ?? null;

  return (
    <ModalShell
      open
      title={`${row.sku} — ${row.marketplace}`}
      subtitle={[d?.listing?.product?.title, row.asin].filter(Boolean).join(' · ') || 'Repricing history'}
      primaryLabel="Close"
      onPrimary={onClose}
      onClose={onClose}
      initialSize={{ w: 980, h: 680 }}
    >
      <div className="space-y-4 p-1">
        {q.isLoading ? (
          <div className="py-16 text-center text-[12.5px] text-n-500">Loading…</div>
        ) : !d ? (
          <div className="py-16 text-center text-[12.5px] text-n-500">Nothing recorded for this SKU.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Price now" value={money(d.listing?.currentPriceCents ?? row.priceCloseCents, ccy)} />
              <Stat label="Over the period" value={`${money(row.priceOpenCents, ccy)} → ${money(row.priceCloseCents, ccy)}`} tone={row.priceMovePct == null ? undefined : row.priceMovePct < 0 ? 'down' : row.priceMovePct > 0 ? 'up' : undefined} note={row.priceMovePct == null ? undefined : `${row.priceMovePct > 0 ? '+' : ''}${row.priceMovePct}%`} />
              <Stat label="Price changes" value={String(row.priceChanges)} note={`${row.evaluations} evaluation${row.evaluations === 1 ? '' : 's'}`} />
              <Stat label="Units sold" value={String(row.unitsSold)} note={row.unitsSold > 0 ? `${row.unitsAfterChange} after a change` : undefined} />
            </div>

            <div className="card p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-n-800">Price and sales</span>
                <span className="text-[11.5px] text-n-500">{d.prices.length} recorded price change{d.prices.length === 1 ? '' : 's'} · {d.samples.length} market sample{d.samples.length === 1 ? '' : 's'}</span>
              </div>
              <PriceHistoryChart
                prices={d.prices}
                samples={d.samples}
                daily={d.daily}
                from={from}
                to={to}
                currency={ccy}
                floorCents={d.listing?.strategyFloorCents ?? row.floorCents ?? null}
              />
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-n-100 px-4 py-2.5 text-[13px] font-semibold text-n-800">Every price we set</div>
              {d.prices.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12.5px] text-n-500">No price changes recorded in this period.</div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-n-500">
                    <tr>
                      <th className="px-4 py-2 font-semibold">When</th>
                      <th className="px-3 py-2 font-semibold">Set by</th>
                      <th className="px-3 py-2 text-right font-semibold">From</th>
                      <th className="px-3 py-2 text-right font-semibold">To</th>
                      <th className="px-3 py-2 text-right font-semibold">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.prices].reverse().slice(0, 200).map((p, i) => {
                      const delta = p.previousPriceCents == null ? null : p.priceCents - p.previousPriceCents;
                      return (
                        <tr key={`${p.at}-${i}`} className="border-t border-n-100">
                          <td className="px-4 py-1.5 text-n-700">{new Date(p.at).toLocaleString()}</td>
                          <td className="px-3 py-1.5"><SourceTag source={p.source} /></td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-n-500">{money(p.previousPriceCents, p.currency)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-n-800">{money(p.priceCents, p.currency)}</td>
                          <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${delta == null ? 'text-n-400' : delta < 0 ? 'text-orange-700' : 'text-teal-700'}`}>
                            {delta == null ? '—' : `${delta > 0 ? '+' : ''}${(delta / 100).toFixed(2)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

/** Who moved the price. Only the repricer's own changes are repricing; the rest are context. */
function SourceTag({ source }: { source: string }) {
  const LABEL: Record<string, string> = {
    repricer: 'Repricer',
    manual_push: 'Manual push',
    listing_sync: 'Seen on Amazon',
    listing_created: 'Listing created',
  };
  const tone = source === 'repricer' ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-n-100 text-n-600 border-n-200';
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>{LABEL[source] ?? source}</span>;
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-lg border border-n-100 bg-n-25 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-n-500">{label}</div>
      <div className="font-mono text-[15px] tabular-nums text-n-900">{value}</div>
      {note && <div className={`text-[11.5px] ${tone === 'down' ? 'text-orange-700' : tone === 'up' ? 'text-teal-700' : 'text-n-500'}`}>{note}</div>}
    </div>
  );
}

const SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', SEK: 'kr ', PLN: 'zł ' };
function money(cents: number | null | undefined, currency: string | null | undefined) {
  if (cents == null) return '—';
  const ccy = (currency ?? 'EUR').toUpperCase();
  return `${SYMBOL[ccy] ?? `${ccy} `}${(cents / 100).toFixed(ccy === 'JPY' ? 0 : 2)}`;
}

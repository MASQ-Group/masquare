import { Injectable } from '@nestjs/common';
import { SalesTransactionsService } from '../sales-transactions/sales-transactions.service';

export interface AnalyticsQuery {
  from: string;
  to: string;
  compareFrom?: string;
  compareTo?: string;
  companyId?: string;
  skuChannelId?: string; // scope the SKU breakdown to one channel (else global)
}

const round = (v: number, d = 2) => Number(v.toFixed(d));
const pct = (profit: number, base: number) => (base > 0 ? round((profit / base) * 100, 2) : null);

/** Sales analytics/reporting — aggregates the already-computed per-transaction
 *  economics (revenue, fees, profit in EUR) so figures match the transaction view. */
@Injectable()
export class AnalyticsService {
  constructor(private readonly tx: SalesTransactionsService) {}

  async report(q: AnalyticsQuery) {
    const main = await this.aggregate(q.from, q.to, q.companyId, q.skuChannelId);
    const compare = q.compareFrom && q.compareTo
      ? await this.aggregate(q.compareFrom, q.compareTo, q.companyId, q.skuChannelId)
      : null;

    // Merge per-channel compare figures for delta columns.
    const byChannel = main.byChannel.map((c) => {
      const prev = compare?.byChannel.find((p) => p.channelId === c.channelId);
      return { ...c, prevRevenueExVatEur: prev?.revenueExVatEur ?? null, prevProfitEur: prev?.profitEur ?? null };
    });

    return {
      range: { from: q.from, to: q.to },
      compareRange: q.compareFrom && q.compareTo ? { from: q.compareFrom, to: q.compareTo } : null,
      totals: main.totals,
      compareTotals: compare?.totals ?? null,
      byChannel,
      bySku: main.bySku,
      channels: main.channels, // {id,name} present in range — for the SKU channel selector
      trend: main.trend,
    };
  }

  private async aggregate(from: string, to: string, companyId?: string, skuChannelId?: string) {
    const start = new Date(from + 'T00:00:00.000Z');
    const end = new Date(to + 'T23:59:59.999Z');
    const txns = await this.tx.allInRange(start, end, companyId);

    const totals = { revenueExVatEur: 0, revenueIncVatEur: 0, profitEur: 0, feesEur: 0, orders: 0, units: 0, shippingEur: 0, dutyEur: 0, refundEur: 0 };
    const channelMap = new Map<string, any>();
    const skuMap = new Map<string, any>();
    const trendMap = new Map<string, { revenueExVatEur: number; profitEur: number; orders: number }>();

    const spanDays = (end.getTime() - start.getTime()) / 86400000;
    const byMonth = spanDays > 92; // long ranges bucket by month, else by day

    for (const t of txns) {
      const revEx = t.revenueExVatEur ?? 0;
      const revInc = t.revenueIncVatEur ?? 0;
      const fees = t.feesEur ?? 0;
      const profit = t.profit ?? 0;
      const units = t.totals?.quantity ?? 0;

      totals.revenueExVatEur += revEx;
      totals.revenueIncVatEur += revInc;
      totals.profitEur += profit;
      totals.feesEur += fees;
      totals.orders += 1;
      totals.units += units;
      totals.shippingEur += (t.shippingCostSource === 'actual' ? t.actualShippingCost ?? 0 : t.estimatedShippingCost ?? 0) + (t.returnShippingCost ?? 0);
      totals.dutyEur += t.dutyImportCost ?? 0;
      totals.refundEur += t.refundEur ?? 0;

      // Per channel (native + EUR)
      const chId = t.salesChannelId ?? 'none';
      if (!channelMap.has(chId)) {
        channelMap.set(chId, {
          channelId: t.salesChannelId, channelName: t.salesChannel?.name ?? '— No channel', currency: t.currency ?? null,
          revenueExVatNative: 0, revenueIncVatNative: 0, revenueExVatEur: 0, revenueIncVatEur: 0,
          profitEur: 0, feesEur: 0, orders: 0, units: 0,
        });
      }
      const ch = channelMap.get(chId);
      ch.revenueExVatNative += (t.totals?.netSales ?? 0) + (t.totals?.shipping ?? 0);
      ch.revenueIncVatNative += (t.totals?.netSales ?? 0) + (t.totals?.vat ?? 0) + (t.totals?.shipping ?? 0) + (t.totals?.shippingVat ?? 0);
      ch.revenueExVatEur += revEx;
      ch.revenueIncVatEur += revInc;
      ch.profitEur += profit;
      ch.feesEur += fees;
      ch.orders += 1;
      ch.units += units;

      // Per SKU (optionally scoped to one channel)
      if (!skuChannelId || t.salesChannelId === skuChannelId) {
        for (const it of t.items ?? []) {
          const key = it.sku;
          if (!skuMap.has(key)) skuMap.set(key, { sku: it.sku, productTitle: it.productTitle ?? null, revenueExVatEur: 0, revenueIncVatEur: 0, profitEur: 0, feesEur: 0, units: 0, lines: 0 });
          const s = skuMap.get(key);
          s.revenueExVatEur += it.revenueExVatEur ?? 0;
          s.revenueIncVatEur += it.revenueIncVatEur ?? 0;
          s.profitEur += it.profitEur ?? 0;
          s.feesEur += it.feesEur ?? 0;
          s.units += it.quantity ?? 0;
          s.lines += 1;
        }
      }

      // Trend bucket
      const d = new Date(t.date);
      const bucket = byMonth ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : d.toISOString().slice(0, 10);
      if (!trendMap.has(bucket)) trendMap.set(bucket, { revenueExVatEur: 0, profitEur: 0, orders: 0 });
      const tr = trendMap.get(bucket)!;
      tr.revenueExVatEur += revEx;
      tr.profitEur += profit;
      tr.orders += 1;
    }

    const finalizeTotals = {
      ...roundObj(totals),
      profitPct: pct(totals.profitEur, totals.revenueExVatEur),
      avgOrderValueEur: totals.orders ? round(totals.revenueExVatEur / totals.orders) : 0,
    };

    const byChannel = [...channelMap.values()]
      .map((c) => ({ ...roundObj(c), profitPct: pct(c.profitEur, c.revenueExVatEur) }))
      .sort((a, b) => b.revenueExVatEur - a.revenueExVatEur);

    const bySku = [...skuMap.values()]
      .map((s) => ({
        ...roundObj(s),
        profitPct: pct(s.profitEur, s.revenueExVatEur),
        avgFeeEur: s.units ? round(s.feesEur / s.units) : 0,
      }))
      .sort((a, b) => b.revenueExVatEur - a.revenueExVatEur);

    const channels = byChannel.filter((c) => c.channelId).map((c) => ({ id: c.channelId as string, name: c.channelName }));

    const trend = [...trendMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([bucket, v]) => ({ bucket, revenueExVatEur: round(v.revenueExVatEur), profitEur: round(v.profitEur), orders: v.orders }));

    return { totals: finalizeTotals, byChannel, bySku, channels, trend };
  }
}

function roundObj<T extends Record<string, any>>(o: T): T {
  const out: any = { ...o };
  for (const k of Object.keys(out)) if (typeof out[k] === 'number') out[k] = round(out[k]);
  return out;
}

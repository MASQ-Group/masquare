import { Injectable } from '@nestjs/common';
import { SalesTransactionsService } from '../sales-transactions/sales-transactions.service';
import { PrismaService } from '../prisma/prisma.service';

export interface AnalyticsQuery {
  from: string;
  to: string;
  compareFrom?: string;
  compareTo?: string;
  companyId?: string;
  /** Enforced company isolation: the companies the caller may see. */
  companyIds?: string[];
  channelId?: string; // global filter: scope the WHOLE report to one sales channel
  countryId?: string; // global filter: scope the WHOLE report to one destination country
  fulfilment?: string; // global filter: 'fbm' | 'fba' | 'local' (else all)
  skuChannelId?: string; // scope the per-channel SKU breakdown to one channel (else global)
  skuCountryId?: string; // scope the per-country SKU breakdown to one country (else global)
}

/** Does a transaction pass the global channel/country/fulfilment filters? */
function matchesGlobal(t: any, q: { channelId?: string; countryId?: string; fulfilment?: string }): boolean {
  if (q.channelId && t.salesChannelId !== q.channelId) return false;
  if (q.countryId && t.destinationCountryId !== q.countryId) return false;
  if (q.fulfilment && q.fulfilment !== 'all') {
    const f = String(t.fulfilmentType ?? '').toUpperCase();
    if (q.fulfilment === 'fbm' && f !== 'FBM') return false;
    if (q.fulfilment === 'fba' && f !== 'FBA') return false;
    if (q.fulfilment === 'local' && (f === 'FBM' || f === 'FBA')) return false; // local = anything not Amazon-fulfilled
  }
  return true;
}

const round = (v: number, d = 2) => Number(v.toFixed(d));
const pct = (profit: number, base: number) => (base > 0 ? round((profit / base) * 100, 2) : null);

/** Sales analytics/reporting — aggregates the already-computed per-transaction
 *  economics (revenue, fees, profit in EUR) so figures match the transaction view. */
/**
 * Sales quantities are DECIMAL, and `+` on a Prisma Decimal concatenates strings rather than adding
 * — 1 + 2 became "012". Every quantity that reaches a sum goes through this.
 */
const num = (v: unknown) => Number(v ?? 0);

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly tx: SalesTransactionsService,
    // Needed to resolve a SKU to its product and that product's aliases.
    private readonly prisma: PrismaService,
  ) {}

  async report(q: AnalyticsQuery) {
    const main = await this.aggregate(q.from, q.to, q);
    const compare = q.compareFrom && q.compareTo
      ? await this.aggregate(q.compareFrom, q.compareTo, q)
      : null;

    // Merge per-channel compare figures for delta columns.
    const byChannel = main.byChannel.map((c) => {
      const prev = compare?.byChannel.find((p) => p.channelId === c.channelId);
      return { ...c, prevRevenueExVatEur: prev?.revenueExVatEur ?? null, prevProfitEur: prev?.profitEur ?? null, prevReturnedUnits: prev?.returnedUnits ?? null };
    });
    const byCountry = main.byCountry.map((c) => {
      const prev = compare?.byCountry.find((p) => p.countryId === c.countryId);
      return { ...c, prevRevenueExVatEur: prev?.revenueExVatEur ?? null, prevProfitEur: prev?.profitEur ?? null };
    });
    const mergeSkuPrev = (rows: any[], prevRows?: any[]) => rows.map((s) => {
      const prev = prevRows?.find((p) => p.sku === s.sku);
      return { ...s, prevRevenueExVatEur: prev?.revenueExVatEur ?? null, prevProfitEur: prev?.profitEur ?? null };
    });

    return {
      range: { from: q.from, to: q.to },
      compareRange: q.compareFrom && q.compareTo ? { from: q.compareFrom, to: q.compareTo } : null,
      totals: main.totals,
      compareTotals: compare?.totals ?? null,
      byChannel,
      byCountry,
      bySku: mergeSkuPrev(main.bySku, compare?.bySku),
      bySkuByCountry: mergeSkuPrev(main.bySkuByCountry, compare?.bySkuByCountry),
      channels: main.channels, // for the per-channel SKU selector
      countries: main.countries, // for the per-country SKU selector
      trend: main.trend,
      compareTrend: compare?.trend ?? null, // aligned by index for the prev-period overlay
      returns: main.returns,
      compareReturns: compare?.returns ?? null,
    };
  }

  /** Drill-down for one SKU: totals, per-channel breakdown, trend and a returns summary. */
  async skuDetail(q: AnalyticsQuery & { sku: string }) {
    const main = await this.aggregateSku(q.sku, q.from, q.to, q);
    const compare = q.compareFrom && q.compareTo ? await this.aggregateSku(q.sku, q.compareFrom, q.compareTo, q) : null;
    return {
      sku: q.sku,
      productTitle: main.productTitle,
      range: { from: q.from, to: q.to },
      totals: main.totals,
      prevTotals: compare?.totals ?? null,
      byChannel: main.byChannel,
      trend: main.trend,
      returns: main.returns,
    };
  }

  /**
   * Every SKU that means this product: its main SKU and every alias.
   *
   * The same product sells under different SKUs on different channels, so filtering on the string
   * someone clicked shows a fraction of its trade and calls it the whole. Resolved from the
   * catalogue rather than assumed, and falling back to the string itself when nothing matches —
   * an unknown SKU is still a real line in the ledger and should report its own sales.
   */
  private async skuFamily(sku: string): Promise<Set<string>> {
    const needle = sku.trim().toLowerCase();
    const product = await this.prisma.product.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { mainSku: { equals: sku, mode: 'insensitive' } },
          { aliases: { some: { deletedAt: null, skuValue: { equals: sku, mode: 'insensitive' } } } },
        ],
      },
      select: { mainSku: true, aliases: { where: { deletedAt: null }, select: { skuValue: true } } },
    });
    if (!product) return new Set([needle]);
    return new Set([product.mainSku, ...product.aliases.map((a) => a.skuValue)].map((s) => s.trim().toLowerCase()));
  }

  private async aggregateSku(sku: string, from: string, to: string, q: AnalyticsQuery) {
    const start = new Date(from + 'T00:00:00.000Z');
    const end = new Date(to + 'T23:59:59.999Z');
    const txns = (await this.tx.allInRange(start, end, q.companyIds)).filter((t) => matchesGlobal(t, q));
    const family = await this.skuFamily(sku);

    const totals = { revenueExVatEur: 0, revenueIncVatEur: 0, profitEur: 0, feesEur: 0, units: 0, orders: 0 };
    const returns = { returnedUnits: 0, refundEur: 0, orders: 0 };
    let productTitle: string | null = null;
    const channelMap = new Map<string, any>();
    const trendMap = new Map<string, { revenueExVatEur: number; profitEur: number; feesEur: number; units: number }>();
    const spanDays = (end.getTime() - start.getTime()) / 86400000;
    const byMonth = spanDays > 92;

    for (const t of txns) {
      // Every SKU that means this product, not just the one that was clicked.
      const items = (t.items ?? []).filter((it: any) => family.has(String(it.sku ?? '').trim().toLowerCase()));
      if (!items.length) continue;
      totals.orders += 1;
      const isReturned = t.resolution && t.resolution !== 'none';

      let orderUnits = 0;
      for (const it of items) {
        productTitle = productTitle ?? it.productTitle ?? null;
        const rev = it.revenueExVatEur ?? 0;
        totals.revenueExVatEur += rev;
        totals.revenueIncVatEur += it.revenueIncVatEur ?? 0;
        totals.profitEur += it.profitEur ?? 0;
        totals.feesEur += it.feesEur ?? 0;
        totals.units += num(it.quantity);
        orderUnits += num(it.quantity);

        const chId = t.salesChannelId ?? 'none';
        if (!channelMap.has(chId)) channelMap.set(chId, { channelId: t.salesChannelId, channelName: t.salesChannel?.name ?? '— No channel', currency: t.currency ?? null, revenueExVatEur: 0, revenueIncVatEur: 0, profitEur: 0, feesEur: 0, units: 0, ful: new Map<string, number>() });
        const ch = channelMap.get(chId);
        ch.revenueExVatEur += rev;
        ch.revenueIncVatEur += it.revenueIncVatEur ?? 0;
        ch.profitEur += it.profitEur ?? 0;
        ch.feesEur += it.feesEur ?? 0;
        ch.units += num(it.quantity);
        const fLabel = (() => { const f = String(t.fulfilmentType ?? '').toUpperCase(); return f === 'FBM' ? 'FBM' : f === 'FBA' ? 'FBA' : 'Local'; })();
        ch.ful.set(fLabel, (ch.ful.get(fLabel) ?? 0) + num(it.quantity));

        const d = new Date(t.date);
        const bucket = byMonth ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : d.toISOString().slice(0, 10);
        if (!trendMap.has(bucket)) trendMap.set(bucket, { revenueExVatEur: 0, profitEur: 0, feesEur: 0, units: 0 });
        const tr = trendMap.get(bucket)!;
        tr.revenueExVatEur += rev; tr.profitEur += it.profitEur ?? 0; tr.feesEur += it.feesEur ?? 0; tr.units += num(it.quantity);
      }
      if (isReturned) { returns.orders += 1; returns.returnedUnits += orderUnits; returns.refundEur += t.refundEur ?? 0; }
    }

    const finalTotals = {
      ...roundObj(totals),
      profitPct: pct(totals.profitEur, totals.revenueExVatEur),
      avgPriceEur: totals.units ? round(totals.revenueExVatEur / totals.units) : 0,
      feePerUnitEur: totals.units ? round(totals.feesEur / totals.units) : 0,
    };
    const byChannel = [...channelMap.values()].map(({ ful, ...c }) => {
      const fArr = [...(ful as Map<string, number>).entries()].sort((a, b) => b[1] - a[1]);
      return { ...roundObj(c), profitPct: pct(c.profitEur, c.revenueExVatEur), avgPriceEur: c.units ? round(c.revenueExVatEur / c.units) : 0, feePerUnitEur: c.units ? round(c.feesEur / c.units) : 0, fulfilment: fArr[0]?.[0] ?? 'Local' };
    }).sort((a, b) => b.revenueExVatEur - a.revenueExVatEur);
    const trend = [...trendMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([bucket, v]) => ({ bucket, ...roundObj(v), feePerUnitEur: v.units ? round(v.feesEur / v.units) : 0 }));

    return { productTitle, totals: finalTotals, byChannel, trend, returns: roundObj(returns) };
  }

  private async aggregate(from: string, to: string, q: AnalyticsQuery) {
    const { skuChannelId, skuCountryId } = q;
    const start = new Date(from + 'T00:00:00.000Z');
    const end = new Date(to + 'T23:59:59.999Z');
    const allTxns = await this.tx.allInRange(start, end, q.companyIds);
    const txns = allTxns.filter((t) => matchesGlobal(t, q));

    const totals = { revenueExVatEur: 0, revenueIncVatEur: 0, profitEur: 0, feesEur: 0, orders: 0, units: 0, shippingEur: 0, dutyEur: 0, refundEur: 0 };
    const returns = { returnedOrders: 0, returnedUnits: 0, refundEur: 0 };
    const channelMap = new Map<string, any>();
    const countryMap = new Map<string, any>();
    const skuMap = new Map<string, any>();
    const skuCountryMap = new Map<string, any>();
    const trendMap = new Map<string, { revenueExVatEur: number; revenueIncVatEur: number; profitEur: number; feesEur: number; orders: number; units: number; returnedUnits: number }>();

    const spanDays = (end.getTime() - start.getTime()) / 86400000;
    const byMonth = spanDays > 92; // long ranges bucket by month, else by day

    for (const t of txns) {
      const revEx = t.revenueExVatEur ?? 0;
      const revInc = t.revenueIncVatEur ?? 0;
      const fees = t.feesEur ?? 0;
      const profit = t.profit ?? 0;
      const units = t.totals?.quantity ?? 0;
      // A defective order that isn't just a cancellation is a return/refund.
      const isReturn = !!t.resolution && t.resolution !== 'none' && t.resolution !== 'cancelled';

      totals.revenueExVatEur += revEx;
      totals.revenueIncVatEur += revInc;
      totals.profitEur += profit;
      totals.feesEur += fees;
      totals.orders += 1;
      totals.units += units;
      totals.shippingEur += (t.shippingCostSource === 'actual' ? t.actualShippingCost ?? 0 : t.estimatedShippingCost ?? 0) + (t.returnShippingCost ?? 0);
      totals.dutyEur += t.dutyImportCost ?? 0;
      totals.refundEur += t.refundEur ?? 0;
      if (isReturn) { returns.returnedOrders += 1; returns.returnedUnits += units; returns.refundEur += t.refundEur ?? 0; }

      // Per channel (native + EUR)
      const chId = t.salesChannelId ?? 'none';
      if (!channelMap.has(chId)) {
        channelMap.set(chId, {
          channelId: t.salesChannelId, channelName: t.salesChannel?.name ?? '— No channel', currency: t.currency ?? null,
          revenueExVatNative: 0, revenueIncVatNative: 0, revenueExVatEur: 0, revenueIncVatEur: 0,
          profitEur: 0, feesEur: 0, orders: 0, units: 0, returnedUnits: 0, refundEur: 0, ful: new Map<string, any>(),
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
      // Fulfilment split within the channel (for the expandable FBM / FBA / Local rows).
      const fLabel = (() => { const f = String(t.fulfilmentType ?? '').toUpperCase(); return f === 'FBM' ? 'FBM' : f === 'FBA' ? 'FBA' : 'Local'; })();
      if (!ch.ful.has(fLabel)) ch.ful.set(fLabel, { fulfilment: fLabel, revenueExVatEur: 0, revenueIncVatEur: 0, profitEur: 0, feesEur: 0, orders: 0, units: 0 });
      const cf = ch.ful.get(fLabel);
      cf.revenueExVatEur += revEx; cf.revenueIncVatEur += revInc; cf.profitEur += profit; cf.feesEur += fees; cf.orders += 1; cf.units += units;
      ch.units += units;
      if (isReturn) { ch.returnedUnits += units; ch.refundEur += t.refundEur ?? 0; }

      // Per destination country (EUR — a country spans multiple channel currencies)
      const coId = t.destinationCountryId ?? 'none';
      if (!countryMap.has(coId)) {
        countryMap.set(coId, {
          countryId: t.destinationCountryId, countryName: t.destinationCountry?.name ?? '— No destination',
          revenueExVatEur: 0, revenueIncVatEur: 0, profitEur: 0, feesEur: 0, orders: 0, units: 0,
        });
      }
      const co = countryMap.get(coId);
      co.revenueExVatEur += revEx;
      co.revenueIncVatEur += revInc;
      co.profitEur += profit;
      co.feesEur += fees;
      co.orders += 1;
      co.units += units;

      const addSku = (map: Map<string, any>, it: any) => {
        // Group by the PRODUCT, not the SKU string it happened to sell under.
        //
        // The same product is listed under different SKUs on different channels — RE-S8540 and
        // NK-S8450 are one thing shipped to one marketplace under two labels. Keying on the string
        // split one product into several rows, each showing a fraction of its sales, so nothing on
        // the page added up to the product a person had in mind.
        //
        // An unmatched line has no product, and there the SKU is all we know — so it keeps its own
        // row rather than being merged into a bucket it does not belong to.
        const key = it.productId ?? 'sku:' + String(it.sku ?? '').trim().toLowerCase();
        if (!map.has(key)) map.set(key, { sku: it.sku, productId: it.productId ?? null, productTitle: it.productTitle ?? null, revenueExVatEur: 0, revenueIncVatEur: 0, profitEur: 0, feesEur: 0, units: 0, returnedUnits: 0, lines: 0 });
        const s = map.get(key);
        s.revenueExVatEur += it.revenueExVatEur ?? 0;
        s.revenueIncVatEur += it.revenueIncVatEur ?? 0;
        s.profitEur += it.profitEur ?? 0;
        s.feesEur += it.feesEur ?? 0;
        s.units += num(it.quantity);
        s.returnedUnits += isReturn ? num(it.quantity) : 0;
        s.lines += 1;
        // A row named after whichever alias arrived first is a coin toss. Prefer the product's own
        // title, and keep the SKU that matches it where we can tell.
        if (!s.productTitle && it.productTitle) s.productTitle = it.productTitle;
      };

      // Per SKU — global or scoped to one channel
      if (!skuChannelId || t.salesChannelId === skuChannelId) for (const it of t.items ?? []) addSku(skuMap, it);
      // Per SKU — global or scoped to one destination country
      if (!skuCountryId || t.destinationCountryId === skuCountryId) for (const it of t.items ?? []) addSku(skuCountryMap, it);

      // Trend bucket
      const d = new Date(t.date);
      const bucket = byMonth ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : d.toISOString().slice(0, 10);
      if (!trendMap.has(bucket)) trendMap.set(bucket, { revenueExVatEur: 0, revenueIncVatEur: 0, profitEur: 0, feesEur: 0, orders: 0, units: 0, returnedUnits: 0 });
      const tr = trendMap.get(bucket)!;
      tr.revenueExVatEur += revEx;
      tr.revenueIncVatEur += revInc;
      tr.profitEur += profit;
      tr.feesEur += fees;
      tr.orders += 1;
      tr.units += units;
      tr.returnedUnits += isReturn ? units : 0;
    }

    const finalizeTotals = {
      ...roundObj(totals),
      profitPct: pct(totals.profitEur, totals.revenueExVatEur),
      avgOrderValueEur: totals.orders ? round(totals.revenueExVatEur / totals.orders) : 0,
    };

    const byChannel = [...channelMap.values()]
      .map(({ ful, ...c }) => ({
        ...roundObj(c),
        profitPct: pct(c.profitEur, c.revenueExVatEur),
        fulfilments: [...(ful as Map<string, any>).values()]
          .map((f) => ({ ...roundObj(f), profitPct: pct(f.profitEur, f.revenueExVatEur) }))
          .sort((a, b) => b.revenueExVatEur - a.revenueExVatEur),
      }))
      .sort((a, b) => b.revenueExVatEur - a.revenueExVatEur);

    const byCountry = [...countryMap.values()]
      .map((c) => ({ ...roundObj(c), profitPct: pct(c.profitEur, c.revenueExVatEur) }))
      .sort((a, b) => b.revenueExVatEur - a.revenueExVatEur);

    const finalizeSku = (map: Map<string, any>) => [...map.values()]
      .map((s) => ({ ...roundObj(s), profitPct: pct(s.profitEur, s.revenueExVatEur), avgFeeEur: s.units ? round(s.feesEur / s.units) : 0 }))
      .sort((a, b) => b.revenueExVatEur - a.revenueExVatEur);
    const bySku = finalizeSku(skuMap);
    const bySkuByCountry = finalizeSku(skuCountryMap);

    const channels = byChannel.filter((c) => c.channelId).map((c) => ({ id: c.channelId as string, name: c.channelName }));
    const countries = byCountry.filter((c) => c.countryId).map((c) => ({ id: c.countryId as string, name: c.countryName }));

    const trend = [...trendMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([bucket, v]) => ({
        bucket,
        revenueExVatEur: round(v.revenueExVatEur),
        revenueIncVatEur: round(v.revenueIncVatEur),
        profitEur: round(v.profitEur),
        feesEur: round(v.feesEur),
        orders: v.orders,
        units: v.units,
        returnedUnits: v.returnedUnits,
        avgOrderValueEur: v.orders ? round(v.revenueExVatEur / v.orders) : 0,
      }));

    return { totals: finalizeTotals, byChannel, byCountry, bySku, bySkuByCountry, channels, countries, trend, returns: roundObj(returns) };
  }
}

function roundObj<T extends Record<string, any>>(o: T): T {
  const out: any = { ...o };
  for (const k of Object.keys(out)) if (typeof out[k] === 'number') out[k] = round(out[k]);
  return out;
}

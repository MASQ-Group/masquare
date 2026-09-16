import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ISO_TO_MARKETPLACE, MARKETPLACE_TO_ISO } from '../config/repricing.config';
import { PriceRangeService, type RangeFilters } from '../ops/price-range.service';
import { combineStoredBasis, spanOf, stride, summariseBySku, summarisePeriod, totalsOf, type DailyRow, type PeriodSummary } from './report-fold';

/**
 * Reading the repricing statistics: the cross-SKU table, one SKU's history, and the spreadsheet.
 *
 * Separate from the service that writes them, and on this side of the module wall, because reading
 * wants the same "which SKUs do you mean" filters as the bulk price-range tools — marketplace,
 * brand, vendor, product type, search, state — and reusing them is better than a second dialect of
 * the same filter. The recorder must keep depending on nothing.
 *
 * Aggregation happens in Postgres, not here: a year of a thousand SKUs is a third of a million daily
 * rows, and a report that reads them all to show thirty is a page that gets slower every month. The
 * totals are aggregated over everything the filter matches; only the rows on screen are folded in
 * full, which is what makes the per-SKU price open/close exact.
 */

export interface ReportQuery extends RangeFilters {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** The most SKUs one spreadsheet carries — the same ceiling the bulk tools use. */
const EXPORT_CAP = 5000;
/** Enough of the market samples to draw a faithful line without shipping a year of them. */
const MAX_CHART_SAMPLES = 800;
const MAX_CHART_PRICES = 2000;

@Injectable()
export class RepricingReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ranges: PriceRangeService,
  ) {}

  // ── the cross-SKU table ──────────────────────────────────────────────────────────────────────

  async report(q: ReportQuery) {
    const span = spanOf(q);
    const where = await this.whereFor(q, span);
    if (!where) return { ...span, items: [], totals: totalsOf([]), skus: 0 };

    // One row per SKU across the whole filter: small (one per SKU, not per SKU-day), and it decides
    // both the order and how many there are before any daily row is read.
    const groups = await this.prisma.repricingDailyStat.groupBy({
      by: ['sku', 'marketplaceId'],
      where,
      _sum: { revenueCents: true, evaluations: true },
    });
    const ordered = groups.sort(
      (a, b) =>
        (b._sum.revenueCents ?? 0) - (a._sum.revenueCents ?? 0) ||
        (b._sum.evaluations ?? 0) - (a._sum.evaluations ?? 0) ||
        a.sku.localeCompare(b.sku),
    );
    const limit = Math.max(1, Math.min(200, Number(q.limit) || 50));
    const offset = Math.max(0, Number(q.offset) || 0);
    const page = ordered.slice(offset, offset + limit);

    const items = await this.foldPage(page, where);
    return { ...span, items, totals: await this.totals(where, ordered.length), skus: ordered.length };
  }

  /** One SKU, in full: the days, the exact prices, and how the market looked while they changed. */
  async skuDetail(q: { sku: string; marketplace?: string; from?: string; to?: string }) {
    const span = spanOf(q);
    const marketplaceId = q.marketplace ? ISO_TO_MARKETPLACE[q.marketplace.trim().toUpperCase()] : undefined;
    if (q.marketplace && !marketplaceId) return null;
    const sku = q.sku?.trim();
    if (!sku) return null;

    const rows = await this.prisma.repricingDailyStat.findMany({
      where: { sku, ...(marketplaceId ? { marketplaceId } : {}), day: { gte: span.from, lte: span.to } },
      orderBy: { day: 'asc' },
      take: 400,
    });
    // Which marketplace we are actually looking at: the one asked for, else the one with days in it.
    const mkt = marketplaceId ?? rows[0]?.marketplaceId;
    if (!mkt) return { ...span, sku, marketplaceId: null, listing: null, summary: null, daily: [], prices: [], samples: [] };
    const daily = rows.filter((r) => r.marketplaceId === mkt);

    const at = { gte: span.from, lte: endOfDay(span.to) };
    const [prices, sampleRows, listing] = await Promise.all([
      this.prisma.channelPriceHistory.findMany({
        where: { channelSku: sku, marketplaceId: mkt, at },
        orderBy: { at: 'asc' },
        take: MAX_CHART_PRICES,
        select: { at: true, priceCents: true, previousPriceCents: true, currency: true, source: true, decisionId: true },
      }),
      this.prisma.repricingMarketSample.findMany({
        where: { sku, marketplaceId: mkt, at },
        orderBy: { at: 'asc' },
        select: { at: true, ourPriceCents: true, buyBoxLandedCents: true, weHoldBuyBox: true, competitorCount: true, lowestCompetitorCents: true, floorCents: true },
      }),
      this.prisma.repricingSkuPricing.findFirst({
        where: { sku, marketplaceId: mkt, deletedAt: null },
        select: {
          id: true, asin: true, currency: true, automationState: true, productId: true,
          currentPriceCents: true, strategyFloorCents: true, minPriceCents: true, maxPriceCents: true, breakevenCents: true,
        },
      }),
    ]);

    const product = listing?.productId
      ? await this.prisma.product.findFirst({
        where: { id: listing.productId },
        select: { id: true, title: true, mainSku: true, brand: { select: { name: true } } },
      })
      : null;

    return {
      ...span,
      sku,
      marketplaceId: mkt,
      marketplace: MARKETPLACE_TO_ISO[mkt] ?? mkt,
      listing: listing ? { ...listing, product } : null,
      summary: daily.length ? summarisePeriod(daily as DailyRow[]) : null,
      daily,
      prices,
      samples: stride(sampleRows, MAX_CHART_SAMPLES),
    };
  }

  // ── the spreadsheet ──────────────────────────────────────────────────────────────────────────

  /** Every SKU the filter matches, as flat rows. Read-only; the web turns them into the file. */
  async exportRows(q: ReportQuery) {
    const span = spanOf(q);
    const where = await this.whereFor(q, span);
    if (!where) return { rows: [] };
    const groups = await this.prisma.repricingDailyStat.groupBy({ by: ['sku', 'marketplaceId'], where, _sum: { revenueCents: true } });
    const items = await this.foldPage(groups.slice(0, EXPORT_CAP), where);
    const money = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
    const pct = (p: number | null) => (p == null ? '' : p);
    return {
      rows: items.map((r) => ({
        'SKU': r.sku,
        'Marketplace': MARKETPLACE_TO_ISO[r.marketplaceId] ?? r.marketplaceId,
        'ASIN': r.asin ?? '',
        'Product': r.productName ?? '',
        'Brand': r.brand ?? '',
        'State': r.state ?? '',
        'Currency': r.currency ?? '',
        'Days with data': r.days,
        'Evaluations': r.evaluations,
        'Priced': r.priced,
        'Held': r.held,
        'Skipped': r.skipped,
        'Quarantined': r.quarantined,
        'Vetoed': r.vetoed,
        'Price changes': r.priceChanges,
        'Price at start': money(r.priceOpenCents),
        'Price at end': money(r.priceCloseCents),
        'Lowest price': money(r.priceMinCents),
        'Highest price': money(r.priceMaxCents),
        'Price move %': pct(r.priceMovePct),
        'Buy Box samples': r.buyBoxSamples,
        'Buy Box won': r.buyBoxWon,
        'Buy Box win %': pct(r.buyBoxWinPct),
        'At floor %': pct(r.atFloorPct),
        'Units sold': r.unitsSold,
        'Units after a change': r.unitsAfterChange,
        'Sold after a change %': pct(r.afterChangePct),
        'Revenue': money(r.revenueCents),
        'Profit': money(r.profitCents),
        'Margin %': pct(r.marginPct),
        'Fees': r.feeBasis ?? '',
      })),
    };
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  /**
   * The daily rows the filter selects.
   *
   * The SKU filters live on the pricing table, not on the statistics, so they resolve to a list of
   * SKUs first. A SKU name is unique per marketplace but not across them, so the pair is kept and
   * the selection is narrowed again after folding — `sku IN (…) AND marketplace IN (…)` alone would
   * let a SKU through on a marketplace the filter excluded.
   */
  private async whereFor(q: ReportQuery, span: { from: Date; to: Date }): Promise<Prisma.RepricingDailyStatWhereInput | null> {
    const day = { gte: span.from, lte: span.to };
    const narrowing = q.marketplace || q.brandId || q.vendorId || q.productTypeId || q.q || q.state || q.skuPricingIds?.length;
    if (!narrowing) return { day };

    const where = await this.ranges.where(q);
    if (!where) return null;
    const listings = await this.prisma.repricingSkuPricing.findMany({ where, select: { sku: true, marketplaceId: true }, take: EXPORT_CAP });
    if (listings.length === 0) return null;

    const markets = [...new Set(listings.map((l) => l.marketplaceId))];
    // One OR term per marketplace, each carrying its own SKU list: precise, and a handful of terms
    // rather than one per SKU.
    return {
      day,
      OR: markets.map((marketplaceId) => ({
        marketplaceId,
        sku: { in: listings.filter((l) => l.marketplaceId === marketplaceId).map((l) => l.sku) },
      })),
    };
  }

  /** Fold the days of the SKUs on this page, and hang the listing's own facts off each row. */
  private async foldPage(page: { sku: string; marketplaceId: string }[], where: Prisma.RepricingDailyStatWhereInput) {
    if (page.length === 0) return [];
    const wanted = new Set(page.map((p) => `${p.marketplaceId}|${p.sku}`));
    const rows = await this.prisma.repricingDailyStat.findMany({
      where: {
        AND: [
          where,
          { sku: { in: [...new Set(page.map((p) => p.sku))] } },
          { marketplaceId: { in: [...new Set(page.map((p) => p.marketplaceId))] } },
        ],
      },
      orderBy: { day: 'asc' },
    });
    const summaries = summariseBySku(rows.filter((r) => wanted.has(`${r.marketplaceId}|${r.sku}`)) as DailyRow[]);

    const listings = await this.prisma.repricingSkuPricing.findMany({
      where: {
        deletedAt: null,
        sku: { in: [...new Set(summaries.map((s) => s.sku))] },
        marketplaceId: { in: [...new Set(summaries.map((s) => s.marketplaceId))] },
      },
      select: { id: true, sku: true, marketplaceId: true, asin: true, automationState: true, currentPriceCents: true, strategyFloorCents: true, productId: true, currency: true },
    });
    const byKey = new Map(listings.map((l) => [`${l.marketplaceId}|${l.sku}`, l]));
    const products = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(listings.map((l) => l.productId).filter(Boolean) as string[])] } },
      select: { id: true, title: true, brand: { select: { name: true } } },
    });
    const byProduct = new Map(products.map((p) => [p.id, p]));

    return summaries.map((s) => {
      const listing = byKey.get(`${s.marketplaceId}|${s.sku}`);
      const product = listing?.productId ? byProduct.get(listing.productId) : undefined;
      return {
        ...s,
        marketplace: MARKETPLACE_TO_ISO[s.marketplaceId] ?? s.marketplaceId,
        skuPricingId: listing?.id ?? null,
        asin: listing?.asin ?? null,
        state: listing?.automationState ?? null,
        currentPriceCents: listing?.currentPriceCents ?? null,
        floorCents: listing?.strategyFloorCents ?? null,
        productName: product?.title ?? null,
        brand: product?.brand?.name ?? null,
        currency: s.currency ?? listing?.currency ?? null,
      };
    });
  }

  /**
   * The headline figures, over everything the filter matches rather than the page on screen.
   *
   * Summed in Postgres and then passed through the same fold as a row, so a rate on the header and
   * the same rate on a row can never be worked out two different ways.
   */
  private async totals(where: Prisma.RepricingDailyStatWhereInput, skus: number) {
    const [agg, bases] = await Promise.all([
      this.prisma.repricingDailyStat.aggregate({
        where,
        _sum: {
          evaluations: true, priced: true, held: true, skipped: true, quarantined: true, vetoed: true,
          priceChanges: true, buyBoxSamples: true, buyBoxWon: true, atFloorSamples: true,
          unitsSold: true, revenueCents: true, profitCents: true, unitsAfterChange: true,
        },
      }),
      this.prisma.repricingDailyStat.groupBy({ by: ['feeBasis'], where: { AND: [where, { unitsSold: { gt: 0 } }] } }),
    ]);
    const n = (v: number | null | undefined) => v ?? 0;
    const asOneRow: PeriodSummary = {
      sku: '', marketplaceId: '', days: 0, firstDay: null, lastDay: null,
      evaluations: n(agg._sum.evaluations), priced: n(agg._sum.priced), held: n(agg._sum.held),
      skipped: n(agg._sum.skipped), quarantined: n(agg._sum.quarantined), vetoed: n(agg._sum.vetoed),
      priceChanges: n(agg._sum.priceChanges),
      priceOpenCents: null, priceCloseCents: null, priceMinCents: null, priceMaxCents: null, priceMovePct: null,
      buyBoxSamples: n(agg._sum.buyBoxSamples), buyBoxWon: n(agg._sum.buyBoxWon), buyBoxWinPct: null,
      atFloorSamples: n(agg._sum.atFloorSamples), atFloorPct: null,
      unitsSold: n(agg._sum.unitsSold), revenueCents: n(agg._sum.revenueCents),
      // Null, not zero, when nothing sold: an empty span has no profit rather than a profit of nothing.
      profitCents: n(agg._sum.unitsSold) > 0 ? n(agg._sum.profitCents) : null,
      marginPct: null,
      feeBasis: combineStoredBasis(bases.map((b) => b.feeBasis)),
      unitsAfterChange: n(agg._sum.unitsAfterChange), afterChangePct: null,
      currency: null,
    };
    return { ...totalsOf([asOneRow]), skus, feeBasis: asOneRow.feeBasis };
  }
}

/** The last instant of a day, for the raw tables, which are timestamped rather than dated. */
const endOfDay = (d: Date) => new Date(d.getTime() + 86_399_999);

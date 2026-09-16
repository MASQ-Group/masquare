import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { saleLineProfit, type FeeBasis } from './sale-line-profit';
import { dayOf, foldDay, DEFAULT_ATTRIBUTION_HOURS, type PriceEvent } from './daily-fold';
import { MARKETPLACE_TO_ISO } from '../config/repricing.config';

/**
 * Recording what the repricer did, and rolling it up into something a report can read.
 *
 * Two jobs, deliberately together: whoever adds a new place that changes a price adds a line here,
 * and the rollup is the only reader of those tables, so the meaning of a "price change" or a "Buy
 * Box win" is settled once (daily-fold.ts) rather than per screen.
 *
 * Nothing here may break the thing it observes: every recording call is caught and logged. A
 * missing statistic is a nuisance; a failed price write because of a statistic is not acceptable.
 */
/**
 * How far back the nightly rebuild reaches. Long enough for Amazon's fees to settle into the days
 * they belong to, short enough that the job stays a few seconds of work.
 */
const ROLLING_REBUILD_DAYS = 7;

@Injectable()
export class RepricingAnalyticsService {
  private readonly logger = new Logger(RepricingAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── recording ──────────────────────────────────────────────────────────────────────────────────

  /**
   * A price a listing now carries. Unchanged prices are not recorded: a sync that confirms
   * yesterday's figure is not history, and recording it would bury the changes among thousands of
   * rows saying nothing happened.
   */
  async recordPrice(p: {
    channelSku: string;
    marketplaceId?: string | null;
    priceCents: number;
    currency: string;
    source: 'repricer' | 'manual_push' | 'listing_sync' | 'listing_created';
    integrationId?: string | null;
    companyId?: string | null;
    productId?: string | null;
    decisionId?: string | null;
    at?: Date;
  }): Promise<void> {
    try {
      if (!Number.isFinite(p.priceCents) || p.priceCents <= 0) return;
      const marketplaceId = p.marketplaceId ?? '';
      const last = await this.prisma.channelPriceHistory.findFirst({
        where: { channelSku: p.channelSku, marketplaceId },
        orderBy: { at: 'desc' },
        select: { priceCents: true },
      });
      if (last?.priceCents === p.priceCents) return;
      await this.prisma.channelPriceHistory.create({
        data: {
          channelSku: p.channelSku,
          marketplaceId,
          priceCents: p.priceCents,
          previousPriceCents: last?.priceCents ?? null,
          currency: p.currency,
          source: p.source,
          integrationId: p.integrationId ?? null,
          companyId: p.companyId ?? null,
          productId: p.productId ?? null,
          decisionId: p.decisionId ?? null,
          at: p.at ?? new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(`Price history not recorded for ${p.channelSku}: ${(e as Error).message}`);
    }
  }

  /** What the market looked like at one evaluation. */
  async recordSample(s: {
    sku: string;
    marketplaceId: string;
    asin?: string | null;
    ourPriceCents?: number | null;
    buyBoxLandedCents?: number | null;
    weHoldBuyBox: boolean;
    competitorCount: number;
    lowestCompetitorCents?: number | null;
    floorCents?: number | null;
    decisionId?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.repricingMarketSample.create({
        data: {
          sku: s.sku,
          marketplaceId: s.marketplaceId,
          asin: s.asin ?? null,
          ourPriceCents: s.ourPriceCents ?? null,
          buyBoxLandedCents: s.buyBoxLandedCents ?? null,
          weHoldBuyBox: s.weHoldBuyBox,
          competitorCount: s.competitorCount,
          lowestCompetitorCents: s.lowestCompetitorCents ?? null,
          floorCents: s.floorCents ?? null,
          decisionId: s.decisionId ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`Market sample not recorded for ${s.sku}: ${(e as Error).message}`);
    }
  }

  // ── rolling up ─────────────────────────────────────────────────────────────────────────────────

  /**
   * The last week, rebuilt every night.
   *
   * Not just yesterday: Amazon settles its fees days after the order, so a day costed from the
   * referral estimate becomes a day costed from the real fee — but only if something recomputes it.
   * A rolling week picks that up without anybody asking, and today is included because a day is
   * only complete at midnight and a report opened at noon should still show the morning.
   *
   * Anything older than the week, or a change to the folding rules, is a deliberate rebuild.
   */
  @Cron('25 1 * * *')
  async nightly(): Promise<{ days: number; rows: number }> {
    const result = await this.backfill(ROLLING_REBUILD_DAYS);
    this.logger.log(`Repricing rollup: ${result.rows} row(s) across ${result.days} day(s)`);
    return result;
  }

  /** Rebuild the summaries for the last `days` days, newest first. For a backfill after a change. */
  async backfill(days: number): Promise<{ days: number; rows: number }> {
    const start = dayOf(new Date());
    let rows = 0;
    const span = Math.max(1, Math.min(400, Math.trunc(days)));
    for (let i = 0; i < span; i += 1) {
      rows += await this.rollupDay(new Date(start.getTime() - i * 86_400_000));
    }
    return { days: span, rows };
  }

  /**
   * Rebuild one day. Idempotent: reads the raw events, folds them, writes one row per SKU and
   * marketplace that saw anything at all. A day with no activity writes nothing rather than a page
   * of zeroes.
   */
  async rollupDay(day: Date): Promise<number> {
    const from = dayOf(day);
    const to = new Date(from.getTime() + 86_400_000);
    const windowStart = new Date(from.getTime() - DEFAULT_ATTRIBUTION_HOURS * 60 * 60 * 1000);

    const [decisions, prices, samples, earlierChanges] = await Promise.all([
      this.prisma.repricingDecision.findMany({
        where: { at: { gte: from, lt: to } },
        select: { sku: true, marketplaceId: true, at: true, outcome: true, safetyVerdict: true },
      }),
      this.prisma.channelPriceHistory.findMany({
        where: { at: { gte: from, lt: to } },
        select: { channelSku: true, marketplaceId: true, at: true, priceCents: true, source: true, currency: true, productId: true },
      }),
      this.prisma.repricingMarketSample.findMany({
        where: { at: { gte: from, lt: to } },
        select: { sku: true, marketplaceId: true, at: true, ourPriceCents: true, weHoldBuyBox: true, floorCents: true },
      }),
      this.prisma.channelPriceHistory.findMany({
        where: { at: { gte: windowStart, lt: from }, source: 'repricer' },
        select: { channelSku: true, marketplaceId: true, at: true, priceCents: true, source: true },
      }),
    ]);

    const sales = await this.salesFor(from, to);

    /** Every SKU × marketplace that did anything today. */
    const keys = new Set<string>([
      ...decisions.map((d) => `${d.sku}|${d.marketplaceId}`),
      ...prices.map((p) => `${p.channelSku}|${p.marketplaceId}`),
      ...samples.map((s) => `${s.sku}|${s.marketplaceId}`),
      ...sales.map((s) => `${s.sku}|${s.marketplaceId}`),
    ]);
    if (keys.size === 0) return 0;

    // The price each listing carried when the day began: the last one recorded before it.
    const openings = new Map<string, number>();
    for (const key of keys) {
      const [channelSku, marketplaceId] = key.split('|');
      const before = await this.prisma.channelPriceHistory.findFirst({
        where: { channelSku, marketplaceId, at: { lt: from } },
        orderBy: { at: 'desc' },
        select: { priceCents: true },
      });
      if (before) openings.set(key, before.priceCents);
    }

    let written = 0;
    for (const key of keys) {
      const [sku, marketplaceId] = key.split('|');
      const dayPrices = prices.filter((p) => p.channelSku === sku && p.marketplaceId === marketplaceId);
      const daySales = sales.filter((s) => s.sku === sku && s.marketplaceId === marketplaceId);
      const fold = foldDay({
        decisions: decisions
          .filter((d) => d.sku === sku && d.marketplaceId === marketplaceId)
          .map((d) => ({ at: d.at, outcome: d.outcome, vetoed: isVeto(d.safetyVerdict) })),
        prices: dayPrices.map((p) => ({ at: p.at, priceCents: p.priceCents, source: p.source })),
        samples: samples
          .filter((s) => s.sku === sku && s.marketplaceId === marketplaceId)
          .map((s) => ({ at: s.at, ourPriceCents: s.ourPriceCents, weHoldBuyBox: s.weHoldBuyBox, floorCents: s.floorCents })),
        sales: daySales,
        priceBeforeDayCents: openings.get(key) ?? null,
        changesBeforeDay: earlierChanges
          .filter((p) => p.channelSku === sku && p.marketplaceId === marketplaceId)
          .map((p): PriceEvent => ({ at: p.at, priceCents: p.priceCents, source: p.source })),
      });

      const productId = dayPrices.find((p) => p.productId)?.productId ?? daySales.find((s) => s.productId)?.productId ?? null;
      const currency = dayPrices[0]?.currency ?? null;
      const existing = await this.prisma.repricingDailyStat.findUnique({
        where: { day_sku_marketplaceId: { day: from, sku, marketplaceId } },
        select: { id: true },
      });
      const data = { ...fold, productId, currency, computedAt: new Date() };
      if (existing) await this.prisma.repricingDailyStat.update({ where: { id: existing.id }, data });
      else await this.prisma.repricingDailyStat.create({ data: { day: from, sku, marketplaceId, ...data } });
      written += 1;
    }
    return written;
  }

  /**
   * The day's Amazon sale lines, each with the profit it earned at the time.
   *
   * Matched to a marketplace through the repricing rows, because a sale carries our SKU and a sales
   * channel, not Amazon's marketplace id. A sale for a SKU the repricer has never seen is not part
   * of a repricing report and is left out.
   */
  private async salesFor(from: Date, to: Date) {
    const rows = await this.prisma.repricingSkuPricing.findMany({
      where: { deletedAt: null },
      select: { sku: true, marketplaceId: true, productId: true },
    });
    if (rows.length === 0) return [];
    const marketplaceBySku = new Map<string, { marketplaceId: string; productId: string | null }[]>();
    for (const r of rows) {
      const list = marketplaceBySku.get(r.sku) ?? [];
      list.push({ marketplaceId: r.marketplaceId, productId: r.productId });
      marketplaceBySku.set(r.sku, list);
    }

    const items = await this.prisma.salesTransactionItem.findMany({
      where: {
        deletedAt: null,
        sku: { in: [...marketplaceBySku.keys()] },
        transaction: { deletedAt: null, date: { gte: from, lt: to } },
      },
      select: {
        sku: true, quantity: true, netSalesAmount: true, shippingAmount: true,
        salesChannelSalesFeeAmount: true, fbaFulfilmentFeeAmount: true, amazonPointsAmount: true,
        unitCostSnapshotEur: true, productId: true,
        transaction: { select: { date: true, exchangeRate: true, feeExchangeRate: true, salesChannel: { select: { name: true, generalSalesFeePct: true } } } },
      },
    });

    const out: { sku: string; marketplaceId: string; productId: string | null; at: Date; units: number; revenueCents: number; profitCents: number; feeBasis: FeeBasis }[] = [];
    for (const it of items) {
      const candidates = marketplaceBySku.get(it.sku) ?? [];
      // A SKU listed on several marketplaces: the sale's own channel names the country, so match on
      // it; where it cannot be told apart, the sale is counted once against the first marketplace
      // rather than several times.
      const channelName = it.transaction.salesChannel?.name ?? '';
      const match = candidates.find((c) => channelName.toUpperCase().includes(MARKETPLACE_TO_ISO[c.marketplaceId] ?? '@')) ?? candidates[0];
      if (!match) continue;
      const estimatedFeePct = it.transaction.salesChannel?.generalSalesFeePct != null
        ? Number(it.transaction.salesChannel.generalSalesFeePct) / 100
        : null;
      const p = saleLineProfit(
        {
          quantity: Number(it.quantity),
          netSalesAmount: it.netSalesAmount,
          shippingAmount: it.shippingAmount,
          salesChannelSalesFeeAmount: it.salesChannelSalesFeeAmount,
          fbaFulfilmentFeeAmount: it.fbaFulfilmentFeeAmount,
          amazonPointsAmount: it.amazonPointsAmount,
          unitCostSnapshotEur: it.unitCostSnapshotEur != null ? Number(it.unitCostSnapshotEur) : null,
        },
        { exchangeRate: it.transaction.exchangeRate, feeExchangeRate: it.transaction.feeExchangeRate, estimatedFeePct },
      );
      out.push({
        sku: it.sku,
        marketplaceId: match.marketplaceId,
        productId: it.productId ?? match.productId,
        at: it.transaction.date,
        units: Math.round(Number(it.quantity)),
        revenueCents: p.revenueCents,
        profitCents: p.profitCents,
        feeBasis: p.feeBasis,
      });
    }
    return out;
  }

  /**
   * Raw events older than the retention window, removed. The daily summaries are never purged: they
   * are what a year-on-year comparison reads, and they are small.
   */
  @Cron('45 2 * * *')
  async purgeRaw(): Promise<{ prices: number; samples: number }> {
    const settings = await this.prisma.platformSettings.findFirst({ select: { repricingDecisionRetentionDays: true } });
    const days = settings?.repricingDecisionRetentionDays ?? 365;
    const before = new Date(Date.now() - days * 86_400_000);
    const prices = await this.prisma.channelPriceHistory.deleteMany({ where: { at: { lt: before } } });
    const samples = await this.prisma.repricingMarketSample.deleteMany({ where: { at: { lt: before } } });
    if (prices.count || samples.count) {
      this.logger.log(`Purged ${prices.count} price(s) and ${samples.count} sample(s) older than ${days} days`);
    }
    return { prices: prices.count, samples: samples.count };
  }
}

/** The safety layer refused a price it was handed. */
function isVeto(verdict: unknown): boolean {
  return !!verdict && typeof verdict === 'object' && (verdict as { ok?: boolean }).ok === false;
}


import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AutomationState, MarketSnapshot } from './types';
import { RepricerConfig, buildDecideInput } from './mapping';
import { decide, Decision } from './decision-core';
import { PriceWriterService } from '../writer/price-writer.service';
import { medianCents } from '../common/median';
import { detectUndercutLoop, UndercutEvent } from './undercut-loop';
import { REPRICING_DEFAULTS } from '../config/repricing.config';

/** Trailing window for the Buy-Box reference median behind the §6.1 anomalous-competitor guard. */
const MEDIAN_WINDOW_DAYS = 7;

// The repricer I/O shell (spec §5.1, findings §G) — the thin layer around the pure decision core.
// For one fresh snapshot it: loads our SKU rows on that ASIN × marketplace + the blocklist, builds
// the DecideInput (mapping.ts), runs decide(), and appends a RepricingDecision audit row (§6.6).
//
// SHADOW MODE (spec §6.5): this logs the INTENDED price and submits NOTHING — there is no
// price-writer call here. The safety layer (§6.3) and the actual write are the price-writer's job
// (a later phase). Volatile pricing state is left untouched except lastEventAt.

const ENGINE_VERSION = 'repricer-1.0.0';

/** What caused this evaluation (spec §2.3). safetyOverride bypasses the cooldown (§5.6). */
export interface EvalTrigger {
  triggerType: string; // ANY_OFFER_CHANGED | PRICING_HEALTH | FEE_PROMOTION | HOLD_TIMER | BACKFILL | MANUAL | ERP_EVENT
  notificationId?: string | null;
  safetyOverride?: boolean;
}

@Injectable()
export class RepricerService {
  private readonly logger = new Logger(RepricerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: PriceWriterService,
  ) {}

  /** Evaluate every one of our SKUs on this ASIN × marketplace against a fresh snapshot. */
  async evaluate(snapshot: MarketSnapshot, trigger: EvalTrigger): Promise<number> {
    const rows = await this.prisma.repricingSkuPricing.findMany({
      where: { asin: snapshot.asin, marketplaceId: snapshot.marketplaceId, deletedAt: null },
    });
    if (rows.length === 0) return 0;

    // Blocklist for this marketplace plus globally-blocked sellers (§5.2).
    const blocked = await this.prisma.repricingBlockedSeller.findMany({
      where: { active: true, OR: [{ marketplaceId: snapshot.marketplaceId }, { marketplaceId: null }] },
      select: { sellerId: true },
    });
    const blocklistedSellerIds = blocked.map((b) => b.sellerId);
    const amazonRetailSellerIds: string[] = []; // `TO VERIFY` EU Amazon-Retail SellerIds (§5.2)
    const nowMs = Date.now();

    // Trailing Buy-Box reference median for the §6.1 anomalous-competitor guard. Computed once per
    // ASIN × marketplace from our own decision history, plus this event's observation so a listing
    // with no history still has a reference. Null (nothing observed) simply leaves the guard off.
    const medianBuyBoxLandedCents = await this.trailingBuyBoxMedian(snapshot, nowMs);

    // §5.4 C-5 undercut-loop guard: if a repeat offender is looping us on this listing, hold rather
    // than chase. One offender per listing, so compute once and apply to all our SKU rows on it.
    const loop = detectUndercutLoop(await this.trailingUndercutEvents(snapshot, nowMs), {
      count: REPRICING_DEFAULTS.undercutLoopCount,
      windowMs: REPRICING_DEFAULTS.undercutLoopWindowMinutes * 60 * 1000,
      quietMs: REPRICING_DEFAULTS.undercutLoopQuietHours * 60 * 60 * 1000,
      nowMs,
    });
    if (loop.hold) {
      this.logger.warn(
        `Undercut loop on ${snapshot.asin}:${snapshot.marketplaceId} — holding; offender ${loop.offenderSellerId} (${loop.offenderCount}× in ${REPRICING_DEFAULTS.undercutLoopWindowMinutes}m). Consider blocklisting.`,
      );
    }

    // §5.4 C-1: effective-competitor count at the previous evaluation for this listing — decide()
    // compares it to the fresh set to probe up faster when a competitor has left / stocked out.
    const prevCompetitorCount = await this.previousCompetitorCount(snapshot);

    let count = 0;
    for (const row of rows) {
      try {
        await this.evaluateRow(row, snapshot, trigger, blocklistedSellerIds, amazonRetailSellerIds, nowMs, medianBuyBoxLandedCents, loop.hold, prevCompetitorCount);
        count += 1;
      } catch (e) {
        this.logger.error(`Evaluation failed for ${row.sku}:${row.marketplaceId}: ${(e as Error).message}`);
      }
    }
    return count;
  }

  /** Median Buy Box landed over the trailing window for this ASIN × marketplace (our decision
   *  history), including the current observation. Null when nothing has ever been observed. */
  private async trailingBuyBoxMedian(snapshot: MarketSnapshot, nowMs: number): Promise<number | null> {
    if (snapshot.asin == null) return snapshot.buyBoxLandedCents ?? null;
    const since = new Date(nowMs - MEDIAN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const history = await this.prisma.repricingDecision.findMany({
      where: {
        asin: snapshot.asin,
        marketplaceId: snapshot.marketplaceId,
        at: { gte: since },
        buyBoxLandedCents: { not: null },
      },
      select: { buyBoxLandedCents: true },
    });
    const values = history.map((h) => h.buyBoxLandedCents as number);
    if (snapshot.buyBoxLandedCents != null) values.push(snapshot.buyBoxLandedCents);
    return medianCents(values);
  }

  /** Reconstruct undercut events for this listing from our decision history over the quiet window:
   *  a decision whose lowest effective competitor was priced below our then-current price is one
   *  undercut by that seller. Feeds the §5.4 C-5 loop detector without needing a separate table. */
  private async trailingUndercutEvents(snapshot: MarketSnapshot, nowMs: number): Promise<UndercutEvent[]> {
    if (snapshot.asin == null) return [];
    const since = new Date(nowMs - REPRICING_DEFAULTS.undercutLoopQuietHours * 60 * 60 * 1000);
    const decisions = await this.prisma.repricingDecision.findMany({
      where: { asin: snapshot.asin, marketplaceId: snapshot.marketplaceId, at: { gte: since } },
      select: { at: true, beforePriceCents: true, competitorSet: true },
      orderBy: { at: 'asc' },
    });
    const events: UndercutEvent[] = [];
    for (const d of decisions) {
      const cs = d.competitorSet as { effective?: { sellerId: string; listingPriceCents?: number; shippingCents?: number }[] } | null;
      const lowest = cs?.effective?.[0];
      if (!lowest || d.beforePriceCents == null) continue;
      const landed = (lowest.listingPriceCents ?? 0) + (lowest.shippingCents ?? 0);
      if (landed < d.beforePriceCents) events.push({ atMs: d.at.getTime(), sellerId: lowest.sellerId });
    }
    return events;
  }

  /** Effective-competitor count from the most recent prior decision for this listing (§5.4 C-1),
   *  or null if there's no history yet. */
  private async previousCompetitorCount(snapshot: MarketSnapshot): Promise<number | null> {
    if (snapshot.asin == null) return null;
    const last = await this.prisma.repricingDecision.findFirst({
      where: { asin: snapshot.asin, marketplaceId: snapshot.marketplaceId, competitorSet: { not: Prisma.JsonNull } },
      select: { competitorSet: true },
      orderBy: { at: 'desc' },
    });
    const cs = last?.competitorSet as { effective?: unknown[] } | null;
    return Array.isArray(cs?.effective) ? cs!.effective.length : null;
  }

  private async evaluateRow(
    row: Prisma.RepricingSkuPricingGetPayload<object>,
    snapshot: MarketSnapshot,
    trigger: EvalTrigger,
    blocklistedSellerIds: string[],
    amazonRetailSellerIds: string[],
    nowMs: number,
    medianBuyBoxLandedCents: number | null,
    holdForLoop: boolean,
    prevCompetitorCount: number | null,
  ): Promise<void> {
    const cfg = this.toConfig(row);

    // A SKU flagged suppressed by a prior PRICING_HEALTH evaluates in Branch D until a fresh event
    // shows our offer is Featured again (spec §5.3). Clear the flag on restoration; thread it into
    // the snapshot otherwise (never mutate the shared snapshot — clone per row).
    const restored = snapshot.offers.some((o) => o.sellerId === snapshot.ourSellerId && o.isBuyBoxWinner);
    if (row.suppressed && restored) {
      await this.prisma.repricingSkuPricing.update({ where: { id: row.id }, data: { suppressed: false } });
    }
    const evalSnapshot = row.suppressed && !restored ? { ...snapshot, pricingHealthFired: true } : snapshot;

    const built = buildDecideInput(cfg, evalSnapshot, {
      blocklistedSellerIds,
      amazonRetailSellerIds,
      nowMs,
      safetyOverride: trigger.safetyOverride,
      medianBuyBoxLandedCents,
      holdForLoop,
      prevCompetitorCount,
    });

    if ('skip' in built) {
      await this.persistDecision(row, snapshot, trigger, {
        outcome: 'SKIPPED',
        branch: null,
        competitorSet: null,
        rawTargetCents: null,
        finalPriceCents: null,
        clampSteps: [],
        reason: built.skip,
        alert: false,
      });
      return;
    }

    const decision = decide(built);
    const decisionId = await this.persistDecision(row, snapshot, trigger, decision, cfg);
    await this.prisma.repricingSkuPricing.update({ where: { id: row.id }, data: { lastEventAt: new Date() } });

    // Only a LIVE SKU with a priced decision and a known floor reaches the price-writer — and the
    // writer STILL only previews unless the master switch is on and its own safety layer passes.
    // Every other state is shadow: the decision is logged, nothing is submitted (§6.5).
    if (
      decision.outcome === 'PRICED' &&
      decision.finalPriceCents != null &&
      row.automationState === 'LIVE' &&
      row.breakevenCents != null
    ) {
      await this.writer
        .submit({
          decisionId,
          skuPricingId: row.id,
          sku: row.sku,
          marketplaceId: row.marketplaceId,
          currency: row.currency,
          automationState: row.automationState as AutomationState,
          intendedPriceCents: decision.finalPriceCents,
          breakevenCents: row.breakevenCents,
          mapCents: row.mapCents,
          currentPriceCents: row.currentPriceCents,
          amazonMinAllowedCents: row.amazonMinAllowedCents,
          amazonMaxAllowedCents: row.amazonMaxAllowedCents,
        })
        .catch((e) => this.logger.error(`Price-writer failed for ${row.sku}:${row.marketplaceId}: ${(e as Error).message}`));
    }
  }

  private async persistDecision(
    row: Prisma.RepricingSkuPricingGetPayload<object>,
    snapshot: MarketSnapshot,
    trigger: EvalTrigger,
    decision: Decision,
    cfg?: RepricerConfig,
  ): Promise<string> {
    const created = await this.prisma.repricingDecision.create({
      data: {
        sku: row.sku,
        marketplaceId: row.marketplaceId,
        asin: row.asin,
        triggerType: trigger.triggerType,
        notificationId: trigger.notificationId ?? null,
        timeOfOfferChange: snapshot.timeOfOfferChange ? new Date(snapshot.timeOfOfferChange) : null,
        branch: decision.branch,
        strategy: row.strategy,
        outcome: decision.outcome,
        rawTargetCents: decision.rawTargetCents,
        finalPriceCents: decision.finalPriceCents,
        beforePriceCents: row.currentPriceCents,
        buyBoxLandedCents: snapshot.buyBoxLandedCents ?? null,
        clamps: (decision.clampSteps as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        competitorSet: (decision.competitorSet as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        safetyVerdict: Prisma.JsonNull, // filled by the price-writer's safety layer (later phase)
        engineVersion: ENGINE_VERSION,
        configHash: cfg ? this.hash(cfg) : null,
        inputsHash: this.hash({ snapshot, reason: decision.reason }),
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Prisma row → engine config, converting Decimal percents (1.00 = 1%) to fractions (0.01). */
  private toConfig(row: Prisma.RepricingSkuPricingGetPayload<object>): RepricerConfig {
    const frac = (d: Prisma.Decimal | null): number | null => (d != null ? Number(d) / 100 : null);
    return {
      sku: row.sku,
      asin: row.asin,
      marketplaceId: row.marketplaceId,
      currency: row.currency,
      fulfillment: row.fulfillment,
      strategy: row.strategy as RepricerConfig['strategy'],
      automationState: row.automationState as RepricerConfig['automationState'],
      breakevenCents: row.breakevenCents,
      strategyFloorCents: row.strategyFloorCents,
      maxPriceCents: row.maxPriceCents,
      mapCents: row.mapCents,
      fairPricingCeilingCents: row.fairPricingCeilingCents,
      amazonMinAllowedCents: row.amazonMinAllowedCents,
      amazonMaxAllowedCents: row.amazonMaxAllowedCents,
      currentPriceCents: row.currentPriceCents,
      holdingBuyBox: row.holdingBuyBox,
      probeAnchorCents: row.probeAnchorCents,
      lastSubmissionAtMs: row.lastSubmissionAt ? row.lastSubmissionAt.getTime() : null,
      epsilonCents: row.epsilonCents,
      cooldownSeconds: row.cooldownSeconds,
      probeStepPct: frac(row.probeStepPct),
      fbmPremiumPct: frac(row.fbmPremiumPct),
    };
  }

  private hash(obj: unknown): string {
    return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
  }
}

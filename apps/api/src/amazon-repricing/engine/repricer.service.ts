import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketSnapshot } from './types';
import { RepricerConfig, buildDecideInput } from './mapping';
import { decide, Decision } from './decision-core';

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

  constructor(private readonly prisma: PrismaService) {}

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

    let count = 0;
    for (const row of rows) {
      try {
        await this.evaluateRow(row, snapshot, trigger, blocklistedSellerIds, amazonRetailSellerIds, nowMs);
        count += 1;
      } catch (e) {
        this.logger.error(`Evaluation failed for ${row.sku}:${row.marketplaceId}: ${(e as Error).message}`);
      }
    }
    return count;
  }

  private async evaluateRow(
    row: Prisma.RepricingSkuPricingGetPayload<object>,
    snapshot: MarketSnapshot,
    trigger: EvalTrigger,
    blocklistedSellerIds: string[],
    amazonRetailSellerIds: string[],
    nowMs: number,
  ): Promise<void> {
    const cfg = this.toConfig(row);
    const built = buildDecideInput(cfg, snapshot, { blocklistedSellerIds, amazonRetailSellerIds, nowMs, safetyOverride: trigger.safetyOverride });

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
    await this.persistDecision(row, snapshot, trigger, decision, cfg);
    // Shadow mode: no submission, no pricing-state mutation — only record that we saw this event.
    await this.prisma.repricingSkuPricing.update({ where: { id: row.id }, data: { lastEventAt: new Date() } });
  }

  private async persistDecision(
    row: Prisma.RepricingSkuPricingGetPayload<object>,
    snapshot: MarketSnapshot,
    trigger: EvalTrigger,
    decision: Decision,
    cfg?: RepricerConfig,
  ): Promise<void> {
    await this.prisma.repricingDecision.create({
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
        clamps: (decision.clampSteps as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        competitorSet: (decision.competitorSet as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        safetyVerdict: Prisma.JsonNull, // filled by the price-writer's safety layer (later phase)
        engineVersion: ENGINE_VERSION,
        configHash: cfg ? this.hash(cfg) : null,
        inputsHash: this.hash({ snapshot, reason: decision.reason }),
      },
    });
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

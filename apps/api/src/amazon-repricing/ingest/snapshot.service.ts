import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ParseError, ParsedNotification, isStaleEvent, parseAnyOfferChanged, parseFeePromotion, parsePricingHealth } from './parser';
import { RawNotificationEnvelope } from './any-offer-changed.types';
import { RepricerService } from '../engine/repricer.service';
import { FloorService } from '../floor/floor.service';

// notif-ingest persistence + routing (spec §2.2–2.3): dedupe on NotificationId, then dispatch by
// notification type — ANY_OFFER_CHANGED → snapshot + shadow evaluate; PRICING_HEALTH → mark the
// SKU for Branch D (restore eligibility, §5.3); FEE_PROMOTION → recompute floors (§4.3). The pure
// parse/stale logic lives in parser.ts; this is the thin I/O shell over Prisma.

export type IngestResult =
  | { status: 'DUPLICATE' }
  | { status: 'STALE' }
  | { status: 'PARSE_ERROR'; detail: string }
  | { status: 'PERSISTED'; asin: string; marketplaceId: string }
  | { status: 'PRICING_HEALTH'; affected: number }
  | { status: 'FEE_PROMOTION'; marketplaceId: string }
  | { status: 'IGNORED'; reason: string };

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repricer: RepricerService,
    private readonly floors: FloorService,
  ) {}

  /** Parse a raw SQS message body (JSON) and route by notification type. Entry point for the poller. */
  async ingestRaw(body: string): Promise<IngestResult> {
    let envelope: RawNotificationEnvelope;
    try {
      envelope = JSON.parse(body);
    } catch (e) {
      return { status: 'PARSE_ERROR', detail: `invalid JSON: ${(e as Error).message}` };
    }
    try {
      const type = envelope.NotificationType ?? '';
      if (type === 'PricingHealth' || type === 'PRICING_HEALTH') return await this.ingestPricingHealth(envelope);
      if (type === 'FeePromotion' || type === 'FEE_PROMOTION') return await this.ingestFeePromotion(envelope);
      // Default: ANY_OFFER_CHANGED (also covers an absent type on an AOC-shaped body).
      return await this.ingest(parseAnyOfferChanged(envelope));
    } catch (e) {
      if (e instanceof ParseError) return { status: 'PARSE_ERROR', detail: e.message };
      throw e;
    }
  }

  /** PRICING_HEALTH (spec §5.3): we lost Featured-Offer eligibility. Mark the SKU(s) suppressed so
   *  the next evaluation runs Branch D. P1 — suppression also silently kills ad delivery (§1.5). */
  private async ingestPricingHealth(envelope: RawNotificationEnvelope): Promise<IngestResult> {
    const ev = parsePricingHealth(envelope);
    if (ev.notificationId && !(await this.recordNotificationId(ev.notificationId, 'PricingHealth'))) return { status: 'DUPLICATE' };
    if (!ev.marketplaceId || (!ev.sku && !ev.asin)) return { status: 'IGNORED', reason: 'PRICING_HEALTH missing marketplace/sku/asin' };
    const updated = await this.prisma.repricingSkuPricing.updateMany({
      where: { marketplaceId: ev.marketplaceId, deletedAt: null, ...(ev.sku ? { sku: ev.sku } : { asin: ev.asin! }) },
      data: { suppressed: true },
    });
    this.logger.warn(`PRICING_HEALTH (P1) ${ev.marketplaceId} ${ev.sku ?? ev.asin} — ${updated.count} SKU(s) → Branch D.`);
    return { status: 'PRICING_HEALTH', affected: updated.count };
  }

  /** FEE_PROMOTION (spec §4.3): a fee schedule change → recompute floors for the marketplace. Fired
   *  in the background so the poller isn't blocked; the nightly cron is the backstop. */
  private async ingestFeePromotion(envelope: RawNotificationEnvelope): Promise<IngestResult> {
    const ev = parseFeePromotion(envelope);
    if (ev.notificationId && !(await this.recordNotificationId(ev.notificationId, 'FeePromotion'))) return { status: 'DUPLICATE' };
    if (!ev.marketplaceId) return { status: 'IGNORED', reason: 'FEE_PROMOTION missing marketplace' };
    void this.recomputeMarketplaceFloors(ev.marketplaceId);
    return { status: 'FEE_PROMOTION', marketplaceId: ev.marketplaceId };
  }

  private async recomputeMarketplaceFloors(marketplaceId: string): Promise<void> {
    const rows = await this.prisma.repricingSkuPricing.findMany({ where: { marketplaceId, deletedAt: null }, select: { id: true } });
    let ok = 0;
    for (const { id } of rows) {
      await this.floors.refreshFeesAndRecompute(id).then(() => (ok += 1)).catch((e) => this.logger.error(`Fee-promo recompute failed for ${id}: ${(e as Error).message}`));
    }
    this.logger.log(`FEE_PROMOTION ${marketplaceId} — recomputed ${ok}/${rows.length} floors.`);
  }

  /** Dedupe → stale-discard → persist snapshot. Idempotent per NotificationId. */
  async ingest(parsed: ParsedNotification): Promise<IngestResult> {
    // 1. Dedupe on NotificationId (spec §2.2). A duplicate delivery is a no-op.
    if (parsed.notificationId) {
      const fresh = await this.recordNotificationId(parsed.notificationId, parsed.notificationType);
      if (!fresh) return { status: 'DUPLICATE' };
    }

    const snapshotId = `${parsed.asin}:${parsed.marketplaceId}`;

    // 2. Stale-event discard (spec §5.7): drop events not newer than the stored snapshot.
    const existing = await this.prisma.repricingOfferSnapshot.findUnique({
      where: { asin_marketplaceId: { asin: parsed.asin, marketplaceId: parsed.marketplaceId } },
      select: { timeOfOfferChange: true },
    });
    if (existing && isStaleEvent(parsed.timeOfOfferChange, existing.timeOfOfferChange.toISOString())) {
      this.logger.debug(`Stale event for ${snapshotId} (${parsed.timeOfOfferChange}) — discarded.`);
      return { status: 'STALE' };
    }

    // 3. Upsert the latest market picture.
    await this.prisma.repricingOfferSnapshot.upsert({
      where: { asin_marketplaceId: { asin: parsed.asin, marketplaceId: parsed.marketplaceId } },
      create: {
        asin: parsed.asin,
        marketplaceId: parsed.marketplaceId,
        timeOfOfferChange: new Date(parsed.timeOfOfferChange),
        summary: (parsed.summaryRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        offers: (parsed.offersRaw ?? []) as Prisma.InputJsonValue,
        source: 'ANY_OFFER_CHANGED',
      },
      update: {
        timeOfOfferChange: new Date(parsed.timeOfOfferChange),
        summary: (parsed.summaryRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        offers: (parsed.offersRaw ?? []) as Prisma.InputJsonValue,
        source: 'ANY_OFFER_CHANGED',
      },
    });

    // Trigger a shadow evaluation of our SKU(s) on this listing (spec §6.5 — logs the intended
    // price, submits nothing). A work-queue with per-ASIN ordering + a 30s debounce window (§5.1)
    // is the eventual decoupling (Deviation D-1); for now, low single-seller volume, we evaluate
    // inline and never let an evaluation failure fail the ingest.
    try {
      await this.repricer.evaluate(parsed.snapshot, {
        triggerType: 'ANY_OFFER_CHANGED',
        notificationId: parsed.notificationId,
        safetyOverride: false,
      });
    } catch (e) {
      this.logger.error(`Shadow evaluation failed for ${snapshotId}: ${(e as Error).message}`);
    }

    return { status: 'PERSISTED', asin: parsed.asin, marketplaceId: parsed.marketplaceId };
  }

  /**
   * Insert the NotificationId into the dedupe table. Returns true if this is the FIRST time we've
   * seen it, false if it was already there (duplicate). Relies on the unique constraint so the
   * check-and-insert is atomic against redelivery races.
   */
  private async recordNotificationId(notificationId: string, type: string | null): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // TTL 24h (§4.1), swept by cron
    try {
      await this.prisma.repricingNotifDedupe.create({
        data: { notificationId, notificationType: type, receivedAt: now, expiresAt },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false; // duplicate
      throw e;
    }
  }
}

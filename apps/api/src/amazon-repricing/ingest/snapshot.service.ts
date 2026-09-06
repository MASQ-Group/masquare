import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ParseError, ParsedNotification, isStaleEvent, parseAnyOfferChanged, parseFeePromotion, parsePricingHealth } from './parser';
import { RawNotificationEnvelope } from './any-offer-changed.types';
import { FloorService } from '../floor/floor.service';
import { RepriceSchedulerService } from './reprice-scheduler.service';

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
    private readonly scheduler: RepriceSchedulerService,
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

    /**
     * Unwrap an SNS delivery.
     *
     * SP-API can publish to SQS directly, or to an SNS topic that fans out to one. Through SNS the
     * body is SNS's own envelope and the notification is a JSON STRING inside `Message`:
     *
     *   { "Type": "Notification", "TopicArn": "...", "Message": "{\"NotificationType\":...}" }
     *
     * Read as-is that has no NotificationType and no Payload, so it fell through to the
     * ANY_OFFER_CHANGED parser and failed with `missing MarketplaceId` — an error naming a
     * notification type the message never claimed to be.
     *
     * Unwrapping is safe whether or not it applies: a direct SP-API body has no `Type: Notification`
     * and is left exactly as it was.
     */
    const sns = envelope as unknown as { Type?: string; Message?: unknown };
    if (sns.Type === 'Notification' && typeof sns.Message === 'string') {
      try {
        envelope = JSON.parse(sns.Message);
      } catch (e) {
        return { status: 'PARSE_ERROR', detail: `SNS Message is not JSON: ${(e as Error).message}` };
      }
    }

    // SNS subscription handshakes arrive on the same queue and are not notifications at all.
    if (sns.Type === 'SubscriptionConfirmation' || sns.Type === 'UnsubscribeConfirmation') {
      return { status: 'IGNORED', reason: `SNS ${sns.Type} — confirm it in the AWS console, not here` };
    }

    try {
      const type = envelope.NotificationType ?? '';
      if (type === 'PricingHealth' || type === 'PRICING_HEALTH') return await this.ingestPricingHealth(envelope);
      if (type === 'FeePromotion' || type === 'FEE_PROMOTION') return await this.ingestFeePromotion(envelope);

      /**
       * ORDER_CHANGE is subscribed on purpose and used by nothing here.
       *
       * It exists as a positive control: it fires on ordinary daily sales, so it proves the
       * Amazon -> SQS path is alive when the pricing notifications are quiet and we otherwise
       * cannot tell "no events" from "events not arriving". Repricing reads none of it.
       *
       * It used to fall through to the ANY_OFFER_CHANGED parser, which of course found no
       * OfferChangeTrigger and reported `ANY_OFFER_CHANGED missing MarketplaceId` at ERROR — so
       * the heartbeat we deliberately asked for looked like a stream of broken messages, and an
       * error log that cries wolf is one nobody reads when something real breaks.
       */
      if (type === 'OrderChange' || type === 'ORDER_CHANGE') {
        return { status: 'IGNORED', reason: 'ORDER_CHANGE — delivery heartbeat, not used by repricing' };
      }

      /**
       * Anything else is a type we do not handle, and saying so is the useful thing.
       *
       * Only an ABSENT type still falls through to ANY_OFFER_CHANGED, because Amazon does send
       * AOC-shaped bodies without one. A named type we do not know is reported by name instead of
       * being mis-parsed and blamed on AOC.
       */
      if (type && type !== 'AnyOfferChanged' && type !== 'ANY_OFFER_CHANGED') {
        return { status: 'IGNORED', reason: `unhandled notification type ${type}` };
      }

      return await this.ingest(parseAnyOfferChanged(envelope));
    } catch (e) {
      if (e instanceof ParseError) {
        // The shape, not the contents: enough to identify what arrived next time without putting
        // order or customer data into the log.
        const keys = Object.keys(envelope ?? {}).slice(0, 12).join(',');
        const named = envelope?.NotificationType ? ` type=${envelope.NotificationType}` : ' type=(absent)';
        return { status: 'PARSE_ERROR', detail: `${e.message}${named} keys=[${keys}]` };
      }
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

    // Coalesce the evaluation into this listing's debounce window (spec §5.1 step 0): a single
    // price move fires ANY_OFFER_CHANGED for every seller, so we persist each event but evaluate
    // the LATEST snapshot once per window (default 30s), shadow-only. Non-blocking — scheduling
    // never fails the ingest, and an evaluation error is logged inside the scheduler.
    this.scheduler.schedule(parsed.snapshot, parsed.notificationId);

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

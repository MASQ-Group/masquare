import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ParseError, ParsedNotification, isStaleEvent, parseAnyOfferChanged } from './parser';
import { RawNotificationEnvelope } from './any-offer-changed.types';

// notif-ingest persistence (spec §2.2): dedupe on NotificationId, discard stale events, and upsert
// the latest OfferSnapshot per ASIN × marketplace. The pure parse + stale logic lives in parser.ts;
// this is the thin I/O shell over Prisma. Enqueueing the repricing evaluation onto the work-queue
// (Deviation D-1) is a follow-up once the engine I/O shell lands — marked below.

export type IngestResult =
  | { status: 'DUPLICATE' }
  | { status: 'STALE' }
  | { status: 'PARSE_ERROR'; detail: string }
  | { status: 'PERSISTED'; asin: string; marketplaceId: string };

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Parse a raw SQS message body (JSON) and ingest it. The wireable entry point for the poller. */
  async ingestRaw(body: string): Promise<IngestResult> {
    let envelope: RawNotificationEnvelope;
    try {
      envelope = JSON.parse(body);
    } catch (e) {
      return { status: 'PARSE_ERROR', detail: `invalid JSON: ${(e as Error).message}` };
    }
    let parsed: ParsedNotification;
    try {
      parsed = parseAnyOfferChanged(envelope);
    } catch (e) {
      if (e instanceof ParseError) return { status: 'PARSE_ERROR', detail: e.message };
      throw e;
    }
    return this.ingest(parsed);
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

    // TODO(Phase 2): enqueue an evaluation onto the repricing work-queue with ordering key
    // `${asin}:${marketplaceId}` (Deviation D-1) once the engine I/O shell exists.

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

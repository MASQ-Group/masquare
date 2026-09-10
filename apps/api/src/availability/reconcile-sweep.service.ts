import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from './availability.service';
import type { ChannelListingsService } from '../channel-listings/channel-listings.service';

/**
 * The safety net under the push queue.
 *
 * The queue fixes the fault it can see: a scheduled push that a restart would have dropped. It
 * cannot fix the ones it never hears about — a push made before any of this existed, a listing
 * changed on the marketplace's own side, a rejection that exhausted its attempts, a sale whose
 * sell-through never ran because the setting was off at the time. All of those end the same way,
 * with a channel advertising a quantity we do not hold, and none of them leaves anything in a queue.
 *
 * So this compares the two numbers instead of trusting any record of intent, and re-queues what
 * disagrees. It goes through the SAME queue rather than pushing directly: one path to the
 * marketplaces, one place where attempts, ceilings and failures are recorded.
 *
 * ── Off until somebody turns it on ──────────────────────────────────────────────
 * `autoCorrectChannelQuantity` defaults false and the sweep only reports while it is. That is not
 * timidity: correcting means writing quantities to live listings on the platform's own judgement,
 * and a push that was confidently wrong is how roughly five thousand listings were emptied on 4
 * August. The worklist accumulates real findings first; enabling it afterwards is a decision made
 * with evidence rather than in advance of any.
 */
@Injectable()
export class ReconcileSweepService {
  private readonly logger = new Logger(ReconcileSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Resolved lazily by string token, with only a TYPE import of the class.
   *
   * Importing ChannelListingsModule here closes the cycle integrations -> sales-transactions ->
   * channel-listings -> integrations. Nest does not fail the build for it; it fails at boot, with
   * ChannelListingsModule's first import resolving to undefined. The sell-through reaches the same
   * service the same way and for the same reason.
   */
  private listings(): ChannelListingsService {
    return this.moduleRef.get<ChannelListingsService>('CHANNEL_LISTINGS_SERVICE', { strict: false });
  }

  /**
   * Hourly, off the hour.
   *
   * Frequent enough that a dropped push is corrected within the hour rather than the day, and far
   * enough from the daily channel sync (05:00) and the listing sweep (every five minutes) that they
   * are not all reading the same tables at once.
   */
  @Cron('40 * * * *')
  async run() {
    const settings = await this.prisma.platformSettings.findFirst({
      select: { autoCorrectChannelQuantity: true, autoAdjustAvailabilityOnSale: true },
    });

    /**
     * If sales are not allowed to move availability, correcting toward it would be arguing from a
     * figure the platform itself does not maintain. The comparison is still worth reporting; acting
     * on it is not.
     */
    const mayCorrect = !!settings?.autoCorrectChannelQuantity && !!settings?.autoAdjustAvailabilityOnSale;

    // Company-wide by design: this is the platform reconciling itself, not a user reading a page.
    const drift = await this.availability.drift({ pageSize: 200 });
    if (drift.total === 0) {
      this.logger.log('Reconcile sweep: every channel agrees with what we hold.');
      return { drifted: 0, queued: 0, corrected: false };
    }

    if (!mayCorrect) {
      const why = settings?.autoCorrectChannelQuantity
        ? 'sales do not adjust availability, so there is no figure to correct toward'
        : 'auto-correct is off';
      this.logger.warn(
        `Reconcile sweep: ${drift.total} product(s) and ${drift.channelCount} listing(s) are out of step — reporting only (${why}).`,
      );
      return { drifted: drift.total, queued: 0, corrected: false };
    }

    /**
     * Queued, not pushed. Everything that reaches a marketplace goes through one path, so the
     * attempt ceiling and the failure record apply to a sweep correction exactly as they do to a
     * sale's — otherwise a permanently rejected SKU would be retried hourly, for ever, invisibly.
     */
    const ids = drift.items.map((d) => d.productId);
    this.listings().schedulePush(ids, 'reconcile_sweep');
    this.logger.log(`Reconcile sweep: queued ${ids.length} product(s) of ${drift.total} out of step.`);
    return { drifted: drift.total, queued: ids.length, corrected: true };
  }
}

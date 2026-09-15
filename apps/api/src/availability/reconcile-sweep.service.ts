import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AvailabilityService } from './availability.service';

/**
 * An hourly look at what the channels advertise against what we hold. It reports; it never pushes.
 *
 * It used to re-queue whatever disagreed when a setting allowed it. That is the platform writing
 * quantities to live listings on its own judgement, and under the business's rules a quantity
 * reaches a channel only when a person presses Push to channels or an order lowers availability
 * (order-availability-rules.ts). What it finds is on Availability → Out of step with channels.
 */
@Injectable()
export class ReconcileSweepService {
  private readonly logger = new Logger(ReconcileSweepService.name);

  constructor(private readonly availability: AvailabilityService) {}

  /** Hourly, off the hour, away from the daily channel sync and the five-minute listing sweep. */
  @Cron('40 * * * *')
  async run() {
    /**
     * Reports only. It used to be able to re-send quantities it judged wrong, and that is a push
     * nobody asked for: a quantity reaches a channel only when a person presses Push, or when an
     * order lowers availability (order-availability-rules.ts). What it finds is the Out of step
     * worklist, where a person decides.
     */
    const drift = await this.availability.drift({ pageSize: 200 });
    if (drift.total === 0) {
      this.logger.log('Reconcile sweep: every channel agrees with what we hold.');
      return { drifted: 0 };
    }
    this.logger.warn(
      `Reconcile sweep: ${drift.total} product(s) and ${drift.channelCount} listing(s) are out of step — see Availability → Out of step with channels.`,
    );
    return { drifted: drift.total };
  }
}

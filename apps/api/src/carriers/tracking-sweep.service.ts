import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CarriersService } from './carriers.service';

/**
 * The tracking sweep.
 *
 * There is no webhook to have instead. FedEx's push product, Advanced Integrated Visibility, is
 * sold to US accounts only and has no EU purchase path (handoff §2.3), so a status that keeps
 * itself current has to be fetched — which makes this file the difference between tracking that is
 * a feature and tracking that is a button somebody has to remember to press.
 *
 * Its own service rather than another method on CarriersService, for the same reason the address
 * retention sweep has one: this is the only thing in the module that runs unattended, and a
 * scheduled job that quietly stops running is far easier to notice when it has a file of its own.
 */
@Injectable()
export class TrackingSweepService {
  private readonly logger = new Logger(TrackingSweepService.name);

  constructor(private readonly carriers: CarriersService) {}

  /**
   * Every two hours, off the hour.
   *
   * The cadence that decides how fresh a status is lives in `dueForRefresh`, not here — six hours
   * for a parcel in its first fortnight, daily after that. This only has to run often enough that
   * something due is picked up soon after it becomes due, and two hours does that with a wide
   * margin. Off the hour to keep it clear of the order syncs.
   *
   * Bounded at 300 shipments, which is ten FedEx calls against a daily allowance of 100,000. The
   * bound is not about quota — it is so that a first run over a long backlog cannot sit on the
   * database or on FedEx for minutes. A backlog simply takes a few passes to clear.
   */
  @Cron('20 */2 * * *')
  async sweep(): Promise<void> {
    try {
      const r = await this.carriers.refreshTracking({ limit: 300 });
      /**
       * Logged even when nothing was due.
       *
       * "The sweep ran and everything was current" and "the sweep has not run since Tuesday" look
       * identical in a log that only records action, and the second is the one worth knowing.
       */
      this.logger.log(
        `Tracking sweep: ${r.updated} updated of ${r.due} due (${r.considered} considered), ` +
          `${r.delivered} delivered, ${r.notFound} not recognised, ${r.unaccounted} with no account, ` +
          `${r.failedCalls} calls refused.`,
      );
      // FedEx's own words, once, rather than per batch — a refusal that repeats across ten batches
      // is one problem, and ten identical lines make it look like ten.
      for (const m of [...new Set(r.messages)]) this.logger.warn(`Tracking sweep: ${m}`);
    } catch (e) {
      this.logger.error(`Tracking sweep failed: ${(e as Error)?.message ?? e}`);
    }
  }
}

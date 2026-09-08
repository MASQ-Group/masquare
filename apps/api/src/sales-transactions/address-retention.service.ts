import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SalesTransactionsService } from './sales-transactions.service';

/**
 * The retention sweep for delivery addresses.
 *
 * A policy that depends on somebody remembering is not a policy, so this runs on its own and says
 * what it did. Twelve months from despatch — see ADDRESS_RETENTION_DAYS for where the number came
 * from, which was our own returns data rather than a round figure.
 *
 * Its own service rather than another method on the transactions service: this is the only thing in
 * the module that runs unattended, and a scheduled job that quietly stops running is much easier to
 * notice when it has a file of its own.
 */
@Injectable()
export class AddressRetentionService {
  private readonly logger = new Logger(AddressRetentionService.name);

  constructor(private readonly sales: SalesTransactionsService) {}

  /**
   * Nightly, well away from the order syncs.
   *
   * Once a day is often enough for a period measured in months, and batched so that the first run
   * over a long backlog cannot sit on the database. A backlog simply takes a few nights to clear,
   * which is a better failure than one long transaction.
   */
  @Cron('30 3 * * *')
  async nightly(): Promise<void> {
    try {
      const r = await this.sales.purgeExpiredAddresses();
      // Logged even at zero, once a night, because "the sweep ran and found nothing due" and "the
      // sweep has not run for a fortnight" look identical in a log that only records action.
      this.logger.log(`Address retention sweep: ${r.purged} erased, ${r.examined} examined, policy ${r.retentionDays} days.`);
    } catch (e) {
      this.logger.error(`Address retention sweep failed: ${(e as Error)?.message ?? e}`);
    }
  }
}

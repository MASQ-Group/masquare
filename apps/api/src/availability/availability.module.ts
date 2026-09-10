import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { ReconcileSweepService } from './reconcile-sweep.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  /**
   * ChannelListingsModule is deliberately NOT imported.
   *
   * Importing it closes a real cycle — integrations -> sales-transactions -> channel-listings ->
   * integrations, with this module joining it — and Nest fails at boot with ChannelListingsModule's
   * first import resolving to undefined. Nothing catches that at build time; only starting the app
   * does. The sweep resolves the service by string token instead, exactly as the sell-through does.
   */
  imports: [JobsModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService, ReconcileSweepService],
  exports: [AvailabilityService], // later phases (sell-through, channel sync) reuse adjust()
})
export class AvailabilityModule {}

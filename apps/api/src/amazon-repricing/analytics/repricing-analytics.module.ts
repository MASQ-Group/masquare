import { Module } from '@nestjs/common';
import { RepricingAnalyticsService } from './repricing-analytics.service';

/**
 * Recording and rolling up what the repricer did.
 *
 * Its own module, importing nothing, because both the repricer and the channel-listing sync record
 * prices through it — and those two already sit either side of an import cycle that the rest of the
 * code works around with a string token. A module that depends on nothing cannot be part of one.
 */
@Module({
  providers: [RepricingAnalyticsService],
  exports: [RepricingAnalyticsService],
})
export class RepricingAnalyticsModule {}

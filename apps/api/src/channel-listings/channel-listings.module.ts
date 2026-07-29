import { Module } from '@nestjs/common';
import { ChannelListingsController } from './channel-listings.controller';
import { ChannelListingsService } from './channel-listings.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [IntegrationsModule, PricingModule],
  controllers: [ChannelListingsController],
  // Also exposed under a string token so consumers in a potential import cycle (sales-transactions
  // sell-through) can resolve it via ModuleRef without a runtime `import` of the class.
  providers: [ChannelListingsService, { provide: 'CHANNEL_LISTINGS_SERVICE', useExisting: ChannelListingsService }],
  exports: [ChannelListingsService, 'CHANNEL_LISTINGS_SERVICE'],
})
export class ChannelListingsModule {}

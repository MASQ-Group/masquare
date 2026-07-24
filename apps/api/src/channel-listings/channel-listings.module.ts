import { Module } from '@nestjs/common';
import { ChannelListingsController } from './channel-listings.controller';
import { ChannelListingsService } from './channel-listings.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [IntegrationsModule, PricingModule],
  controllers: [ChannelListingsController],
  providers: [ChannelListingsService],
})
export class ChannelListingsModule {}

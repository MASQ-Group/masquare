import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';
import { AmazonListingController } from './amazon/amazon-listing.controller';
import { AmazonListingService } from './amazon/amazon-listing.service';
import { AvailabilitySweepService } from './availability/availability-sweep.service';
import { AvailabilitySweepController } from './availability/availability-sweep.controller';
import { EbayListingController } from './ebay/ebay-listing.controller';
import { EbayListingService } from './ebay/ebay-listing.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AmazonRepricingModule } from '../amazon-repricing/amazon-repricing.module';
import { GatherModule } from '../gather/gather.module';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  // PricingModule for its FX rates: an eBay UK listing prices in GBP from a cost recorded in EUR.
  imports: [IntegrationsModule, AmazonRepricingModule, GatherModule, PricingModule],
  controllers: [ListingController, AmazonListingController, EbayListingController, AvailabilitySweepController],
  providers: [ListingService, AmazonListingService, EbayListingService, AvailabilitySweepService],
  // EbayListingService is exported for the maSquare connector (McpModule), which runs research
  // through the same gather rules rather than keeping a second copy of them.
  exports: [ListingService, AvailabilitySweepService, EbayListingService],
})
export class ListingModule {}

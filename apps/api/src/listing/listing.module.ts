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

@Module({
  imports: [IntegrationsModule, AmazonRepricingModule],
  controllers: [ListingController, AmazonListingController, EbayListingController, AvailabilitySweepController],
  providers: [ListingService, AmazonListingService, EbayListingService, AvailabilitySweepService],
  exports: [ListingService, AvailabilitySweepService],
})
export class ListingModule {}

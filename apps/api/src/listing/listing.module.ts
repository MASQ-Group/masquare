import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';
import { AmazonListingController } from './amazon/amazon-listing.controller';
import { AmazonListingService } from './amazon/amazon-listing.service';
import { EbayListingController } from './ebay/ebay-listing.controller';
import { EbayListingService } from './ebay/ebay-listing.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AmazonRepricingModule } from '../amazon-repricing/amazon-repricing.module';

@Module({
  imports: [IntegrationsModule, AmazonRepricingModule],
  controllers: [ListingController, AmazonListingController, EbayListingController],
  providers: [ListingService, AmazonListingService, EbayListingService],
  exports: [ListingService],
})
export class ListingModule {}

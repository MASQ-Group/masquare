import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';
import { AmazonListingController } from './amazon/amazon-listing.controller';
import { AmazonListingService } from './amazon/amazon-listing.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AmazonRepricingModule } from '../amazon-repricing/amazon-repricing.module';

@Module({
  imports: [IntegrationsModule, AmazonRepricingModule],
  controllers: [ListingController, AmazonListingController],
  providers: [ListingService, AmazonListingService],
  exports: [ListingService],
})
export class ListingModule {}

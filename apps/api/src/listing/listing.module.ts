import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';
import { AmazonListingController } from './amazon/amazon-listing.controller';
import { AmazonListingService } from './amazon/amazon-listing.service';
import { AvailabilitySweepService } from './availability/availability-sweep.service';
import { AvailabilitySweepController } from './availability/availability-sweep.controller';
import { EbayListingController } from './ebay/ebay-listing.controller';
import { EbayListingService } from './ebay/ebay-listing.service';
import { OnbuyListingController } from './onbuy/onbuy-listing.controller';
import { OnbuyListingService } from './onbuy/onbuy-listing.service';
import { OnbuyImagesService } from './onbuy/onbuy-images.service';
import { OnbuyContentService } from './onbuy/onbuy-content.service';
import { JiniusListingController } from './jinius/jinius-listing.controller';
import { JiniusListingService } from './jinius/jinius-listing.service';
import { ProductContentService } from './product-content.service';
import { ListingPriceController } from './price/listing-price.controller';
import { ListingPriceService } from './price/listing-price.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AmazonRepricingModule } from '../amazon-repricing/amazon-repricing.module';
import { GatherModule } from '../gather/gather.module';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  // PricingModule for its FX rates: an eBay UK listing prices in GBP from a cost recorded in EUR.
  imports: [IntegrationsModule, AmazonRepricingModule, GatherModule, PricingModule],
  controllers: [ListingController, AmazonListingController, EbayListingController, OnbuyListingController, JiniusListingController, ListingPriceController, AvailabilitySweepController],
  providers: [ListingService, AmazonListingService, EbayListingService, OnbuyListingService, OnbuyImagesService, OnbuyContentService, JiniusListingService, ProductContentService, ListingPriceService, AvailabilitySweepService],
  // EbayListingService and OnbuyContentService are exported for the maSquare connector (McpModule),
  // which runs research through the same gather rules rather than keeping a second copy of them.
  exports: [ListingService, AvailabilitySweepService, EbayListingService, OnbuyContentService, ProductContentService],
})
export class ListingModule {}

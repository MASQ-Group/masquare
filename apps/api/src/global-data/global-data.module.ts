import { Module } from '@nestjs/common';
import { CountriesService } from './countries.service';
import { ShippingServicesService } from './shipping-services.service';
import { SalesChannelsService } from './sales-channels.service';
import { CountriesController, ShippingServicesController, SalesChannelsController } from './global-data.controllers';

@Module({
  controllers: [CountriesController, ShippingServicesController, SalesChannelsController],
  providers: [CountriesService, ShippingServicesService, SalesChannelsService],
  exports: [CountriesService, ShippingServicesService, SalesChannelsService],
})
export class GlobalDataModule {}

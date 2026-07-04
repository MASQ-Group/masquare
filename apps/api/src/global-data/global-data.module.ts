import { Module } from '@nestjs/common';
import { CountriesService } from './countries.service';
import { ShippingServicesService } from './shipping-services.service';
import { SalesChannelsService } from './sales-channels.service';
import { ProfitTiersService } from './profit-tiers.service';
import { CountriesController, ShippingServicesController, SalesChannelsController, ProfitTiersController } from './global-data.controllers';

@Module({
  controllers: [CountriesController, ShippingServicesController, SalesChannelsController, ProfitTiersController],
  providers: [CountriesService, ShippingServicesService, SalesChannelsService, ProfitTiersService],
  exports: [CountriesService, ShippingServicesService, SalesChannelsService, ProfitTiersService],
})
export class GlobalDataModule {}

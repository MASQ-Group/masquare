import { Module } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { VendorsController } from './vendors.controller';
import {
  BrandsService, BrandsController,
  ProductTypesService, ProductTypesController,
  FulfilmentTypesService, FulfilmentTypesController,
} from './simple-refs';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { AttributesService } from './attributes.service';
import { AttributesController } from './attributes.controller';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';

@Module({
  controllers: [
    VendorsController,
    BrandsController,
    ProductTypesController,
    FulfilmentTypesController,
    CategoriesController,
    AttributesController,
    SettingsController,
  ],
  providers: [
    VendorsService,
    BrandsService,
    ProductTypesService,
    FulfilmentTypesService,
    CategoriesService,
    AttributesService,
    SettingsService,
  ],
  exports: [
    VendorsService,
    BrandsService,
    ProductTypesService,
    FulfilmentTypesService,
    CategoriesService,
    AttributesService,
    SettingsService,
  ],
})
export class GlobalSettingsModule {}

import { Module } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { ViesService } from './vies.service';
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
import { VatClassesService } from './vat-classes.service';
import { VatClassesController } from './vat-classes.controller';
import { ProductClassesService } from './product-classes.service';
import { ProductClassesController } from './product-classes.controller';
import { ComplianceOptionsController, ComplianceOptionsService } from './compliance-options';
import { BrandRestrictionsController, BrandRestrictionsService } from './brand-restrictions.controller';

@Module({
  controllers: [
    VendorsController,
    BrandsController,
    BrandRestrictionsController,
    ProductTypesController,
    FulfilmentTypesController,
    CategoriesController,
    AttributesController,
    SettingsController,
    VatClassesController,
    ProductClassesController,
    ComplianceOptionsController,
  ],
  providers: [
    VendorsService,
    ViesService,
    BrandsService,
    BrandRestrictionsService,
    ProductTypesService,
    FulfilmentTypesService,
    CategoriesService,
    AttributesService,
    SettingsService,
    VatClassesService,
    ProductClassesService,
    ComplianceOptionsService,
  ],
  exports: [
    VendorsService,
    BrandsService,
    BrandRestrictionsService,
    ProductTypesService,
    FulfilmentTypesService,
    CategoriesService,
    AttributesService,
    SettingsService,
    VatClassesService,
    ProductClassesService,
  ],
})
export class GlobalSettingsModule {}

import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../../common/current-user.decorator';
import { VisibleCompanies, WriteCompany } from '../../common/active-company.decorator';
import { AccessArea, RequireCapability } from '../../access/access.decorators';
import { JiniusListingService } from './jinius-listing.service';
import { JiniusProductService } from './jinius-product.service';

/**
 * Listing on Jinius. The same guards as the eBay and OnBuy listing routes: admin, and the
 * marketplace-write capability for the one route that creates something on the marketplace.
 */
@ApiTags('listing-jinius')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('listing/jinius')
@AccessArea('channel_listings')
export class JiniusListingController {
  constructor(
    private readonly svc: JiniusListingService,
    /** Creating a product in their catalogue, for when attaching to theirs is not good enough. */
    private readonly products: JiniusProductService,
  ) {}

  /** A price at the launch margin, and what a typed one would earn. Read-only. */
  @Get('products/:productId/pricing')
  pricing(
    @Param('productId') productId: string,
    @Query('integrationId') integrationId: string,
    @VisibleCompanies() companyIds: string[],
    @Query('atPriceCents') atPriceCents?: string,
  ) {
    const at = atPriceCents != null && /^\d+$/.test(atPriceCents) && Number(atPriceCents) > 0 ? Number(atPriceCents) : undefined;
    return this.svc.pricing(productId, integrationId, companyIds, at);
  }

  /** Whether Jinius carries this product, what would be sent, and what still stops it. Sends nothing. */
  @Get('products/:productId/preview')
  preview(@Param('productId') productId: string, @Query('integrationId') integrationId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.preview(productId, integrationId, companyIds);
  }

  /** Their categories, searched by name. A category decides which attributes a product needs. */
  @Get('categories')
  categories(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('integrationId') integrationId?: string,
  ) {
    return this.products.categories(integrationId, q ?? '', companyIds);
  }

  /** What creating this product in their catalogue would send, and what still stops it. Sends nothing. */
  @Get('products/:productId/create-preview')
  createPreview(
    @Param('productId') productId: string,
    @Query('categoryCode') categoryCode: string,
    @VisibleCompanies() companyIds: string[],
    @Query('integrationId') integrationId?: string,
  ) {
    return this.products.preview(productId, integrationId, categoryCode, companyIds);
  }

  /** Create the product in their catalogue, so an offer can carry our own words. */
  @Post('products/:productId/create-product')
  @RequireCapability('marketplace_write')
  createProduct(
    @Param('productId') productId: string,
    @Body() body: { integrationId?: string; categoryCode: string; confirm?: boolean },
    @CurrentUser() user: AuthUser,
    @WriteCompany() companyId: string,
  ) {
    return this.products.create(productId, body?.integrationId, { categoryCode: body?.categoryCode, confirm: body?.confirm }, user.sub, [companyId]);
  }

  /** How an import that was still running has got on since. */
  @Get('imports/:importId')
  importStatus(
    @Param('importId') importId: string,
    @VisibleCompanies() companyIds: string[],
    @Query('integrationId') integrationId?: string,
  ) {
    return this.products.importStatus(integrationId, Number(importId), companyIds);
  }

  /** Create the offer on Jinius. Needs the platform's listing-writes setting AND an explicit confirm. */
  @Post('products/:productId/create')
  @RequireCapability('marketplace_write')
  create(
    @Param('productId') productId: string,
    @Body() body: { integrationId?: string; confirm?: boolean },
    @CurrentUser() user: AuthUser,
    @WriteCompany() companyId: string,
  ) {
    return this.svc.create(productId, body?.integrationId ?? '', { confirm: body?.confirm }, user.sub, [companyId]);
  }
}

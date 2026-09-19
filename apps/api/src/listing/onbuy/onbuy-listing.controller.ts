import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../../common/current-user.decorator';
import { VisibleCompanies, WriteCompany } from '../../common/active-company.decorator';
import { AccessArea, RequireCapability } from '../../access/access.decorators';
import { OnbuyListingService } from './onbuy-listing.service';

/**
 * Listing on OnBuy UK. Same guards as the eBay listing routes: admin, and the marketplace-write
 * capability for the one route that creates something on OnBuy.
 */
@ApiTags('listing-onbuy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('listing/onbuy')
@AccessArea('channel_listings')
export class OnbuyListingController {
  constructor(private readonly svc: OnbuyListingService) {}

  @Get('products/:productId/candidates')
  candidates(@Param('productId') productId: string, @Query('integrationId') integrationId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.candidates(productId, integrationId, companyIds);
  }

  @Get('delivery-templates')
  deliveryTemplates(@Query('integrationId') integrationId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.deliveryTemplates(integrationId, companyIds);
  }

  @Get('products/:productId/pricing')
  pricing(
    @Param('productId') productId: string,
    @Query('integrationId') integrationId: string,
    @VisibleCompanies() companyIds: string[],
    @Query('atPriceCents') atPriceCents?: string,
  ) {
    // A typed price, priced. Anything that is not a positive whole number of pence is ignored.
    const at = atPriceCents != null && /^\d+$/.test(atPriceCents) && Number(atPriceCents) > 0 ? Number(atPriceCents) : undefined;
    return this.svc.pricing(productId, integrationId, companyIds, at);
  }

  @Get('products/:productId/preview')
  preview(@Param('productId') productId: string, @Query('integrationId') integrationId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.preview(productId, integrationId, companyIds);
  }

  /** OnBuy categories a new product could go in. */
  @Get('categories')
  categories(@Query('integrationId') integrationId: string, @Query('q') q: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.searchCategories(integrationId, q ?? '', companyIds);
  }

  /** The category other products in the same internal category went in. */
  @Get('products/:productId/category-suggestion')
  categorySuggestion(@Param('productId') productId: string, @Query('integrationId') integrationId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.categorySuggestion(productId, integrationId, companyIds);
  }

  /** What a new OnBuy product would be made of, and what still stops it. Sends nothing. */
  @Get('products/:productId/create-preview')
  createPreview(@Param('productId') productId: string, @Query('integrationId') integrationId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.createPreview(productId, integrationId, companyIds);
  }

  /** Send a new product to OnBuy's queue, with our listing inside it. */
  @Post('products/:productId/create')
  @RequireCapability('marketplace_write')
  create(
    @Param('productId') productId: string,
    @Body() body: { integrationId?: string; confirm?: boolean },
    @CurrentUser() user: AuthUser,
    @WriteCompany() companyId: string,
  ) {
    return this.svc.createSubmit(productId, body?.integrationId ?? '', { confirm: body?.confirm }, user.sub, [companyId]);
  }

  /**
   * Ask OnBuy where a submitted product has got to, and take the next step. Behind the write
   * capability because success is followed by the price and stock update that makes it live.
   */
  @Post('products/:productId/check-progress')
  @RequireCapability('marketplace_write')
  checkProgress(@Param('productId') productId: string, @Body() body: { integrationId?: string }, @WriteCompany() companyId: string) {
    return this.svc.checkProgress(productId, body?.integrationId ?? '', [companyId]);
  }

  /** Whether our OnBuy listings for this product are winning, and the price to beat. Reads only. */
  @Get('products/:productId/competition')
  competition(@Param('productId') productId: string, @Query('integrationId') integrationId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.competition(productId, integrationId, companyIds);
  }

  /** Send a new price for one of our OnBuy listings. */
  @Post('products/:productId/price')
  @RequireCapability('marketplace_write')
  setPrice(
    @Param('productId') productId: string,
    @Body() body: { integrationId?: string; sku?: string; price?: number; confirm?: boolean },
    @CurrentUser() user: AuthUser,
    @WriteCompany() companyId: string,
  ) {
    return this.svc.setPrice(productId, body?.integrationId ?? '', { sku: body?.sku, price: body?.price, confirm: body?.confirm }, user.sub, [companyId]);
  }

  /** Place the listing on OnBuy at stock 0 — not buyable — to see the price to beat before going live. */
  @Post('products/:productId/price-check')
  @RequireCapability('marketplace_write')
  priceCheck(
    @Param('productId') productId: string,
    @Body() body: { integrationId?: string; confirm?: boolean },
    @CurrentUser() user: AuthUser,
    @WriteCompany() companyId: string,
  ) {
    return this.svc.stageForPriceCheck(productId, body?.integrationId ?? '', { confirm: body?.confirm }, user.sub, [companyId]);
  }

  @Post('products/:productId/publish')
  @RequireCapability('marketplace_write')
  publish(
    @Param('productId') productId: string,
    @Body() body: { integrationId?: string; confirm?: boolean },
    @CurrentUser() user: AuthUser,
    // One company: a listing is created through one seller account, and a user who can see two
    // must say which before anything reaches OnBuy.
    @WriteCompany() companyId: string,
  ) {
    return this.svc.publish(productId, body?.integrationId ?? '', { confirm: body?.confirm }, user.sub, [companyId]);
  }
}

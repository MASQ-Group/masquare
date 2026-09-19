import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../../common/current-user.decorator';
import { VisibleCompanies } from '../../common/active-company.decorator';
import { AccessArea } from '../../access/access.decorators';
import { ListingPriceService } from './listing-price.service';

/**
 * Changing the price of a live eBay or OnBuy listing. Amazon's equivalent lives with the Amazon
 * listing routes; the Edit price window calls whichever the listing's channel needs. Guarded exactly
 * as Amazon's is — admin, and the "Change listing prices" gate with a confirm — so whoever may change
 * a price on one channel may change it on the others.
 */
@ApiTags('listing-price')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('listing/price')
@AccessArea('channel_listings')
export class ListingPriceController {
  constructor(private readonly svc: ListingPriceService) {}

  @Get('check')
  check(
    @Query('productId') productId: string,
    @Query('integrationId') integrationId: string,
    @Query('sku') sku: string | undefined,
    @Query('countryIso') countryIso: string | undefined,
    @Query('atPriceCents') atPriceCents: string | undefined,
    @VisibleCompanies() companyIds: string[],
  ) {
    return this.svc.check({ productId, integrationId, sku, countryIso, atPriceCents: atPriceCents ? Number(atPriceCents) : null }, companyIds);
  }

  /** Validates only, unless price writes are on and the caller confirmed. */
  @Post('update')
  update(
    @Body() body: { productId: string; integrationId: string; sku?: string; countryIso?: string; priceCents: number; confirm?: boolean },
    @CurrentUser() user: AuthUser,
    @VisibleCompanies() companyIds: string[],
  ) {
    return this.svc.update({ ...body, priceCents: Number(body?.priceCents) }, user.sub, companyIds);
  }
}

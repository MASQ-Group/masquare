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
  pricing(@Param('productId') productId: string, @Query('integrationId') integrationId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.pricing(productId, integrationId, companyIds);
  }

  @Get('products/:productId/preview')
  preview(@Param('productId') productId: string, @Query('integrationId') integrationId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.preview(productId, integrationId, companyIds);
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

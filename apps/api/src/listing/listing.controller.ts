import { Body, Controller, Delete, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies } from '../common/active-company.decorator';
import { ListingService, type ChannelPlanPatch } from './listing.service';
import { AccessArea } from '../access/access.decorators';

/**
 * Preparing products for sale on a channel.
 *
 * Read and plan only — nothing in here writes to a marketplace. Publishing arrives per channel in
 * later phases, and always behind a human.
 */
@ApiTags('listing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('listing')
@AccessArea('channel_listings')
export class ListingController {
  constructor(private readonly svc: ListingService) {}

  /** The mains and plug facts the eligibility rules are judged against. */
  @Get('marketplace-profiles')
  marketplaceProfiles() {
    return this.svc.marketplaceProfiles();
  }

  /** Editing what a market's mains supply is changes verdicts everywhere, so it is admin-only. */
  @UseGuards(AdminGuard)
  @Patch('marketplace-profiles/:id')
  updateProfile(@Param('id') id: string, @Body() patch: Record<string, unknown>) {
    return this.svc.updateMarketplaceProfile(id, patch);
  }

  /**
   * Every connected channel for this product, with its readiness and eligibility verdicts.
   *
   * Scoped to the companies the caller can see. Each company holds its own seller account per
   * marketplace, so without this the tab listed Amazon DE, FR, ES and the rest twice over — once
   * per company, with nothing on screen to tell the two apart.
   */
  @Get('products/:productId/channels')
  productChannels(@Param('productId') productId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.productChannels(productId, companyIds);
  }

  @Put('products/:productId/channels/:integrationId')
  upsertPlan(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @Body() patch: ChannelPlanPatch,
    @CurrentUser() user: AuthUser,
    @VisibleCompanies() companyIds: string[],
  ) {
    return this.svc.upsertPlan(productId, integrationId, patch, user.sub, companyIds);
  }

  @Delete('products/:productId/channels/:integrationId')
  removePlan(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @Query('marketplace') marketplace = '',
  ) {
    return this.svc.removePlan(productId, integrationId, marketplace);
  }
}

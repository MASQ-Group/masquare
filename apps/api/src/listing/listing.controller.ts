import { Body, Controller, Delete, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { ListingService, type ChannelPlanPatch } from './listing.service';

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

  /** Every connected channel for this product, with its readiness and eligibility verdicts. */
  @Get('products/:productId/channels')
  productChannels(@Param('productId') productId: string) {
    return this.svc.productChannels(productId);
  }

  @Put('products/:productId/channels/:integrationId')
  upsertPlan(
    @Param('productId') productId: string,
    @Param('integrationId') integrationId: string,
    @Body() patch: ChannelPlanPatch,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.upsertPlan(productId, integrationId, patch, user.sub);
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

import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { VisibleCompanies } from '../common/active-company.decorator';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { ChannelListingsService, type ListingsQuery } from './channel-listings.service';
import { JobsService } from '../jobs/jobs.service';

@ApiTags('channel-listings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('channel-listings')
export class ChannelListingsController {
  constructor(
    private readonly svc: ChannelListingsService,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Put back quantities lost to the zeroing, from the last good record we hold.
   *
   * Dry run unless confirm is passed. Targets the ORIGIN marketplace by default, because eBaymag
   * propagates from there and syncs one way — it cannot restore anything itself.
   */
  @Post('restore-quantities')
  restoreQuantities(
    @Body() dto: { marketplace?: string; channelType?: string; confirm?: boolean; limit?: number; since?: string },
    @VisibleCompanies() companyIds: string[],
    @CurrentUser() user: AuthUser,
  ) {
    // A dry run answers immediately; a real one is hundreds of sequential marketplace calls and
    // outlives the gateway, so it runs as a job you can follow.
    if (!dto?.confirm) return this.svc.restoreQuantities(dto ?? {}, companyIds, user.sub);
    return this.jobs.start(
      'channel-listings.restore-quantities',
      'Restoring quantities on ' + (dto.marketplace ?? 'GB'),
      (ctx) => this.svc.restoreQuantities(dto, companyIds, user.sub, ctx),
    );
  }

  /** What we have actually sent to the channels, newest first. Read-only. */
  @Get('pushes')
  pushes(
    @VisibleCompanies() companyIds: string[],
    @Query('channelType') channelType?: string,
    @Query('field') field?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.pushHistory({ channelType, field, since, limit: limit ? Number(limit) : undefined }, companyIds);
  }

  @Get()
  dashboard(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('channelId') channelId?: string,
    @Query('brandId') brandId?: string,
    @Query('vendorId') vendorId?: string,
    @Query('productTypeId') productTypeId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: ListingsQuery = { q, channelId, brandId, vendorId, productTypeId, companyIds, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.svc.dashboard(query);
  }

  // Literal paths before ":productId".
  @Get('channels')
  channels(@VisibleCompanies() companyIds: string[]) {
    return this.svc.channels(companyIds);
  }

  @Post('sync')
  sync(@VisibleCompanies() companyIds: string[], @Body() body?: { integrationIds?: string[] }) {
    // A job, not a result: a full sync pulls every listing from every channel and runs for
    // minutes, which as one held-open request is indistinguishable from a hung page.
    const count = body?.integrationIds?.length;
    return this.jobs.start('channel-listings.sync', count ? `Syncing ${count} channel${count === 1 ? '' : 's'}` : 'Syncing all channels', (ctx) =>
      this.svc.sync(body?.integrationIds, companyIds, ctx),
    );
  }

  @Get('product/:productId')
  detail(@Param('productId') productId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.detail(productId, companyIds);
  }

  @Get('product/:productId/identifiers')
  identifiers(@Param('productId') productId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.identifiers(productId, companyIds);
  }

  /** Push Availability quantity to the selected products' listings. dryRun=true (default) previews
   *  without applying; dryRun=false commits and records a ChannelPush audit per listing. */
  @Post('push')
  push(@VisibleCompanies() companyIds: string[], @CurrentUser() user: AuthUser, @Body() body: { productIds: string[]; dryRun?: boolean; channels?: string[] }) {
    return this.svc.pushAvailability(body?.productIds ?? [], { dryRun: body?.dryRun !== false, channelKeys: body?.channels }, companyIds, user.sub);
  }
}

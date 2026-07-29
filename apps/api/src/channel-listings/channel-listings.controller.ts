import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { VisibleCompanies } from '../common/active-company.decorator';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { ChannelListingsService, type ListingsQuery } from './channel-listings.service';

@ApiTags('channel-listings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('channel-listings')
export class ChannelListingsController {
  constructor(private readonly svc: ChannelListingsService) {}

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
    return this.svc.sync(body?.integrationIds, companyIds);
  }

  @Get('product/:productId')
  detail(@Param('productId') productId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.detail(productId, companyIds);
  }

  /** Push Availability quantity to the selected products' listings. dryRun=true (default) previews
   *  without applying; dryRun=false commits and records a ChannelPush audit per listing. */
  @Post('push')
  push(@VisibleCompanies() companyIds: string[], @CurrentUser() user: AuthUser, @Body() body: { productIds: string[]; dryRun?: boolean; channels?: string[] }) {
    return this.svc.pushAvailability(body?.productIds ?? [], { dryRun: body?.dryRun !== false, channelKeys: body?.channels }, companyIds, user.sub);
  }
}

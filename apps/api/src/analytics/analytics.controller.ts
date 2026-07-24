import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsService, type AnalyticsQuery } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get('sales')
  sales(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('compareFrom') compareFrom?: string,
    @Query('compareTo') compareTo?: string,
    @Query('companyId') companyId?: string,
    @Query('channelId') channelId?: string,
    @Query('countryId') countryId?: string,
    @Query('fulfilment') fulfilment?: string,
    @Query('skuChannelId') skuChannelId?: string,
    @Query('skuCountryId') skuCountryId?: string,
  ) {
    const query: AnalyticsQuery = { from, to, compareFrom, compareTo, companyId, channelId, countryId, fulfilment, skuChannelId, skuCountryId };
    return this.svc.report(query);
  }

  @Get('sku')
  sku(
    @Query('sku') sku: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('compareFrom') compareFrom?: string,
    @Query('compareTo') compareTo?: string,
    @Query('companyId') companyId?: string,
    @Query('channelId') channelId?: string,
    @Query('countryId') countryId?: string,
    @Query('fulfilment') fulfilment?: string,
  ) {
    return this.svc.skuDetail({ sku, from, to, compareFrom, compareTo, companyId, channelId, countryId, fulfilment });
  }
}

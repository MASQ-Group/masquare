import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto, TestIntegrationDto, UpdateIntegrationDto } from './dto/integration.dto';

// Admin-only across the board: managing third-party API credentials is privileged.
@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

  @Get('connectors')
  connectors() {
    return this.svc.connectors();
  }

  // Literal 'channel-logos' paths before the ':id' routes so they don't get captured.
  @Get('channel-logos')
  channelLogos() {
    return this.svc.listChannelLogos();
  }

  @Post('channel-logos/:channelType')
  @UseInterceptors(FileInterceptor('file'))
  setChannelLogo(@Param('channelType') channelType: string, @UploadedFile() file: any, @CurrentUser() user: AuthUser) {
    return this.svc.setChannelLogo(channelType, file, user.sub);
  }

  @Delete('channel-logos/:channelType')
  removeChannelLogo(@Param('channelType') channelType: string) {
    return this.svc.removeChannelLogo(channelType);
  }

  /** Sync-automation settings: the daily auto-sync time (HH:MM, server/UTC). */
  @Get('sync-settings')
  getSyncSettings() {
    return this.svc.getSyncSettings();
  }

  @Patch('sync-settings')
  setSyncSettings(@Body() dto: { channelSyncTime?: string }, @CurrentUser() user: AuthUser) {
    return this.svc.setSyncSettings(dto, user.sub);
  }

  /** Enable/disable daily auto-sync across a scope (all, a channel family, or explicit ids). */
  @Post('bulk/auto-sync')
  bulkSetAutoSync(@Body() dto: { ids?: string[]; channelType?: string; all?: boolean; enabled: boolean }) {
    return this.svc.bulkSetAutoSync({ ids: dto.ids, channelType: dto.channelType, all: dto.all }, dto.enabled !== false);
  }

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: CreateIntegrationDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user.sub);
  }

  /** One-time: register SP-API notification subscriptions (repricing) to an SQS queue ARN. */
  @Post(':id/spapi-notifications/setup')
  setupSpApiNotifications(@Param('id') id: string, @Body() body: { sqsArn: string; types?: string[] }) {
    // ORDER_CHANGE is not used by repricing. It exists here as a positive control: it fires on
    // ordinary daily sales, so it can prove the Amazon -> queue path works when the pricing
    // notifications are silent and we cannot tell "no events" from "events not being delivered".
    const allowed = new Set(['ANY_OFFER_CHANGED', 'PRICING_HEALTH', 'FEE_PROMOTION', 'ORDER_CHANGE']);
    const requested = body.types?.filter((t) => allowed.has(t)) ?? [];
    const types = requested.length ? requested : ['ANY_OFFER_CHANGED', 'PRICING_HEALTH', 'FEE_PROMOTION'];
    return this.svc.setupSpApiNotifications(id, body.sqsArn, types);
  }

  /** Read-only: what eBay reports for one order, using the only eBay connection. */
  @Get('ebay/order-money')
  ebayOrderMoneyDefault(@Query('orderId') orderId: string) {
    return this.svc.ebayOrderMoney(undefined, orderId);
  }

  /** Read-only: what eBay actually reports for one order's money fields. */
  @Get(':id/ebay/order-money')
  ebayOrderMoney(@Param('id') id: string, @Query('orderId') orderId: string) {
    return this.svc.ebayOrderMoney(id, orderId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto, @CurrentUser() user: AuthUser) {
    return this.svc.update(id, dto, user.sub);
  }

  @Post(':id/test')
  test(@Param('id') id: string, @Body() dto: TestIntegrationDto, @CurrentUser() user: AuthUser) {
    return this.svc.test(id, dto.mode ?? 'test', user.sub);
  }

  @Post(':id/preview-orders')
  previewOrders(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.previewOrders(id, user.sub);
  }

  @Post(':id/preview-mapping')
  previewMapping(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.previewMapping(id, user.sub);
  }

  @Post(':id/preview-listings')
  previewListings(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.previewListings(id, user.sub);
  }

  @Post(':id/verify-mapping')
  verifyMapping(@Param('id') id: string, @Body() dto: { confirmed?: boolean }, @CurrentUser() user: AuthUser) {
    return this.svc.verifyMapping(id, dto?.confirmed !== false, user.sub);
  }

  @Post(':id/sync')
  sync(@Param('id') id: string, @Body() dto: { from?: string; to?: string }, @CurrentUser() user: AuthUser) {
    const range = dto?.from ? { from: dto.from, to: dto.to } : undefined;
    return this.svc.syncOrders(id, 'manual', user.sub, range);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user.sub);
  }
}

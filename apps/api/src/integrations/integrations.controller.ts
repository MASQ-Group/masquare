import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentAccess, CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto, TestIntegrationDto, UpdateIntegrationDto } from './dto/integration.dto';
import { VisibleCompanies, WriteCompany } from '../common/active-company.decorator';
import { JobsService } from '../jobs/jobs.service';
import { AccessArea, RequireCapability, Requires } from '../access/access.decorators';
import type { EffectiveAccess } from '../access/catalogue';
import { canArea } from '../access/resolve';

// Admin-only across the board: managing third-party API credentials is privileged.
@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('integrations')
@AccessArea('integrations')
export class IntegrationsController {
  constructor(
    private readonly svc: IntegrationsService,
    private readonly jobs: JobsService,
  ) {}

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
  // Read as well as write: "no access to scheduling" means not seeing it either.
  @Requires('edit')
  @Get('sync-settings')
  getSyncSettings() {
    return this.svc.getSyncSettings();
  }

  @Patch('sync-settings')
  setSyncSettings(@Body() dto: { channelSyncTime?: string }, @CurrentUser() user: AuthUser) {
    return this.svc.setSyncSettings(dto, user.sub);
  }

  /**
   * Enable/disable daily auto-sync across a scope (all, a channel family, or explicit ids).
   *
   * Scoped to the visible companies, exactly like the list above. Without that, "all" meant every
   * connection on the platform, so switching auto-sync on while looking at one company switched it
   * on for the other as well.
   */
  @Post('bulk/auto-sync')
  bulkSetAutoSync(
    @Body() dto: { ids?: string[]; channelType?: string; all?: boolean; enabled: boolean },
    @VisibleCompanies() companyIds: string[],
  ) {
    return this.svc.bulkSetAutoSync({ ids: dto.ids, channelType: dto.channelType, all: dto.all }, dto.enabled !== false, companyIds);
  }

  @Get()
  list(@VisibleCompanies() companyIds: string[]) {
    return this.svc.list(companyIds);
  }

  @Get(':id')
  get(@Param('id') id: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.get(id, companyIds);
  }

  @Post()
  create(@Body() dto: CreateIntegrationDto, @CurrentUser() user: AuthUser, @WriteCompany() companyId: string) {
    // The company comes from the session, not the body: marketplace credentials must belong to the
    // company you are actually working in.
    return this.svc.create(dto, user.sub, companyId);
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

  /** Create the keypair eBay requires to sign Finances requests. One-off per connection. */
  @Post(':id/ebay/signing-key')
  createEbaySigningKey(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.createEbaySigningKey(id, user.sub);
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
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.update(id, dto, user.sub, companyIds);
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

  /**
   * Two actions behind one route: a plain sync fetches what is new, and the same call with a date
   * range is "pull older orders" — a backfill that can rewrite months of history.
   *
   * No decorator can tell them apart, because the difference is in the body. So the route asks only
   * for the lesser right, and the greater one is checked here against the arguments actually sent.
   */
  @Post(':id/sync')
  @Requires('view')
  @RequireCapability('trigger_sync')
  sync(
    @Param('id') id: string,
    @Body() dto: { from?: string; to?: string },
    @CurrentUser() user: AuthUser,
    @CurrentAccess() access: EffectiveAccess,
  ) {
    const range = dto?.from ? { from: dto.from, to: dto.to } : undefined;
    if (range && !canArea(access, 'integrations', 'edit')) {
      throw new ForbiddenException(
        'Pulling older orders rewrites history and needs full access to Integrations. You can run a sync for current orders.',
      );
    }
    return this.svc.syncOrders(id, 'manual', user.sub, range);
  }

  /** Fill cancelStage on Amazon cancellations imported before the column existed. Idempotent. */
  @Post('backfill-cancel-stages')
  backfillCancelStages(@Body() dto: { limit?: number }) {
    return this.svc.backfillCancelStages({ limit: dto?.limit });
  }

  /**
   * Re-fetch Amazon fees and rewrite them, repairing orders where a SKU's fee was repeated across
   * every line carrying that SKU.
   *
   * A one-off repair, kept without a button. The fee apportionment that caused it is fixed on both
   * the import and backfill paths, so nothing can reintroduce it and there is nothing left to
   * repair — but a tool that rewrites financial data and spends SP-API budget should not sit one
   * click away on an admin page. Call it deliberately if the need ever returns.
   *
   * Without confirm it reports the scope and the overstatement arithmetically and calls nothing.
   * With confirm it returns a job: one Amazon call per order, paced under the rate limit, so a
   * full history takes a while.
   */
  @Post('repair-amazon-fees')
  repairAmazonFees(@Body() dto: { confirm?: boolean; scope?: 'affected' | 'all' }) {
    if (!dto?.confirm) return this.svc.repairAmazonFees({ confirm: false, scope: dto?.scope });
    return this.jobs.start(
      'integrations.repair-amazon-fees',
      'Repairing Amazon fees',
      (ctx) => this.svc.repairAmazonFees({ confirm: true, scope: dto?.scope }, ctx),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.remove(id, user.sub, companyIds);
  }
}

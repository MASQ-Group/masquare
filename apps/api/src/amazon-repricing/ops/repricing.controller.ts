import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../../common/current-user.decorator';
import { OnboardingService } from '../onboarding/onboarding.service';
import { FloorService } from '../floor/floor.service';
import { RepricingControlService } from '../writer/control.service';
import { BlocklistService, type BlockedSellerDto } from './blocklist.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';

// Ops console API for the Amazon repricing module (admin-only). Phase-appropriate subset: onboard
// SKUs, refresh fees + recompute floors, and inspect the SKU-pricing table + recent decisions.
// The full ops console (kill switches, quarantine queue, blocklist) is a later phase.
@ApiTags('amazon-repricing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('amazon-repricing')
export class RepricingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly floors: FloorService,
    private readonly control: RepricingControlService,
    private readonly blocklist: BlocklistService,
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Seller blocklist (§5.2): unauthorized / MAP-violating / hijacker sellers excluded from pricing. */
  @Get('blocklist')
  listBlocklist() {
    return this.blocklist.list();
  }

  @Post('blocklist')
  addBlocklist(@Body() dto: BlockedSellerDto, @CurrentUser() user: AuthUser) {
    return this.blocklist.add(dto, user.sub);
  }

  @Delete('blocklist/:id')
  removeBlocklist(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.blocklist.remove(id, user.sub);
  }

  /** Global runtime controls: the kill switch + live-writes master switch (§6.4). */
  @Get('control')
  getControl() {
    return this.control.get();
  }

  @Post('control')
  setControl(@Body() dto: { liveWritesEnabled?: boolean; killSwitchEngaged?: boolean }, @CurrentUser() user: AuthUser) {
    return this.control.update(dto, user.sub);
  }

  /** Seed/refresh RepricingSkuPricing from matched Amazon listings (§3.3). */
  @Post('onboard')
  onboard() {
    return this.onboarding.syncSkuPricingFromListings();
  }

  /** Data-readiness summary — counts by automation state / exclusion reason. */
  @Get('readiness')
  readiness() {
    return this.onboarding.readinessSummary();
  }

  /**
   * Pre-flight: does each Amazon connection actually hold the SP-API roles this module needs?
   * READ-ONLY (a fees estimate + a destinations list) — nothing is written, subscribed or priced,
   * so it is safe before activation. Answers "are Pricing/Notifications granted?" directly, rather
   * than finding out via a 403 deep inside the first sync.
   */
  @Get('diagnostics/roles')
  async roleDiagnostics() {
    const integrations = await this.prisma.channelIntegration.findMany({
      where: { channelType: 'amazon', deletedAt: null },
      select: { id: true, name: true, marketplace: true },
      orderBy: { name: 'asc' },
    });
    const results: Array<Record<string, unknown>> = [];
    for (const i of integrations) {
      const r = await this.integrations.checkSpApiRoles(i.id).catch((e) => ({
        ok: false,
        pricing: { ok: false, message: (e as Error).message },
        notifications: { ok: false, message: (e as Error).message },
      }));
      results.push({ integrationId: i.id, name: i.name, marketplace: i.marketplace, ...r });
    }
    return {
      total: results.length,
      pricingOk: results.filter((r) => (r.pricing as { ok: boolean }).ok).length,
      notificationsOk: results.filter((r) => (r.notifications as { ok: boolean }).ok).length,
      results,
    };
  }

  /** Refresh fees + recompute the floor for every SKU (best-effort; makes live SP-API calls). */
  @Post('floors/recompute')
  async recomputeFloors() {
    const rows = await this.prisma.repricingSkuPricing.findMany({ where: { deletedAt: null }, select: { id: true } });
    let ok = 0;
    for (const { id } of rows) {
      try {
        await this.floors.refreshFeesAndRecompute(id);
        ok += 1;
      } catch {
        /* logged in the service */
      }
    }
    return { processed: rows.length, ok };
  }

  /** List SKU-pricing rows (paged) for verification. */
  @Get('sku-pricing')
  skuPricing(@Query('take') take = '50', @Query('skip') skip = '0') {
    return this.prisma.repricingSkuPricing.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Number(take) || 50, 200),
      skip: Number(skip) || 0,
    });
  }

  /** Decision audit search (§6.6): recent records, optionally filtered by SKU and/or outcome. */
  @Get('decisions')
  decisions(@Query('take') take = '50', @Query('sku') sku?: string, @Query('outcome') outcome?: string) {
    return this.prisma.repricingDecision.findMany({
      where: {
        ...(sku?.trim() ? { sku: { contains: sku.trim(), mode: 'insensitive' as const } } : {}),
        ...(outcome ? { outcome } : {}),
      },
      orderBy: { at: 'desc' },
      take: Math.min(Number(take) || 50, 200),
    });
  }

  /** Quarantine queue (§5.5, §7): SKUs taken off automation by an unresolvable conflict, oldest
   *  first. `total`/`oldestHours` drive the §7 escalation flag (> 20 open or > 24h old). */
  @Get('quarantine')
  async quarantine() {
    const items = await this.prisma.repricingSkuPricing.findMany({
      where: { deletedAt: null, automationState: 'QUARANTINED' },
      orderBy: { updatedAt: 'asc' },
      select: { id: true, sku: true, asin: true, marketplaceId: true, strategy: true, strategyFloorCents: true, mapCents: true, maxPriceCents: true, fairPricingCeilingCents: true, updatedAt: true },
      take: 200,
    });
    const oldestHours = items.length ? Math.floor((Date.now() - items[0].updatedAt.getTime()) / 3_600_000) : 0;
    return { total: items.length, oldestHours, items };
  }

  /** Resolve a quarantined SKU: after the human fixes the conflicting values, return it to shadow
   *  so the next event re-evaluates it. */
  @Post('quarantine/:id/resolve')
  async resolveQuarantine(@Param('id') id: string) {
    await this.prisma.repricingSkuPricing.updateMany({
      where: { id, automationState: 'QUARANTINED' },
      data: { automationState: 'SHADOW' },
    });
    return { resolved: true };
  }
}

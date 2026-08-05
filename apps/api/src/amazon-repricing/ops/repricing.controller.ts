import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../../common/current-user.decorator';
import { OnboardingService } from '../onboarding/onboarding.service';
import { FloorService } from '../floor/floor.service';
import { RepricingControlService } from '../writer/control.service';
import { PrismaService } from '../../prisma/prisma.service';

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
    private readonly prisma: PrismaService,
  ) {}

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

  /** Recent decision audit records (shadow-mode intended prices). */
  @Get('decisions')
  decisions(@Query('take') take = '50') {
    return this.prisma.repricingDecision.findMany({
      orderBy: { at: 'desc' },
      take: Math.min(Number(take) || 50, 200),
    });
  }
}

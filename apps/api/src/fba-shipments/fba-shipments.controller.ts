import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FbaShipmentsService } from './fba-shipments.service';
import {
  CreateFbaShipmentDto, EstimateFbaShipmentDto, SetActualCostDto, SetStatusDto, UpdateFbaShipmentDto,
} from './dto/fba-shipment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies, WriteCompany } from '../common/active-company.decorator';
import { JobsService } from '../jobs/jobs.service';

@ApiTags('fba-shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fba-shipments')
export class FbaShipmentsController {
  constructor(
    private readonly fba: FbaShipmentsService,
    private readonly jobs: JobsService,
  ) {}

  // Literal subpaths declared before ":id" routes.
  @Post('estimate')
  estimate(@Body() dto: EstimateFbaShipmentDto) {
    return this.fba.estimate(dto);
  }

  @Get('average')
  average(@Query('productId') productId: string, @Query('salesChannelId') salesChannelId?: string) {
    return this.fba.averageForProduct(productId, salesChannelId || undefined);
  }

  @Get('sku-costs')
  skuCosts(@Query('q') q?: string, @Query('salesChannelId') salesChannelId?: string) {
    return this.fba.skuAllocatedCosts({ q, salesChannelId });
  }

  @Post('import')
  import(@Body() body: { rows?: Record<string, string>[] }, @CurrentUser() user: AuthUser, @WriteCompany() companyId: string) {
    return this.fba.importShipments(body?.rows ?? [], user.sub, companyId);
  }

  @Get()
  list(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('salesChannelId') salesChannelId?: string,
    @Query('status') status?: string,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.fba.list({ q, salesChannelId, status, sortDir, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined, companyIds });
  }

  @Get(':id')
  get(@Param('id') id: string, @VisibleCompanies() companyIds: string[]) {
    return this.fba.get(id, companyIds);
  }

  @Post()
  create(@Body() dto: CreateFbaShipmentDto, @CurrentUser() user: AuthUser, @WriteCompany() companyId: string) {
    return this.fba.create(dto, user.sub, companyId);
  }

  /**
   * Re-resolve this shipment's SKUs against the catalogue as it stands now and redo the maths.
   *
   * Dry run unless confirm is passed: it reports how many lines would link, which SKUs still match
   * nothing, and how the chargeable weight and cost would move.
   */
  @Post(':id/recalculate')
  recalculate(
    @Param('id') id: string,
    @Body() dto: { confirm?: boolean },
    @CurrentUser() user: AuthUser,
    @VisibleCompanies() companyIds: string[],
  ) {
    return this.fba.recalculate(id, { confirm: dto?.confirm }, companyIds, user.sub, !!user.isAdmin);
  }

  /** The same across every shipment that still has an unlinked line. Dry run unless confirmed. */
  @Post('recalculate-all')
  recalculateAll(
    @Body() dto: { confirm?: boolean },
    @CurrentUser() user: AuthUser,
    @VisibleCompanies() companyIds: string[],
  ) {
    if (!dto?.confirm) return this.fba.recalculateAll({ confirm: false }, companyIds, user.sub, !!user.isAdmin);
    return this.jobs.start(
      'fba.recalculate-all',
      'Recalculating FBA shipments',
      (ctx) => this.fba.recalculateAll({ confirm: true }, companyIds, user.sub, !!user.isAdmin, ctx),
    );
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.fba.setStatus(id, dto.status, user.sub, companyIds);
  }

  @Patch(':id/actual-cost')
  setActualCost(@Param('id') id: string, @Body() dto: SetActualCostDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.fba.setActualCost(id, dto.actualCostEur, user.sub, companyIds);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFbaShipmentDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.fba.update(id, dto, user.sub, user.isAdmin, companyIds);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @VisibleCompanies() companyIds: string[]) {
    return this.fba.remove(id, companyIds);
  }
}

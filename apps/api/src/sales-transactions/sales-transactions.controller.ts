import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SalesTransactionsService, type TxQuery } from './sales-transactions.service';
import { CreateSalesTransactionDto, DecideUnlockDto, ResolveTransactionDto, UpdateSalesTransactionDto } from './dto/sales-transaction.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies } from '../common/active-company.decorator';

@ApiTags('sales-transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales-transactions')
export class SalesTransactionsController {
  constructor(private readonly svc: SalesTransactionsService) {}

  @Get()
  list(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('companyId') companyId?: string,
    @Query('salesChannelId') salesChannelId?: string | string[],
    @Query('destinationCountryId') destinationCountryId?: string | string[],
    @Query('status') status?: string | string[],
    @Query('profitTierId') profitTierId?: string | string[],
    @Query('shipmentStatus') shipmentStatus?: string | string[],
    @Query('fulfilmentType') fulfilmentType?: string | string[],
    @Query('feeType') feeType?: string | string[],
    @Query('sku') sku?: string,
    @Query('hasAlert') hasAlert?: string,
    @Query('needsReturn') needsReturn?: string,
    @Query('resolution') resolution?: string | string[],
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortBy?: 'date' | 'profit' | 'profitPct',
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const arr = (v?: string | string[]) => (v == null ? undefined : Array.isArray(v) ? v : [v]);
    const query: TxQuery = {
      q, companyIds, sku, dateFrom, dateTo,
      salesChannelId: arr(salesChannelId),
      destinationCountryId: arr(destinationCountryId),
      status: arr(status),
      profitTierId: arr(profitTierId),
      shipmentStatus: arr(shipmentStatus),
      fulfilmentType: arr(fulfilmentType),
      feeType: arr(feeType),
      hasAlert: hasAlert === 'true' || hasAlert === '1',
      needsReturn: needsReturn === 'true' || needsReturn === '1',
      resolution: arr(resolution),
      sortBy, sortDir, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.svc.list(query);
  }

  // --- Bulk actions & unlock requests (literal paths declared before ":id") ---
  @Get('ids')
  async ids(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('companyId') companyId?: string,
    @Query('salesChannelId') salesChannelId?: string | string[],
    @Query('destinationCountryId') destinationCountryId?: string | string[],
    @Query('status') status?: string | string[],
    @Query('profitTierId') profitTierId?: string | string[],
    @Query('shipmentStatus') shipmentStatus?: string | string[],
    @Query('fulfilmentType') fulfilmentType?: string | string[],
    @Query('feeType') feeType?: string | string[],
    @Query('sku') sku?: string,
    @Query('hasAlert') hasAlert?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const arr = (v?: string | string[]) => (v == null ? undefined : Array.isArray(v) ? v : [v]);
    const ids = await this.svc.allIds({
      q, companyIds, sku, dateFrom, dateTo,
      salesChannelId: arr(salesChannelId),
      destinationCountryId: arr(destinationCountryId),
      status: arr(status),
      profitTierId: arr(profitTierId),
      shipmentStatus: arr(shipmentStatus),
      fulfilmentType: arr(fulfilmentType),
      feeType: arr(feeType),
      hasAlert: hasAlert === 'true' || hasAlert === '1',
    });
    return { ids, total: ids.length };
  }

  @Get('export')
  exportRows(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('companyId') companyId?: string,
    @Query('salesChannelId') salesChannelId?: string | string[],
    @Query('destinationCountryId') destinationCountryId?: string | string[],
    @Query('status') status?: string | string[],
    @Query('profitTierId') profitTierId?: string | string[],
    @Query('shipmentStatus') shipmentStatus?: string | string[],
    @Query('fulfilmentType') fulfilmentType?: string | string[],
    @Query('feeType') feeType?: string | string[],
    @Query('sku') sku?: string,
    @Query('hasAlert') hasAlert?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortBy?: 'date' | 'profit' | 'profitPct',
    @Query('sortDir') sortDir?: 'asc' | 'desc',
  ) {
    const arr = (v?: string | string[]) => (v == null ? undefined : Array.isArray(v) ? v : [v]);
    return this.svc.exportRows({
      q, companyIds, sku, dateFrom, dateTo,
      salesChannelId: arr(salesChannelId),
      destinationCountryId: arr(destinationCountryId),
      status: arr(status),
      profitTierId: arr(profitTierId),
      shipmentStatus: arr(shipmentStatus),
      fulfilmentType: arr(fulfilmentType),
      feeType: arr(feeType),
      hasAlert: hasAlert === 'true' || hasAlert === '1',
      sortBy, sortDir,
    });
  }

  @Post('bulk/status')
  bulkStatus(@Body() dto: { ids: string[]; status: 'draft' | 'submitted' }, @CurrentUser() user: AuthUser) {
    return this.svc.bulkStatus(dto.ids ?? [], dto.status === 'submitted' ? 'submitted' : 'draft', user);
  }

  // Optional `ids` scopes the sweep to just those transactions (faster when you know which
  // ones changed); omit it to recalculate every transaction.
  @Post('recalculate')
  recalculate(@Body() body?: { ids?: string[] }) {
    return this.svc.recalculate(body?.ids);
  }

  @Get('unlock-requests')
  listUnlockRequests(@CurrentUser() user: AuthUser) {
    if (!user.isAdmin) throw new ForbiddenException('Admin only');
    return this.svc.listUnlockRequests();
  }

  @Post('unlock-requests/:requestId/decide')
  decideUnlock(@Param('requestId') requestId: string, @Body() dto: DecideUnlockDto, @CurrentUser() user: AuthUser) {
    if (!user.isAdmin) throw new ForbiddenException('Admin only');
    return this.svc.decideUnlock(requestId, dto.grant, user.sub);
  }

  @Post(':id/unlock-request')
  requestUnlock(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.requestUnlock(id, user.sub);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: CreateSalesTransactionDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSalesTransactionDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.update(id, dto, user, companyIds);
  }

  @Patch(':id/resolution')
  resolve(@Param('id') id: string, @Body() dto: ResolveTransactionDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.resolve(id, dto, user, companyIds);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.remove(id, user, companyIds);
  }
}

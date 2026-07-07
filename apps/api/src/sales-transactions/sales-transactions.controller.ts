import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SalesTransactionsService, type TxQuery } from './sales-transactions.service';
import { CreateSalesTransactionDto, DecideUnlockDto, ResolveTransactionDto, UpdateSalesTransactionDto } from './dto/sales-transaction.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';

@ApiTags('sales-transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales-transactions')
export class SalesTransactionsController {
  constructor(private readonly svc: SalesTransactionsService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('companyId') companyId?: string,
    @Query('salesChannelId') salesChannelId?: string | string[],
    @Query('destinationCountryId') destinationCountryId?: string | string[],
    @Query('status') status?: string | string[],
    @Query('profitTierId') profitTierId?: string | string[],
    @Query('shipmentStatus') shipmentStatus?: string | string[],
    @Query('sku') sku?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortBy?: 'date' | 'profit' | 'profitPct',
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const arr = (v?: string | string[]) => (v == null ? undefined : Array.isArray(v) ? v : [v]);
    const query: TxQuery = {
      q, companyId, sku, dateFrom, dateTo,
      salesChannelId: arr(salesChannelId),
      destinationCountryId: arr(destinationCountryId),
      status: arr(status),
      profitTierId: arr(profitTierId),
      shipmentStatus: arr(shipmentStatus),
      sortBy, sortDir, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.svc.list(query);
  }

  // --- Bulk actions & unlock requests (literal paths declared before ":id") ---
  @Post('bulk/status')
  bulkStatus(@Body() dto: { ids: string[]; status: 'draft' | 'submitted' }, @CurrentUser() user: AuthUser) {
    return this.svc.bulkStatus(dto.ids ?? [], dto.status === 'submitted' ? 'submitted' : 'draft', user);
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
  update(@Param('id') id: string, @Body() dto: UpdateSalesTransactionDto, @CurrentUser() user: AuthUser) {
    return this.svc.update(id, dto, user);
  }

  @Patch(':id/resolution')
  resolve(@Param('id') id: string, @Body() dto: ResolveTransactionDto, @CurrentUser() user: AuthUser) {
    return this.svc.resolve(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user);
  }
}

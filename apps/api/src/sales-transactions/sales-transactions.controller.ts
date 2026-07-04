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
    @Query('salesChannelId') salesChannelId?: string,
    @Query('status') status?: string,
    @Query('profitTierId') profitTierId?: string,
    @Query('sortBy') sortBy?: 'date' | 'profit' | 'profitPct',
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: TxQuery = { q, companyId, salesChannelId, status, profitTierId, sortBy, sortDir, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.svc.list(query);
  }

  // --- Unlock requests (literal paths declared before ":id") ---
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

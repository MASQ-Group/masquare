import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies } from '../common/active-company.decorator';
import { ShipmentsService, type ShipmentQuery } from './shipments.service';
import { CreateCombinedShipmentDto, CreateShipmentBatchDto, CreateShipmentDto, SetFulfilmentDto, ShipmentImportCommitDto, ShipmentImportValidateDto, UpdateShipmentDto } from './dto/shipment.dto';

@ApiTags('shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly svc: ShipmentsService) {}

  @Get()
  list(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('salesChannelId') salesChannelId?: string,
    @Query('type') type?: string,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeFba') includeFba?: string,
  ) {
    const query: ShipmentQuery = {
      q, companyIds, salesChannelId, type, sortDir,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      // Opt-in, so an existing caller that only knows about order shipments keeps its old result.
      includeFba: includeFba === 'true',
    };
    return this.svc.list(query);
  }

  // Literal paths before ":id".
  @Get('pending')
  pending(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('salesChannelId') salesChannelId?: string,
    @Query('channelKind') channelKind?: 'local' | 'channel',
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: ShipmentQuery = { q, companyIds, salesChannelId, channelKind, sortDir, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.svc.pending(query);
  }

  /** Orders the marketplace dispatched that we never recorded a shipment for. */
  @Get('dispatched-elsewhere')
  dispatchedElsewhere(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('salesChannelId') salesChannelId?: string,
    @Query('channelKind') channelKind?: 'local' | 'channel',
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: ShipmentQuery = { q, companyIds, salesChannelId, channelKind, sortDir, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.svc.dispatchedElsewhere(query);
  }

  /**
   * Close out orders the channel shipped, accepting the estimated shipping cost.
   *
   * Bulk, because there are years of them and a backlog cleared one row at a time stays a backlog.
   * Explicit ids rather than "everything matching the filter", so what gets closed is what the
   * operator had on screen when they decided.
   */
  @Post('accept-channel-dispatch')
  acceptChannelDispatch(@Body() dto: { transactionIds: string[] }, @VisibleCompanies() companyIds: string[]) {
    return this.svc.acceptChannelDispatch(dto?.transactionIds ?? [], companyIds);
  }

  @Get('export')
  exportRows(
    @VisibleCompanies() companyIds: string[],
    @Query('scope') scope?: string,
    @Query('q') q?: string,
    @Query('salesChannelId') salesChannelId?: string,
    @Query('type') type?: string,
    @Query('channelKind') channelKind?: 'local' | 'channel',
  ) {
    return this.svc.exportRows({ q, companyIds, salesChannelId, type, channelKind }, scope === 'pending' ? 'pending' : 'recorded');
  }

  /** Maintenance: remove historic duplicate shipments (same order + tracking number), keeping
   *  the earliest of each. Dry-run unless apply=true. Scoped to the caller's visible companies. */
  @Post('dedupe')
  dedupe(@VisibleCompanies() companyIds: string[], @Query('apply') apply?: string) {
    return this.svc.dedupe(companyIds, apply === 'true');
  }

  @Post('import/validate')
  importValidate(@Body() dto: ShipmentImportValidateDto) {
    return this.svc.importValidate(dto.rows);
  }

  @Post('import/commit')
  importCommit(@Body() dto: ShipmentImportCommitDto, @CurrentUser() user: AuthUser) {
    return this.svc.importCommit(dto.items, user.sub);
  }

  @Get('transaction/:transactionId')
  forTransaction(@Param('transactionId') transactionId: string) {
    return this.svc.forTransaction(transactionId);
  }

  @Patch('transaction/:transactionId/fulfilment')
  setFulfilment(@Param('transactionId') transactionId: string, @Body() dto: SetFulfilmentDto) {
    return this.svc.setFulfilment(transactionId, dto.status);
  }

  @Post('transaction/:transactionId/fulfil-local')
  fulfilLocal(@Param('transactionId') transactionId: string, @CurrentUser() user: AuthUser) {
    return this.svc.fulfilLocal(transactionId, user.sub);
  }

  /** Several parcels sent together on one date (size-split consignment). */
  @Post('batch')
  createBatch(@Body() dto: CreateShipmentBatchDto, @CurrentUser() user: AuthUser) {
    return this.svc.createBatch(dto, user.sub);
  }

  /** Several orders shipped together as one parcel, cost split across them. */
  @Post('combine')
  combine(@Body() dto: CreateCombinedShipmentDto, @CurrentUser() user: AuthUser) {
    return this.svc.combine(dto, user.sub);
  }

  @Post()
  create(@Body() dto: CreateShipmentDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user.sub);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateShipmentDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}

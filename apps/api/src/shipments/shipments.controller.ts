import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { ShipmentsService, type ShipmentQuery } from './shipments.service';
import { CreateShipmentDto, SetFulfilmentDto, ShipmentImportCommitDto, ShipmentImportValidateDto, UpdateShipmentDto } from './dto/shipment.dto';

@ApiTags('shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly svc: ShipmentsService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('companyId') companyId?: string,
    @Query('salesChannelId') salesChannelId?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: ShipmentQuery = { q, companyId, salesChannelId, type, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.svc.list(query);
  }

  // Literal paths before ":id".
  @Get('pending')
  pending(
    @Query('q') q?: string,
    @Query('companyId') companyId?: string,
    @Query('salesChannelId') salesChannelId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: ShipmentQuery = { q, companyId, salesChannelId, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.svc.pending(query);
  }

  @Get('export')
  exportRows(
    @Query('scope') scope?: string,
    @Query('q') q?: string,
    @Query('companyId') companyId?: string,
    @Query('salesChannelId') salesChannelId?: string,
    @Query('type') type?: string,
  ) {
    return this.svc.exportRows({ q, companyId, salesChannelId, type }, scope === 'pending' ? 'pending' : 'recorded');
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

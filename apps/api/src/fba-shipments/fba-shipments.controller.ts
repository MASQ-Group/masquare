import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FbaShipmentsService } from './fba-shipments.service';
import {
  CreateFbaShipmentDto, EstimateFbaShipmentDto, SetActualCostDto, SetStatusDto, UpdateFbaShipmentDto,
} from './dto/fba-shipment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';

@ApiTags('fba-shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fba-shipments')
export class FbaShipmentsController {
  constructor(private readonly fba: FbaShipmentsService) {}

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
  import(@Body() body: { rows?: Record<string, string>[] }, @CurrentUser() user: AuthUser) {
    return this.fba.importShipments(body?.rows ?? [], user.sub);
  }

  @Get()
  list(
    @Query('q') q?: string,
    @Query('salesChannelId') salesChannelId?: string,
    @Query('status') status?: string,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.fba.list({ q, salesChannelId, status, sortDir, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.fba.get(id);
  }

  @Post()
  create(@Body() dto: CreateFbaShipmentDto, @CurrentUser() user: AuthUser) {
    return this.fba.create(dto, user.sub);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto, @CurrentUser() user: AuthUser) {
    return this.fba.setStatus(id, dto.status, user.sub);
  }

  @Patch(':id/actual-cost')
  setActualCost(@Param('id') id: string, @Body() dto: SetActualCostDto, @CurrentUser() user: AuthUser) {
    return this.fba.setActualCost(id, dto.actualCostEur, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFbaShipmentDto, @CurrentUser() user: AuthUser) {
    return this.fba.update(id, dto, user.sub, user.isAdmin);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.fba.remove(id);
  }
}

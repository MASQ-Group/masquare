import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  /** The stock-owed register: sold-before-received shortfalls, open by default. */
  @Get('owed')
  owed(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listOwed({ status, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  /** Per-product stock status: on hand, committed, on order, available, average cost. */
  @Get()
  list(
    @Query('q') q?: string,
    @Query('vendorId') vendorId?: string,
    @Query('filter') filter?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list({
      q,
      vendorId,
      filter,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}

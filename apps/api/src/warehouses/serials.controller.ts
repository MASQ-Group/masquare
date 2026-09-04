import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { VisibleCompanies } from '../common/active-company.decorator';
import { SerialsService } from './serials.service';
import { AccessArea } from '../access/access.decorators';

@ApiTags('serials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('serials')
@AccessArea('inventory')
export class SerialsController {
  constructor(private readonly svc: SerialsService) {}

  @Get()
  list(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list({
      q, productId, warehouseId, status, companyIds,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** Serials on the shelf — what a sale or a return can pick from. */
  @Get('available/:productId')
  available(@Param('productId') productId: string, @VisibleCompanies() companyIds: string[], @Query('warehouseId') warehouseId?: string) {
    return this.svc.available(productId, warehouseId, companyIds);
  }
}

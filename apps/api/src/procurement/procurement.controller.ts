import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies, WriteCompany } from '../common/active-company.decorator';
import { ProcurementService, type DemandQuery } from './procurement.service';
import { GenerateOrdersDto } from './dto/procurement.dto';
import { AccessArea } from '../access/access.decorators';

@ApiTags('procurement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('procurement')
@AccessArea('purchasing')
export class ProcurementController {
  constructor(private readonly svc: ProcurementService) {}

  /** The demand workbench: what open sales need, and whether stock covers it. */
  @Get('demand')
  demand(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('salesChannelId') salesChannelId?: string,
    @Query('stockStatus') stockStatus?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: DemandQuery = {
      q, salesChannelId, stockStatus, companyIds, from, to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.svc.demand(query);
  }

  /** Turn a selection into draft purchase orders, one per vendor. */
  @Post('generate-orders')
  generate(@Body() dto: GenerateOrdersDto, @CurrentUser() user: AuthUser, @WriteCompany() companyId: string) {
    return this.svc.generateOrders(dto, user.sub, companyId);
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies, WriteCompany } from '../common/active-company.decorator';
import { WarehousesService } from './warehouses.service';
import { StockService } from './stock.service';
import {
  AdjustStockDto,
  CreateWarehouseDto,
  SetStockDto,
  StockImportCommitDto,
  StockImportValidateDto,
  UpdateWarehouseDto,
} from './dto/warehouse.dto';

const isTrue = (v?: string) => v === 'true' || v === '1';

@ApiTags('warehouses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly svc: WarehousesService) {}

  @Get()
  list(@VisibleCompanies() companyIds: string[], @Query('includeInactive') includeInactive?: string) {
    return this.svc.list({ includeInactive: isTrue(includeInactive), companyIds });
  }

  // Literal paths before ":id".
  @Get('tree')
  tree(@VisibleCompanies() companyIds: string[], @Query('includeInactive') includeInactive?: string) {
    return this.svc.tree({ includeInactive: isTrue(includeInactive), companyIds });
  }

  @Post()
  create(@Body() dto: CreateWarehouseDto, @CurrentUser() user: AuthUser, @WriteCompany() companyId: string) {
    return this.svc.create(dto, user.sub, companyId);
  }

  @Get(':id')
  get(@Param('id') id: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.get(id, companyIds);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto, @CurrentUser() user: AuthUser) {
    return this.svc.update(id, dto, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user.sub);
  }
}

@ApiTags('stock')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stock')
export class StockController {
  constructor(private readonly svc: StockService) {}

  @Get()
  levels(
    @VisibleCompanies() companyIds: string[],
    @Query('q') q?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('includeChildren') includeChildren?: string,
    @Query('nonZeroOnly') nonZeroOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.levels({
      q,
      warehouseId,
      companyIds,
      includeChildren: isTrue(includeChildren),
      nonZeroOnly: isTrue(nonZeroOnly),
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('movements')
  movements(
    @VisibleCompanies() companyIds: string[],
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.movements({
      productId,
      warehouseId,
      companyIds,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('import/validate')
  importValidate(@Body() dto: StockImportValidateDto) {
    return this.svc.importValidate(dto.rows);
  }

  @Post('import/commit')
  importCommit(@Body() dto: StockImportCommitDto, @CurrentUser() user: AuthUser) {
    return this.svc.importCommit(dto.items, dto.reason ?? 'opening_balance', user.sub);
  }

  @Post('adjust')
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: AuthUser) {
    return this.svc.adjust(dto, user.sub);
  }

  @Post('set')
  setLevel(@Body() dto: SetStockDto, @CurrentUser() user: AuthUser) {
    return this.svc.setLevel(dto, user.sub);
  }

  @Get('product/:productId')
  byProduct(@Param('productId') productId: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.byProduct(productId, companyIds);
  }
}

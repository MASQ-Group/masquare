import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VisibleCompanies, WriteCompany } from '../common/active-company.decorator';
import { CountriesService } from './countries.service';
import { ShippingServicesService } from './shipping-services.service';
import { SalesChannelsService } from './sales-channels.service';
import { ProfitTiersService } from './profit-tiers.service';
import { CreateCountryDto, SetCountryZoneDto, UpdateCountryDto } from './dto/country.dto';
import { CreateShippingServiceDto, UpdateShippingServiceDto } from './dto/shipping.dto';
import { CreateSalesChannelDto, UpdateSalesChannelDto } from './dto/sales-channel.dto';
import { SaveProfitTiersDto } from './dto/profit-tier.dto';

@ApiTags('global-data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('countries')
export class CountriesController {
  constructor(private readonly svc: CountriesService) {}
  @Get() list(@Query('q') q?: string) { return this.svc.list(q); }
  @Post() create(@Body() dto: CreateCountryDto, @CurrentUser() u: AuthUser) { return this.svc.create(dto, u.sub); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateCountryDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u.sub); }
  @Put(':id/shipping-zone') setZone(@Param('id') id: string, @Body() dto: SetCountryZoneDto) { return this.svc.setZone(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@ApiTags('global-data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipping-services')
export class ShippingServicesController {
  constructor(private readonly svc: ShippingServicesService) {}
  @Get() list() { return this.svc.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post() create(@Body() dto: CreateShippingServiceDto, @CurrentUser() u: AuthUser) { return this.svc.create(dto, u.sub); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateShippingServiceDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u.sub); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@ApiTags('global-data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales-channels')
export class SalesChannelsController {
  constructor(private readonly svc: SalesChannelsService) {}
  @Get() list(@VisibleCompanies() companyIds: string[], @Query('q') q?: string) { return this.svc.list(q, companyIds); }
  @Post() create(@Body() dto: CreateSalesChannelDto, @CurrentUser() u: AuthUser, @WriteCompany() companyId: string) { return this.svc.create(dto, u.sub, companyId); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateSalesChannelDto, @CurrentUser() u: AuthUser, @VisibleCompanies() companyIds: string[]) { return this.svc.update(id, dto, u.sub, companyIds); }
  @Delete(':id') remove(@Param('id') id: string, @VisibleCompanies() companyIds: string[]) { return this.svc.remove(id, companyIds); }
}

@ApiTags('global-data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profit-tiers')
export class ProfitTiersController {
  constructor(private readonly svc: ProfitTiersService) {}
  @Get() list() { return this.svc.list(); }
  @Put() saveAll(@Body() dto: SaveProfitTiersDto) { return this.svc.saveAll(dto); }
}

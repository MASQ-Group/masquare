import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessArea } from '../access/access.decorators';

@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vendors')
@AccessArea('global_settings')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  list(@Query('q') q?: string) {
    return this.vendors.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.vendors.get(id);
  }

  @Post()
  create(@Body() dto: CreateVendorDto, @CurrentUser() user: AuthUser) {
    return this.vendors.create(dto, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVendorDto, @CurrentUser() user: AuthUser) {
    return this.vendors.update(id, dto, user.sub);
  }

  /** Check the vendor's VAT number against the EU VIES service. */
  @Post(':id/verify-vat')
  verifyVat(@Param('id') id: string) {
    return this.vendors.verifyVat(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.vendors.remove(id);
  }
}

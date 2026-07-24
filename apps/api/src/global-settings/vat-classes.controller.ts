import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { VatClassesService } from './vat-classes.service';
import { CreateVatClassDto, UpdateVatClassDto } from './dto/vat-class.dto';

@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vat-classes')
export class VatClassesController {
  constructor(private readonly svc: VatClassesService) {}
  @Get() list(@Query('q') q?: string) { return this.svc.list(q); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.getOne(id); }
  @Post() create(@Body() dto: CreateVatClassDto, @CurrentUser() u: AuthUser) { return this.svc.create(dto, u.sub); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateVatClassDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u.sub); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

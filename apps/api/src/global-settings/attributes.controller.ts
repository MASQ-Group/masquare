import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttributesService } from './attributes.service';
import { AddAttributeValueDto, CreateAttributeDto, UpdateAttributeDto } from './dto/attribute.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessArea } from '../access/access.decorators';

@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('attributes')
@AccessArea('global_settings')
export class AttributesController {
  constructor(private readonly svc: AttributesService) {}

  @Get() list(@Query('q') q?: string) { return this.svc.list(q); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post() create(@Body() dto: CreateAttributeDto, @CurrentUser() u: AuthUser) { return this.svc.create(dto, u.sub); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateAttributeDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u.sub); }
  @Post(':id/values') addValue(@Param('id') id: string, @Body() dto: AddAttributeValueDto) { return this.svc.addValue(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { ProductClassesService } from './product-classes.service';
import { CreateProductClassDto, UpdateProductClassDto } from './dto/product-class.dto';
import { AccessArea } from '../access/access.decorators';

@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('product-classes')
@AccessArea('global_settings')
export class ProductClassesController {
  constructor(private readonly svc: ProductClassesService) {}
  @Get() list(@Query('q') q?: string) { return this.svc.list(q); }
  @Post() create(@Body() dto: CreateProductClassDto, @CurrentUser() u: AuthUser) { return this.svc.create(dto, u.sub); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateProductClassDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u.sub); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

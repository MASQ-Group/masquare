import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, MoveCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessArea } from '../access/access.decorators';

@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('categories')
@AccessArea('global_settings')
export class CategoriesController {
  constructor(private readonly svc: CategoriesService) {}

  @Get() list() { return this.svc.list(); }

  @Post() create(@Body() dto: CreateCategoryDto, @CurrentUser() u: AuthUser) {
    return this.svc.create(dto, u.sub);
  }

  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() u: AuthUser) {
    return this.svc.update(id, dto, u.sub);
  }

  @Put(':id/move') move(@Param('id') id: string, @Body() dto: MoveCategoryDto, @CurrentUser() u: AuthUser) {
    return this.svc.move(id, dto, u.sub);
  }

  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

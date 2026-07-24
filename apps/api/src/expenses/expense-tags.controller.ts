import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { ExpenseTagsService } from './expense-tags.service';
import { CreateExpenseTagDto, UpdateExpenseTagDto } from './dto/expense-tag.dto';

const isTrue = (v?: string) => v === 'true' || v === '1';

@ApiTags('expense-tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('expense-tags')
export class ExpenseTagsController {
  constructor(private readonly svc: ExpenseTagsService) {}

  @Get()
  list(@Query('q') q?: string, @Query('group') group?: string, @Query('includeInactive') includeInactive?: string) {
    return this.svc.list({ q, group, includeInactive: isTrue(includeInactive) });
  }

  // Literal path before ":id".
  @Get('groups')
  groups() {
    return this.svc.groups();
  }

  @Post()
  create(@Body() dto: CreateExpenseTagDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user.sub);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseTagDto, @CurrentUser() user: AuthUser) {
    return this.svc.update(id, dto, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user.sub);
  }
}

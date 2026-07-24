import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { ExpenseDefinitionsService } from './expense-definitions.service';
import { CreateExpenseDefinitionDto, UpdateExpenseDefinitionDto } from './dto/expense-definition.dto';

const isTrue = (v?: string) => v === 'true' || v === '1';

@ApiTags('expense-definitions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('expense-definitions')
export class ExpenseDefinitionsController {
  constructor(private readonly svc: ExpenseDefinitionsService) {}

  @Get()
  list(@Query('q') q?: string, @Query('categoryId') categoryId?: string, @Query('includeInactive') includeInactive?: string) {
    return this.svc.list({ q, categoryId, includeInactive: isTrue(includeInactive) });
  }

  @Post()
  create(@Body() dto: CreateExpenseDefinitionDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user.sub);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDefinitionDto, @CurrentUser() user: AuthUser) {
    return this.svc.update(id, dto, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user.sub);
  }
}

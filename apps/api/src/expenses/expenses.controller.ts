import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { ExpensesService } from './expenses.service';
import { CancelExpenseDto, CreateExpenseDto, ExpenseImportCommitDto, ExpenseImportValidateDto, SetExpenseAmountDto, UpdateExpenseDto } from './dto/expense.dto';

const isTrue = (v?: string) => v === 'true' || v === '1';

@ApiTags('expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly svc: ExpensesService) {}

  @Get()
  list(@Query('companyId') companyId?: string, @Query('includeCancelled') includeCancelled?: string) {
    return this.svc.list({ companyId, includeCancelled: isTrue(includeCancelled) });
  }

  // Literal paths before ":id".
  @Get('monthly')
  monthly(@Query('month') month: string, @Query('companyId') companyId?: string) {
    return this.svc.monthly(month, companyId);
  }

  @Get('annual')
  annual(@Query('year') year: string, @Query('companyId') companyId?: string) {
    return this.svc.annual(Number(year), companyId);
  }

  @Post()
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user.sub);
  }

  // Literal paths before ":id".
  @Post('import/validate')
  importValidate(@Body() dto: ExpenseImportValidateDto) {
    return this.svc.importValidate(dto.rows);
  }

  @Post('import/commit')
  importCommit(@Body() dto: ExpenseImportCommitDto, @CurrentUser() user: AuthUser) {
    return this.svc.importCommit(dto.rows, dto.companyId, user.sub);
  }

  @Post(':id/amount')
  setAmount(@Param('id') id: string, @Body() dto: SetExpenseAmountDto, @CurrentUser() user: AuthUser) {
    return this.svc.setAmount(id, dto, user.sub);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto, @CurrentUser() user: AuthUser) {
    return this.svc.update(id, dto, user.sub);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelExpenseDto, @CurrentUser() user: AuthUser) {
    return this.svc.cancel(id, dto, user.sub);
  }
}

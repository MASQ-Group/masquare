import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AllowedCompanies, VisibleCompanies } from '../common/active-company.decorator';
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
  list(@VisibleCompanies() companyIds: string[], @Query('includeCancelled') includeCancelled?: string) {
    return this.svc.list({ companyIds, includeCancelled: isTrue(includeCancelled) });
  }

  // Literal paths before ":id".
  @Get('monthly')
  monthly(@Query('month') month: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.monthly(month, companyIds);
  }

  @Get('annual')
  annual(@Query('year') year: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.annual(Number(year), companyIds);
  }

  @Post()
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthUser, @AllowedCompanies() allowed: string[]) {
    return this.svc.create(dto, user.sub, allowed);
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
  setAmount(@Param('id') id: string, @Body() dto: SetExpenseAmountDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.setAmount(id, dto, user.sub, companyIds);
  }

  @Get(':id')
  get(@Param('id') id: string, @VisibleCompanies() companyIds: string[]) {
    return this.svc.get(id, companyIds);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.update(id, dto, user.sub, companyIds);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelExpenseDto, @CurrentUser() user: AuthUser, @VisibleCompanies() companyIds: string[]) {
    return this.svc.cancel(id, dto, user.sub, companyIds);
  }
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { EXPENSE_OCCURRENCES } from './expense-definition.dto';

const MONTH = /^\d{4}-\d{2}$/;

export class ExpenseImportValidateDto {
  @IsArray() rows!: Record<string, string>[];
}

export class ExpenseImportCommitDto {
  @IsUUID() companyId!: string;
  @IsArray() rows!: Record<string, string>[];
}

export class CreateExpenseDto {
  @ApiProperty()
  @IsUUID()
  definitionId!: string;

  @ApiProperty()
  @IsUUID()
  companyId!: string;

  @ApiProperty({ enum: EXPENSE_OCCURRENCES })
  @IsIn(EXPENSE_OCCURRENCES as unknown as string[])
  occurrence!: 'monthly' | 'annual' | 'once_off';

  @ApiPropertyOptional({ description: 'ISO currency code; defaults to EUR.' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiProperty({ description: 'Amount in the chosen currency.' })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ description: "Recurring only: first month it applies, 'YYYY-MM'. Supports back-dating. Defaults to the current month." })
  @IsOptional()
  @Matches(MONTH, { message: 'startMonth must be YYYY-MM' })
  startMonth?: string;

  @ApiPropertyOptional({ description: 'Once-off only: the expense date (ISO). Its month is where it lands.' })
  @IsOptional()
  @IsISO8601()
  onceOffDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ description: 'Optional tracking tag id (e.g. a specific car).' })
  @IsOptional()
  @IsUUID()
  tagId?: string | null;
}

export class UpdateExpenseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  definitionId?: string;

  @ApiPropertyOptional({ enum: EXPENSE_OCCURRENCES })
  @IsOptional()
  @IsIn(EXPENSE_OCCURRENCES as unknown as string[])
  occurrence?: 'monthly' | 'annual' | 'once_off';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ description: 'New base (starting) amount in the chosen currency.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: "Recurring only: first month it applies, 'YYYY-MM'." })
  @IsOptional()
  @Matches(MONTH, { message: 'startMonth must be YYYY-MM' })
  startMonth?: string;

  @ApiPropertyOptional({ description: 'Once-off only: the expense date (ISO).' })
  @IsOptional()
  @IsISO8601()
  onceOffDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ description: 'Optional tracking tag id; null clears it.' })
  @IsOptional()
  @IsUUID()
  tagId?: string | null;
}

export class CancelExpenseDto {
  @ApiPropertyOptional({ description: "Last active month, 'YYYY-MM'. Defaults to the current month." })
  @IsOptional()
  @Matches(MONTH, { message: 'month must be YYYY-MM' })
  month?: string;
}

export const AMOUNT_SCOPES = ['this_month', 'all_following'] as const;

export class SetExpenseAmountDto {
  @ApiProperty({ description: "The month being edited, 'YYYY-MM'." })
  @Matches(MONTH, { message: 'month must be YYYY-MM' })
  month!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ enum: AMOUNT_SCOPES, description: "'this_month' overrides just this month; 'all_following' changes the amount from this month onward." })
  @IsIn(AMOUNT_SCOPES as unknown as string[])
  scope!: 'this_month' | 'all_following';
}

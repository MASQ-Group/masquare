import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const EXPENSE_OCCURRENCES = ['monthly', 'annual', 'once_off'] as const;
export type ExpenseOccurrence = (typeof EXPENSE_OCCURRENCES)[number];

export class CreateExpenseDefinitionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ description: 'Category id — omit to leave uncategorised.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ enum: EXPENSE_OCCURRENCES, description: 'Pre-fills the occurrence when registering — not binding.' })
  @IsOptional()
  @IsIn(EXPENSE_OCCURRENCES as unknown as string[])
  defaultOccurrence?: ExpenseOccurrence | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateExpenseDefinitionDto extends PartialType(CreateExpenseDefinitionDto) {}

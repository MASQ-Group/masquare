import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateExpenseCategoryDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'Parent category id — omit for a root category.' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class UpdateExpenseCategoryDto extends PartialType(CreateExpenseCategoryDto) {}

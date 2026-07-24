import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateExpenseTagDto {
  @ApiProperty({ description: 'The tag value, e.g. a car plate "CY-1234 — Toyota Yaris".' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'Optional group, e.g. "Cars" — lets reports slice a whole group.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  group?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateExpenseTagDto extends PartialType(CreateExpenseTagDto) {}

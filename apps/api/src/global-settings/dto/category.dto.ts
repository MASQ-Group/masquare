import { IsInt, IsOptional, IsString, IsUUID, MinLength, ValidateIf } from 'class-validator';

export class CreateCategoryDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsUUID() parentId?: string;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
}

export class MoveCategoryDto {
  // null = move to top level (Level 1)
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  parentId!: string | null;

  @IsOptional() @IsInt() sortOrder?: number;
}

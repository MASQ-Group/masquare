import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateProductClassDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateProductClassDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

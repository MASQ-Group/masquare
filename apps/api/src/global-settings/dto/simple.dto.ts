import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBrandDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() website?: string;
}
export class UpdateBrandDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() website?: string;
}

export class CreateProductTypeDto {
  @IsString() @MinLength(1) name!: string;
}
export class UpdateProductTypeDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
}

export class CreateFulfilmentTypeDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateFulfilmentTypeDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

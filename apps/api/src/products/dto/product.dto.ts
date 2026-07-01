import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MoneyDto {
  @IsOptional() @IsNumber() amount?: number | null;
  @IsOptional() @IsString() currency?: string;
}

export class SkuAliasDto {
  @IsString() @MinLength(1) skuValue!: string;
  @IsOptional() @IsString() label?: string;
}

export class ProductAttributeDto {
  @IsUUID() attributeId!: string;
  @IsString() value!: string;
}

export class CreateProductDto {
  @IsString() @MinLength(1) mainSku!: string;
  @IsString() @MinLength(1) title!: string;

  @IsOptional() @IsUUID() brandId?: string | null;
  @IsOptional() @IsUUID() vendorId?: string | null;
  @IsOptional() @IsUUID() productTypeId?: string | null;
  @IsOptional() @IsUUID() fulfilmentTypeId?: string | null;
  @IsOptional() @IsUUID() categoryId?: string | null;

  @IsOptional() @IsString() ean?: string;
  @IsOptional() @IsString() upc?: string;
  @IsOptional() @IsString() vendorSku?: string;
  @IsOptional() @IsString() manufacturerSku?: string;
  @IsOptional() @IsString() countryOfOrigin?: string;
  @IsOptional() @IsString() hsCode?: string;

  @IsOptional() @ValidateNested() @Type(() => MoneyDto) purchaseCost?: MoneyDto;
  @IsOptional() @ValidateNested() @Type(() => MoneyDto) map?: MoneyDto;
  @IsOptional() @ValidateNested() @Type(() => MoneyDto) msrp?: MoneyDto;

  @IsOptional() @IsNumber() productWeightKg?: number | null;
  @IsOptional() @IsNumber() packageWeightKg?: number | null;
  @IsOptional() @IsNumber() packageLengthCm?: number | null;
  @IsOptional() @IsNumber() packageWidthCm?: number | null;
  @IsOptional() @IsNumber() packageHeightCm?: number | null;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SkuAliasDto)
  aliases?: SkuAliasDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProductAttributeDto)
  attributes?: ProductAttributeDto[];
}

export class UpdateProductDto extends CreateProductDto {
  @IsOptional() @IsString() @MinLength(1) declare mainSku: string;
  @IsOptional() @IsString() @MinLength(1) declare title: string;
}

export class ReorderMediaDto {
  @IsArray() @IsUUID('all', { each: true }) orderedIds!: string[];
}

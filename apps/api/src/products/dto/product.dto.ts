import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
  @IsOptional() @IsUUID() fulfilmentTypeId?: string | null;
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
  @IsOptional() @IsUUID() vatClassId?: string | null;
  @IsOptional() @IsUUID() productClassId?: string | null;
  /** Track individual units by serial number — enforced at receiving and at sale. */
  @IsOptional() @IsBoolean() serialTracked?: boolean;

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

  // ---- Listing content --------------------------------------------------
  // Only eBay and Shopify ever show any of this; Amazon and OnBuy display their own catalogue copy.
  @IsOptional() @IsString() ebayTitle?: string | null;
  /** One or two sentences for a buyer deciding in seconds — shown above the full description. */
  @IsOptional() @IsString() shortDescription?: string | null;
  @IsOptional() @IsString() descriptionHtml?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) keyFeatures?: string[];
  @IsOptional() @IsString() searchKeywords?: string | null;

  // ---- Technical facts --------------------------------------------------
  // References into the compliance vocabulary, never free text: these are compared by machine, and
  // an answer that varies with whoever typed it is not comparable.
  @IsOptional() @IsUUID() voltageRatingId?: string | null;
  @IsOptional() @IsUUID() frequencyId?: string | null;
  @IsOptional() @IsUUID() plugTypeId?: string | null;
  @IsOptional() @IsBoolean() batteryRequired?: boolean | null;
  @IsOptional() @IsUUID() batteryTypeId?: string | null;
  @IsOptional() @IsUUID() hazmatClassId?: string | null;

  // ---- Product-level compliance -----------------------------------------
  @IsOptional() @IsString() warrantyText?: string | null;
  @IsOptional() @IsString() dangerousGoodsNote?: string | null;

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

// --- Bulk & import ---------------------------------------------------------
export class BulkDeleteDto {
  @IsArray() @IsUUID('all', { each: true }) ids!: string[];
}

export class BulkUpdateDto {
  @IsArray() @IsUUID('all', { each: true }) ids!: string[];
  @IsOptional() @IsUUID() productTypeId?: string | null;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsOptional() @IsUUID() fulfilmentTypeId?: string | null;
  @IsOptional() @IsUUID() brandId?: string | null;
  @IsOptional() @IsUUID() vendorId?: string | null;
  @IsOptional() @IsUUID() vatClassId?: string | null;
  @IsOptional() @IsUUID() productClassId?: string | null;
  /** Track individual units by serial number — enforced at receiving and at sale. */
  @IsOptional() @IsBoolean() serialTracked?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProductAttributeDto)
  attributes?: ProductAttributeDto[];
}

export class ByIdsDto {
  @IsArray() @IsUUID('all', { each: true }) ids!: string[];
}

export class ImportValidateDto {
  @IsString() purpose!: 'add' | 'edit';
  @IsArray() rows!: Record<string, string>[];
}

export class ImportCommitItemDto {
  @IsOptional() row!: Record<string, string>;
  @IsString() action!: 'add' | 'edit' | 'skip';
  @IsOptional() @IsUUID() productId?: string;
}

export class ImportCommitDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ImportCommitItemDto)
  items!: ImportCommitItemDto[];
}

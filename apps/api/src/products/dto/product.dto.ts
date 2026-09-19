import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
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
  // eBay and Shopify show this; Amazon displays its own catalogue copy. OnBuy has its own fields below,
  // used only when the platform creates a product on OnBuy.
  @IsOptional() @IsString() ebayTitle?: string | null;
  /** One or two sentences for a buyer deciding in seconds — shown above the full description. */
  @IsOptional() @IsString() shortDescription?: string | null;
  @IsOptional() @IsString() descriptionHtml?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) keyFeatures?: string[];
  @IsOptional() @IsString() searchKeywords?: string | null;
  @IsOptional() @IsString() onbuyTitle?: string | null;
  @IsOptional() @IsString() onbuyDescriptionHtml?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) onbuySummaryPoints?: string[];

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

  /**
   * When the product was last saved, as the caller last saw it. Optional, and only the product card
   * sends it.
   *
   * The card holds a copy of the whole product from the moment it opened and saves every field back.
   * Anything written to the product while it sat open — Claude's research through the connector, or a
   * colleague's edit — was silently overwritten with the card's older copy. That is exactly how a
   * researched description and its features vanished 81 seconds after being written. With this set,
   * a save onto a product that has changed since is refused instead, and nothing is lost.
   */
  @IsOptional() @IsString() expectedUpdatedAt?: string;

  /**
   * What each field being saved showed when the card opened, keyed as in this DTO. With it, a save
   * onto a product that changed since goes through when none of ITS fields moved — research writing the
   * description no longer blocks a weight fix — and is refused, naming the field, when one did.
   */
  @IsOptional() @IsObject() expectedValues?: Record<string, unknown>;
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

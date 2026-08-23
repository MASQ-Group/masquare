import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * GPSR contacts, held on the brand rather than the product.
 *
 * They describe a company: Fissler's responsible person is the same on every Fissler line. Nothing
 * is required — no channel demands these of us yet — but the fields exist so that when one does,
 * the answer is already in the platform rather than in somebody's inbox.
 */
class BrandComplianceDto {
  @IsOptional() @IsString() manufacturerName?: string | null;
  @IsOptional() @IsString() manufacturerAddress?: string | null;
  @IsOptional() @IsString() manufacturerEmail?: string | null;
  @IsOptional() @IsString() manufacturerPhone?: string | null;
  @IsOptional() @IsString() manufacturerContactUrl?: string | null;
  /** Required by GPSR when the manufacturer sits outside the EU. */
  @IsOptional() @IsString() euRpName?: string | null;
  @IsOptional() @IsString() euRpAddress?: string | null;
  @IsOptional() @IsString() euRpEmail?: string | null;
  @IsOptional() @IsString() euRpPhone?: string | null;
  @IsOptional() @IsString() euRpContactUrl?: string | null;
}

export class CreateBrandDto extends BrandComplianceDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() website?: string;
}
export class UpdateBrandDto extends BrandComplianceDto {
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

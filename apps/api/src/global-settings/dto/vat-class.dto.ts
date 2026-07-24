import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** Zero-rated and Exempt are both 0% but are not interchangeable on a VAT return,
 *  so the treatment is stored explicitly rather than inferred from the rate. */
export const VAT_TAX_TREATMENTS = ['standard', 'reduced', 'zero', 'exempt'] as const;
export type VatTaxTreatment = (typeof VAT_TAX_TREATMENTS)[number];

export class CreateVatClassDto {
  @IsString() @MinLength(1) name!: string;
  @IsNumber() @Min(0) @Max(100) ratePct!: number;
  @IsIn(VAT_TAX_TREATMENTS) taxTreatment!: VatTaxTreatment;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateVatClassDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) ratePct?: number;
  @IsOptional() @IsIn(VAT_TAX_TREATMENTS) taxTreatment?: VatTaxTreatment;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

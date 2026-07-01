import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Length, MinLength, ValidateIf } from 'class-validator';

export class CreateCountryDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @Length(2, 3) isoCode!: string;
  @IsString() @MinLength(1) continent!: string;
  @IsOptional() @IsBoolean() euVatZone?: boolean;
  @IsOptional() @IsNumber() vatRate?: number;
  @IsOptional() @IsUUID() defaultShippingServiceId?: string | null;
}

export class UpdateCountryDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @Length(2, 3) isoCode?: string;
  @IsOptional() @IsString() @MinLength(1) continent?: string;
  @IsOptional() @IsBoolean() euVatZone?: boolean;
  @IsOptional() @IsNumber() vatRate?: number;
  @IsOptional() @IsUUID() defaultShippingServiceId?: string | null;
}

/** Set (or clear) which zone of a shipping service applies to this country. */
export class SetCountryZoneDto {
  @IsUUID() shippingServiceId!: string;
  @ValidateIf((_o, v) => v !== null) @IsUUID() zoneId!: string | null;
}

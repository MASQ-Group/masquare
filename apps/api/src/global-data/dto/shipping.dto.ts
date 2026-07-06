import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

export class ShippingZoneDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) countryIds?: string[];
}

export class ShippingRateDto {
  @IsString() @MinLength(1) zoneName!: string; // references a zone by name
  @IsNumber() fromWeightKg!: number;
  @IsNumber() toWeightKg!: number;
  @IsNumber() chargeEur!: number;
}

export class CreateShippingServiceDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() alias?: string;
  @IsOptional() @IsString() trackingUrlTemplate?: string | null;
  @IsIn(['actual_weight', 'volumetric_weight']) calcMethod!: 'actual_weight' | 'volumetric_weight';

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ShippingZoneDto)
  zones?: ShippingZoneDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ShippingRateDto)
  rates?: ShippingRateDto[];
}

export class UpdateShippingServiceDto extends CreateShippingServiceDto {
  @IsOptional() @IsString() @MinLength(1) declare name: string;
  @IsOptional() @IsIn(['actual_weight', 'volumetric_weight']) declare calcMethod: 'actual_weight' | 'volumetric_weight';
}

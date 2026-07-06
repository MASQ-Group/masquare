import { Type } from 'class-transformer';
import {
  IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID,
  Min, ValidateNested,
} from 'class-validator';

export class FbaShipmentLineDto {
  @IsString() sku!: string;
  @IsOptional() @IsUUID() productId?: string | null;
  @IsInt() @Min(1) quantity!: number;
}

export class FbaShipmentBoxDto {
  @IsOptional() @IsString() label?: string | null;
  @IsOptional() @IsNumber() @Min(0) emptyWeightKg?: number | null;
  @IsOptional() @IsNumber() @Min(0) lengthCm?: number | null;
  @IsOptional() @IsNumber() @Min(0) widthCm?: number | null;
  @IsOptional() @IsNumber() @Min(0) heightCm?: number | null;
  @IsOptional() @IsString() trackingNumber?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => FbaShipmentLineDto)
  items!: FbaShipmentLineDto[];
}

/** Shared shape for estimate-preview and create/update. Boxes drive weight & cost. */
export class FbaShipmentBaseDto {
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsUUID() salesChannelId?: string | null;
  @IsOptional() @IsString() fbaShipmentRef?: string | null;
  @IsOptional() @IsUUID() shippingServiceId?: string | null;
  @IsOptional() @IsNumber() @Min(0) packagingPct?: number;
  @IsOptional() @IsString() comments?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => FbaShipmentBoxDto)
  boxes!: FbaShipmentBoxDto[];
}

/** Preview the weight/cost/allocation without persisting. */
export class EstimateFbaShipmentDto extends FbaShipmentBaseDto {}

export class CreateFbaShipmentDto extends FbaShipmentBaseDto {
  @IsOptional() @IsIn(['draft', 'confirmed']) status?: 'draft' | 'confirmed';
}

export class UpdateFbaShipmentDto extends FbaShipmentBaseDto {
  @IsOptional() @IsIn(['draft', 'confirmed']) status?: 'draft' | 'confirmed';
}

export class SetActualCostDto {
  @IsNumber() @Min(0) actualCostEur!: number;
}

export class SetStatusDto {
  @IsIn(['draft', 'confirmed']) status!: 'draft' | 'confirmed';
}

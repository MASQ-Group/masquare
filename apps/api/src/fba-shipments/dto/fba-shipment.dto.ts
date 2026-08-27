import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID,
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

/** One channel's part in a fulfilment pool. */
export class PoolChannelDto {
  @IsString() salesChannelId!: string;
  /** Inbound shipments to this channel feed the pool's cost. */
  @IsOptional() @IsBoolean() receives?: boolean;
  /** Orders on this channel draw the pool's average. */
  @IsOptional() @IsBoolean() sells?: boolean;
}

/**
 * A set of channels sharing one pool of inbound stock — Amazon's Pan-European FBA and anything
 * like it. `channels` left undefined on an update means "leave the membership alone"; sent as a
 * list it replaces the membership wholesale.
 */
export class PoolDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  /** ISO dates. Judged against the ORDER date, so historic orders keep the figure true for them. */
  @IsOptional() @IsString() effectiveFrom?: string | null;
  @IsOptional() @IsString() effectiveTo?: string | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PoolChannelDto) channels?: PoolChannelDto[];
}

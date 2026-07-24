import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export const WAREHOUSE_TYPES = ['physical', 'virtual'] as const;

export class CreateWarehouseDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: WAREHOUSE_TYPES })
  @IsOptional()
  @IsIn(WAREHOUSE_TYPES as unknown as string[])
  type?: 'physical' | 'virtual';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentWarehouseId?: string | null;

  @ApiPropertyOptional({ description: 'Does stock here count toward company-wide availability?' })
  @IsOptional()
  @IsBoolean()
  includeInInventory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {}

/** Reasons a stock balance may change by hand. Receiving/sales write their own. */
export const ADJUSTMENT_REASONS = ['opening_balance', 'adjustment', 'damage', 'stocktake'] as const;

export class AdjustStockDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ description: 'Signed change: +5 adds five, -5 removes five.' })
  @IsInt()
  qtyDelta!: number;

  @ApiProperty({ enum: ADJUSTMENT_REASONS })
  @IsIn(ADJUSTMENT_REASONS as unknown as string[])
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

/** Set an absolute count (stocktake): the service works out the delta. */
export class SetStockDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty()
  @IsInt()
  quantityOnHand!: number;

  @ApiProperty({ enum: ADJUSTMENT_REASONS })
  @IsIn(ADJUSTMENT_REASONS as unknown as string[])
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class StockImportRowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  warehouse?: string;

  @ApiPropertyOptional()
  @IsOptional()
  quantity?: string | number;
}

export class StockImportValidateDto {
  @ApiProperty({ type: [StockImportRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockImportRowDto)
  rows!: StockImportRowDto[];
}

export class StockImportItemDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty()
  @IsInt()
  quantityOnHand!: number;
}

export class StockImportCommitDto {
  @ApiProperty({ type: [StockImportItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockImportItemDto)
  items!: StockImportItemDto[];

  @ApiPropertyOptional({ description: 'Reason written to the movement log. Defaults to opening_balance.' })
  @IsOptional()
  @IsIn(ADJUSTMENT_REASONS as unknown as string[])
  reason?: string;
}

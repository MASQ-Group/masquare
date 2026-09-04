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

// ===========================================================================
// Manual inventory operations: transfers between warehouses, and adjustments.
// ===========================================================================

/**
 * What a manual adjustment does to the balance.
 *
 * `set` states the true count and the service derives the delta — a stocktake. `add` and `remove`
 * state the change itself, which is what someone has when they are holding three boxes rather than
 * recounting a shelf.
 *
 * Serial-tracked products may only use `add` or `remove`. A `set` there would mean "these are all
 * the serials present", quietly writing off every unit not listed — a paste that came up short
 * would scrap real stock with no warning. Naming the units to move keeps the destructive case
 * impossible to reach by accident.
 */
export const ADJUSTMENT_MODES = ['set', 'add', 'remove'] as const;
export type AdjustmentMode = (typeof ADJUSTMENT_MODES)[number];

/** Where a removed unit went. Only meaningful when serials leave the shelf. */
export const SERIAL_REMOVAL_DISPOSITIONS = ['scrapped', 'returned_to_vendor'] as const;

export class ManualAdjustDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ enum: ADJUSTMENT_MODES })
  @IsIn(ADJUSTMENT_MODES as unknown as string[])
  mode!: AdjustmentMode;

  @ApiPropertyOptional({ description: 'Required for non-serial products. Derived from the serial list otherwise.' })
  @IsOptional()
  @IsInt()
  quantity?: number;

  @ApiPropertyOptional({ type: [String], description: 'Required for serial-tracked products.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serials?: string[];

  @ApiProperty({ enum: ADJUSTMENT_REASONS })
  @IsIn(ADJUSTMENT_REASONS as unknown as string[])
  reason!: string;

  @ApiPropertyOptional({ enum: SERIAL_REMOVAL_DISPOSITIONS, description: 'Where removed serials went. Defaults to scrapped.' })
  @IsOptional()
  @IsIn(SERIAL_REMOVAL_DISPOSITIONS as unknown as string[])
  disposition?: 'scrapped' | 'returned_to_vendor';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class TransferLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsInt()
  quantity!: number;

  @ApiPropertyOptional({ type: [String], description: 'Required for serial-tracked products; must number exactly `quantity`.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serials?: string[];
}

export class CreateTransferDto {
  @ApiProperty()
  @IsUUID()
  fromWarehouseId!: string;

  @ApiProperty()
  @IsUUID()
  toWarehouseId!: string;

  @ApiProperty({ type: [TransferLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

// ---------------------------------------------------------------- imports

/** One spreadsheet row, still as typed. Everything is optional so a blank cell reports
 *  as a missing value rather than failing validation before the row can be explained. */
export class TransferImportRowDto {
  @ApiPropertyOptional() @IsOptional() @IsString() sku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fromWarehouse?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() toWarehouse?: string;
  @ApiPropertyOptional() @IsOptional() quantity?: string | number;
  @ApiPropertyOptional() @IsOptional() @IsString() serials?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class TransferImportValidateDto {
  @ApiProperty({ type: [TransferImportRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferImportRowDto)
  rows!: TransferImportRowDto[];
}

export class AdjustmentImportRowDto {
  @ApiPropertyOptional() @IsOptional() @IsString() sku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() warehouse?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() quantity?: string | number;
  @ApiPropertyOptional() @IsOptional() @IsString() serials?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class AdjustmentImportValidateDto {
  @ApiProperty({ type: [AdjustmentImportRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdjustmentImportRowDto)
  rows!: AdjustmentImportRowDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { ALLOCATION_METHODS, type AllocationMethod } from './purchase-order.dto';

export class ReceiptLineInput {
  @ApiProperty({ description: 'Goods receipt line id.' })
  @IsUUID()
  lineId!: string;

  @ApiProperty({ description: 'Quantity actually received for this line.' })
  @IsInt()
  @Min(0)
  quantityReceived!: number;

  /**
   * One serial per unit, for serial-tracked products only. The count must equal
   * quantityReceived — a unit without an identity is not received.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  serials?: string[];
}

export class PostGoodsReceiptDto {
  @ApiProperty({ type: [ReceiptLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineInput)
  lines!: ReceiptLineInput[];

  @ApiPropertyOptional({ description: 'Where the stock lands. Defaults to the receipt/PO warehouse.' })
  @IsOptional()
  @IsUUID()
  destinationWarehouseId?: string | null;

  /** Receiving more than was ordered is refused unless the user explicitly confirms. */
  @ApiPropertyOptional({ description: 'Confirm an over-receipt (received > outstanding).' })
  @IsOptional()
  @IsBoolean()
  allowOverReceipt?: boolean;

  /**
   * Close the PO short: post what arrived and accept the shortfall instead of raising a
   * backorder. The PO is marked received with the shortfall recorded in its history.
   */
  @ApiPropertyOptional({ description: 'Accept the shortfall and close the PO instead of backordering.' })
  @IsOptional()
  @IsBoolean()
  closeShort?: boolean;

  // --- Landed costs actually invoiced for this shipment ------------------------
  // Pre-filled with this receipt's pro-rata share of the PO figures; the user corrects
  // them against the freight and clearance invoices that arrive with the goods.
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) shippingCost?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3) shippingCurrency?: string;
  @ApiPropertyOptional({ enum: ALLOCATION_METHODS })
  @IsOptional() @IsIn(ALLOCATION_METHODS) shippingAllocation?: AllocationMethod;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) customsDuty?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3) customsDutyCurrency?: string;
  @ApiPropertyOptional({ enum: ALLOCATION_METHODS })
  @IsOptional() @IsIn(ALLOCATION_METHODS) customsDutyAllocation?: AllocationMethod;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) importHandling?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3) importHandlingCurrency?: string;
  @ApiPropertyOptional({ enum: ALLOCATION_METHODS })
  @IsOptional() @IsIn(ALLOCATION_METHODS) importHandlingAllocation?: AllocationMethod;

  /** Reporting only — never enters product cost. */
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) importVat?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3) importVatCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class CancelGoodsReceiptDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class PurchaseOrderLineInput {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantityOrdered!: number;

  @ApiProperty({ description: 'Unit cost in the PO currency.' })
  @Type(() => Number)
  @Min(0)
  unitCost!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

/** How an ancillary cost is spread over the received lines. */
export const ALLOCATION_METHODS = ['weight', 'volumetric', 'quantity', 'value'] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

export class CreatePurchaseOrderDto {
  @ApiProperty()
  @IsUUID()
  companyId!: string;

  @ApiProperty()
  @IsUUID()
  vendorId!: string;

  @ApiPropertyOptional({ description: 'ISO currency code. Defaults to EUR.' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsString()
  expectedDeliveryDate?: string | null;

  // --- FX -----------------------------------------------------------------
  /** Working rate: units of the order currency per 1 EUR. Ignored for EUR orders. */
  @ApiPropertyOptional({ description: 'Units of the order currency per 1 EUR.' })
  @IsOptional() @Type(() => Number) @Min(0)
  fxRate?: number | null;

  /** What actually settled the vendor invoice, in EUR. Beats fxRate once known. */
  @ApiPropertyOptional({ description: 'Actual EUR paid to settle this order.' })
  @IsOptional() @Type(() => Number) @Min(0)
  amountPaidEur?: number | null;

  // --- Ancillary landed costs ----------------------------------------------
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

  /** Reporting only — never enters product cost, so it has no allocation method. */
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) importVat?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3) importVatCurrency?: string;

  /** Overrides the vendor's VAT treatment for this order only. */
  @ApiPropertyOptional({ enum: ['standard', 'reverse_charge', 'outside_scope'] })
  @IsOptional()
  @IsIn(['standard', 'reverse_charge', 'outside_scope'])
  vatTreatment?: 'standard' | 'reverse_charge' | 'outside_scope';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  destinationWarehouseId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiProperty({ type: [PurchaseOrderLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineInput)
  lines!: PurchaseOrderLineInput[];
}

/** Draft edit — same shape as create; a full replace of the header + lines. */
export class UpdatePurchaseOrderDto extends CreatePurchaseOrderDto {}

export class CancelPurchaseOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

/** Admin-supplied note recorded in the PO status history. */
export class UnlockPurchaseOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class RequestUnlockDto {
  @ApiPropertyOptional({ description: 'Why the order needs reopening — shown to the admin.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

export class DecideUnlockDto {
  @ApiProperty({ description: 'true approves and unlocks, false denies.' })
  @IsBoolean()
  grant!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** One line of an amendment: an existing line to restate, or a new line to add. */
export class AmendLineInput {
  @ApiPropertyOptional({ description: 'Omit to add a new line.' })
  @IsOptional() @IsUUID() purchaseOrderLineId?: string;

  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) quantityOrdered!: number;
  @ApiProperty() @Type(() => Number) @Min(0) unitCost!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string | null;
}

/** Admin amendment of an order that has already been submitted or received. */
export class AmendPurchaseOrderDto {
  @ApiProperty({ type: [AmendLineInput] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AmendLineInput)
  lines!: AmendLineInput[];

  @ApiPropertyOptional({ description: 'Recorded in the order status history.' })
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

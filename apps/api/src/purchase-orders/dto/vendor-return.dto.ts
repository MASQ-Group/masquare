import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export interface VendorReturnQuery {
  q?: string;
  vendorId?: string;
  purchaseOrderId?: string;
  /** Enforced company isolation. */
  companyIds?: string[];
  page?: number;
  pageSize?: number;
}

export class VendorReturnLineInput {
  @ApiProperty() @IsUUID() productId!: string;

  /** Ties the return to an ordered line so the PO's received quantity comes back down. */
  @ApiPropertyOptional() @IsOptional() @IsUUID() purchaseOrderLineId?: string;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) quantity!: number;
}

export class CreateVendorReturnDto {
  @ApiProperty() @IsUUID() vendorId!: string;

  /** Optional: a return can stand alone, e.g. for stock whose order is long closed. */
  @ApiPropertyOptional() @IsOptional() @IsUUID() purchaseOrderId?: string;

  @ApiProperty({ description: 'Warehouse the stock physically leaves from.' })
  @IsUUID() warehouseId!: string;

  @ApiProperty({ description: 'Why it is going back — shown on the document.' })
  @IsString() @MaxLength(300) reason!: string;

  @ApiPropertyOptional({ description: "The vendor's credit note, once it exists." })
  @IsOptional() @IsString() @MaxLength(120) creditNoteRef?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @ApiProperty({ type: [VendorReturnLineInput] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => VendorReturnLineInput)
  lines!: VendorReturnLineInput[];
}

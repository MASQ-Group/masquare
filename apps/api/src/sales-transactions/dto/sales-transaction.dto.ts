import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength, ValidateNested,
} from 'class-validator';

export class SalesTransactionItemDto {
  @IsOptional() @IsUUID() productId?: string | null;
  @IsString() @MinLength(1) sku!: string;
  @IsInt() @Min(1) quantity!: number;

  @IsOptional() @IsNumber() netSalesAmount?: number | null;
  @IsOptional() @IsNumber() vatAmount?: number | null;
  @IsOptional() @IsNumber() shippingAmount?: number | null;
  @IsOptional() @IsNumber() shippingAmountVat?: number | null;
  @IsOptional() @IsNumber() salesChannelSalesFeeAmount?: number | null;
}

export class CreateSalesTransactionDto {
  @IsDateString() date!: string;
  @IsString() @MinLength(1) transactionRef!: string;
  @IsOptional() @IsUUID() salesChannelId?: string | null;
  @IsOptional() @IsUUID() destinationCountryId?: string | null;
  @IsOptional() @IsUUID() shippingServiceId?: string | null;
  @IsOptional() @IsUUID() companyId?: string | null;
  @IsOptional() @IsNumber() destinationVatPct?: number | null;
  @IsOptional() @IsBoolean() vatOverridden?: boolean;
  @IsOptional() @IsIn(['draft', 'submitted']) status?: 'draft' | 'submitted';

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SalesTransactionItemDto)
  items!: SalesTransactionItemDto[];
}

export class DecideUnlockDto {
  @IsBoolean() grant!: boolean;
}

export class ResolveTransactionDto {
  @IsIn(['none', 'cancelled', 'returned', 'replaced']) resolution!: 'none' | 'cancelled' | 'returned' | 'replaced';
  @IsOptional() @IsNumber() refundAmount?: number | null;
  @IsOptional() @IsBoolean() restockItems?: boolean;
  @IsOptional() @IsBoolean() feeRefunded?: boolean;
  @IsOptional() @IsString() resolutionNotes?: string | null;
}

export class UpdateSalesTransactionDto extends CreateSalesTransactionDto {
  @IsOptional() @IsDateString() declare date: string;
  @IsOptional() @IsString() @MinLength(1) declare transactionRef: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SalesTransactionItemDto) declare items: SalesTransactionItemDto[];
}

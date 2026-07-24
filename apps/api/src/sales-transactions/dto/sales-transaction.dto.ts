import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength, ValidateNested,
} from 'class-validator';

export class SalesTransactionItemDto {
  @IsOptional() @IsUUID() productId?: string | null;
  @IsString() @MinLength(1) sku!: string;
  @IsInt() @Min(1) quantity!: number;

  @IsOptional() @IsNumber() netSalesAmount?: number | null;
  /** Ignored for local sales — the server computes VAT from vatClassId and overwrites it. */
  @IsOptional() @IsNumber() vatAmount?: number | null;
  @IsOptional() @IsNumber() shippingAmount?: number | null;
  @IsOptional() @IsNumber() shippingAmountVat?: number | null;
  @IsOptional() @IsNumber() salesChannelSalesFeeAmount?: number | null;
  @IsOptional() @IsNumber() fbaFulfilmentFeeAmount?: number | null;
  @IsOptional() @IsNumber() amazonPointsAmount?: number | null;

  /**
   * Which physical units are leaving, for serial-tracked products. Required before the
   * transaction can be submitted; the count must equal the quantity.
   */
  @IsOptional() @IsArray() @IsString({ each: true }) serials?: string[];
  @IsOptional() @IsNumber() salesTaxAmount?: number | null;
  /** Local sales: which VAT class applies to this line. Defaults to the product's class. */
  @IsOptional() @IsUUID() vatClassId?: string | null;
  /** Override the product's stored unit purchase cost for this line only (EUR). */
  @IsOptional() @IsNumber() @Min(0) unitNetCostEur?: number | null;
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
  // Set by importers (not exposed in the UI).
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsUUID() integrationId?: string | null;
  @IsOptional() @IsIn(['pending', 'shipped', 'cancelled']) fulfilmentStatus?: 'pending' | 'shipped' | 'cancelled';
  // Shipment status reported by the sales channel API (importers only).
  @IsOptional() @IsIn(['shipped', 'not_shipped']) channelShipmentStatus?: 'shipped' | 'not_shipped';
  // Fulfilment type from the channel (Amazon AFN→FBA, MFN→FBM). Importers only.
  @IsOptional() @IsIn(['FBA', 'FBM']) fulfilmentType?: 'FBA' | 'FBM';

  // --- Local sales only (channel.kind === 'local') ---
  // How the goods left us. A label for the record; there is no carrier to derive it from.
  @IsOptional() @IsIn(['pickup', 'own_delivery']) deliveryMethod?: 'pickup' | 'own_delivery' | null;
  // Ad-hoc delivery cost for this sale, in EUR. No weight/zone estimate applies locally.
  @IsOptional() @IsNumber() @Min(0) localShippingCostEur?: number | null;
  // Sale-level discount. The server spreads it across the lines and recomputes each line's
  // net and VAT, so the client never decides what the discount is worth.
  @IsOptional() @IsIn(['percentage', 'fixed']) discountType?: 'percentage' | 'fixed' | null;
  @IsOptional() @IsNumber() @Min(0) discountValue?: number | null;
  // Discount base: 'net' (off the net total, default) or 'gross' (off the VAT-inclusive total).
  @IsOptional() @IsIn(['net', 'gross']) discountBase?: 'net' | 'gross' | null;

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
  // Whether the goods came back. FBM: pair with returnWarehouseId (a sellable warehouse reverses
  // the product cost; a used/not-sellable one keeps it). FBA: a bare flag — Amazon re-listed it.
  @IsOptional() @IsBoolean() returnedToStock?: boolean;
  @IsOptional() @IsUUID() returnWarehouseId?: string | null;
}

export class UpdateSalesTransactionDto extends CreateSalesTransactionDto {
  @IsOptional() @IsDateString() declare date: string;
  @IsOptional() @IsString() @MinLength(1) declare transactionRef: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SalesTransactionItemDto) declare items: SalesTransactionItemDto[];
}

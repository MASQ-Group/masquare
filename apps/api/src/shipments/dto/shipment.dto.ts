import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID,
  MinLength, ValidateNested,
} from 'class-validator';

export class CreateShipmentDto {
  @IsUUID() transactionId!: string;
  @IsOptional() @IsIn(['outbound', 'inbound', 'replacement']) type?: 'outbound' | 'inbound' | 'replacement';
  /**
   * Where a REPLACEMENT left from. Required for that type and ignored for the others: the original
   * despatch records its warehouse per line, but a replacement consumes a second unit that nothing
   * else accounts for, so it has to say where that unit came from.
   */
  @IsOptional() @IsUUID() warehouseId?: string | null;
  @IsDateString() shipmentDate!: string;
  @IsOptional() @IsUUID() shippingServiceId?: string | null;
  @IsOptional() @IsString() trackingNumber?: string | null;
  @IsOptional() @IsNumber() shippingCostEur?: number | null;
  @IsOptional() @IsIn(['company', 'customer']) costBorneBy?: 'company' | 'customer';
  @IsOptional() @IsNumber() dutyImportEur?: number | null;
  @IsOptional() @IsString() comments?: string | null;
  // When true (default), the transaction is marked fully shipped (leaves the worklist).
  @IsOptional() @IsBoolean() markShipped?: boolean;
}

/** One parcel of a same-day consignment: its own carrier, tracking and cost. */
export class ShipmentParcelDto {
  @IsOptional() @IsUUID() shippingServiceId?: string | null;
  @IsOptional() @IsString() trackingNumber?: string | null;
  @IsOptional() @IsNumber() shippingCostEur?: number | null;
}

/** Record several parcels that all went out together — one date, one duty charge, but a
 *  separate tracking number and cost each. Written as one shipment row per parcel, so the
 *  cost totals and the shipments log stay exactly as they are for single-parcel orders. */
export class CreateShipmentBatchDto {
  @IsUUID() transactionId!: string;
  @IsOptional() @IsIn(['outbound', 'inbound']) type?: 'outbound' | 'inbound';
  @IsDateString() shipmentDate!: string;
  @IsOptional() @IsIn(['company', 'customer']) costBorneBy?: 'company' | 'customer';
  /** Charged once for the consignment, not per parcel. */
  @IsOptional() @IsNumber() dutyImportEur?: number | null;
  @IsOptional() @IsString() comments?: string | null;
  @IsOptional() @IsBoolean() markShipped?: boolean;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ShipmentParcelDto)
  parcels!: ShipmentParcelDto[];
}

/** One order's share of a combined shipment's total cost. */
export class ShipmentAllocationDto {
  @IsUUID() transactionId!: string;
  @IsOptional() @IsNumber() shippingCostEur?: number | null;
}

/** Ship several orders together as one physical parcel: one date, service, tracking and duty,
 *  with the single real cost split across the orders. Written as one shipment row per order
 *  (sharing a groupId) so the log, per-transaction profit and cancel all keep working. */
export class CreateCombinedShipmentDto {
  @IsArray() @ArrayMinSize(2) @IsUUID('4', { each: true }) transactionIds!: string[];
  @IsDateString() shipmentDate!: string;
  @IsOptional() @IsUUID() shippingServiceId?: string | null;
  @IsOptional() @IsString() trackingNumber?: string | null;
  /** The one real shipping cost for the whole parcel, split across the orders. */
  @IsOptional() @IsNumber() totalShippingCostEur?: number | null;
  /** Explicit per-order split. When omitted, the total is split by each order's shipping. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ShipmentAllocationDto)
  allocations?: ShipmentAllocationDto[];
  @IsOptional() @IsIn(['company', 'customer']) costBorneBy?: 'company' | 'customer';
  @IsOptional() @IsNumber() dutyImportEur?: number | null;
  @IsOptional() @IsString() comments?: string | null;
  @IsOptional() @IsBoolean() markShipped?: boolean;
}

export class UpdateShipmentDto {
  @IsOptional() @IsIn(['outbound', 'inbound']) type?: 'outbound' | 'inbound';
  @IsOptional() @IsDateString() shipmentDate?: string;
  @IsOptional() @IsUUID() shippingServiceId?: string | null;
  @IsOptional() @IsString() trackingNumber?: string | null;
  @IsOptional() @IsNumber() shippingCostEur?: number | null;
  @IsOptional() @IsIn(['company', 'customer']) costBorneBy?: 'company' | 'customer';
  @IsOptional() @IsNumber() dutyImportEur?: number | null;
  @IsOptional() @IsString() comments?: string | null;
}

export class SetFulfilmentDto {
  @IsIn(['pending', 'shipped', 'cancelled']) status!: 'pending' | 'shipped' | 'cancelled';
}

export class ShipmentImportValidateDto {
  @IsArray() rows!: Record<string, string>[];
}

export class ShipmentImportCommitItemDto {
  @IsOptional() row!: Record<string, string>;
  @IsUUID() transactionId!: string;
  @IsOptional() @IsUUID() shippingServiceId?: string | null;
}

export class ShipmentImportCommitDto {
  @IsArray() items!: ShipmentImportCommitItemDto[];
}

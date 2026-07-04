import {
  IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MinLength,
} from 'class-validator';

export class CreateShipmentDto {
  @IsUUID() transactionId!: string;
  @IsOptional() @IsIn(['outbound', 'inbound']) type?: 'outbound' | 'inbound';
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

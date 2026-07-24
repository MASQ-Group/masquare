import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsIn(['metric', 'imperial']) measurementSystem?: 'metric' | 'imperial';
  @IsOptional() @IsIn(['ddmmyyyy', 'mmddyyyy', 'yyyymmdd']) dateFormat?: 'ddmmyyyy' | 'mmddyyyy' | 'yyyymmdd';
  // Standard column set for the Sales Transactions list (array of column keys).
  @IsOptional() @IsArray() @IsString({ each: true }) salesTxStandardColumns?: string[];
  // Platform typography — font-family keys resolved by the web font registry.
  @IsOptional() @IsString() @MaxLength(60) bodyFont?: string;
  @IsOptional() @IsString() @MaxLength(60) monoFont?: string;
  // When on, submitting a sale takes its goods off stock (and records a shortfall if there
  // isn't enough). Off until opening stock is loaded.
  @IsOptional() @IsBoolean() deductStockOnSale?: boolean;
  // When on, a channel sync applies the cancellations/refunds it pulls. Off keeps it dormant.
  @IsOptional() @IsBoolean() applyChannelResolutions?: boolean;
}

import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

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
  // When on, a submitted sale lowers channel Availability and schedules a push of the new figure
  // to every channel the SKU is listed on. Off until deliberately enabled (it makes live writes).
  @IsOptional() @IsBoolean() autoAdjustAvailabilityOnSale?: boolean;
  /** Margin a new listing launches at, as a percentage. Separate from the repricing floor margin. */
  @IsOptional() @IsNumber() launchMarginPct?: number;
  /** Whether creating real marketplace listings is permitted. */
  @IsOptional() @IsBoolean() listingLiveWrites?: boolean;
}

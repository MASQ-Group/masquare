import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';

export class CreateSalesChannelDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() nativeCountryId?: string | null;
  @IsOptional() @IsString() nativeCurrency?: string;
  @IsOptional() @IsNumber() generalSalesFeePct?: number | null;
  @IsOptional() @IsBoolean() feeChargedInNativeCurrency?: boolean;
  @IsOptional() @IsString() feeCurrency?: string | null;
  @IsOptional() @IsBoolean() showTransactionTotal?: boolean;
  /** Chip colours shown wherever this channel's name appears (CSS colours). */
  @IsOptional() @IsString() chipBgColor?: string | null;
  @IsOptional() @IsString() chipTextColor?: string | null;
  @IsOptional() @IsBoolean() vatThresholdEnabled?: boolean;
  @IsOptional() @IsBoolean() pricesIncludeTax?: boolean;
  @IsOptional() @IsNumber() vatThresholdAmount?: number | null;
  /** How far below the market rate this channel converts, as a percentage. Null clears it. */
  @IsOptional() @IsNumber() @Min(0) @Max(99) fxSpreadPct?: number | null;
  @IsOptional() @IsString() fxSpreadNote?: string | null;
  @IsOptional() @IsString() vatThresholdCurrency?: string | null;
  @IsOptional() @IsNumber() vatBelowThresholdPct?: number | null;
  @IsOptional() @IsNumber() vatAboveThresholdPct?: number | null;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() contactName?: string;
}

export class UpdateSalesChannelDto extends CreateSalesChannelDto {
  @IsOptional() @IsString() @MinLength(1) declare name: string;
}

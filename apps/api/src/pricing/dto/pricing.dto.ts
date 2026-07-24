import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Price one product on one channel, with optional overrides of the auto-filled inputs. */
export class IndividualPricingDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @IsUUID() salesChannelId!: string;

  @ApiProperty({ description: 'Listing price in the channel currency.' })
  @Type(() => Number) @Min(0) price!: number;

  /** 'include' = the price already contains the channel's tax; 'zero' = no tax applies. */
  @ApiPropertyOptional({ enum: ['include', 'zero'] })
  @IsOptional() @IsIn(['include', 'zero']) taxMode?: 'include' | 'zero';

  @ApiPropertyOptional() @IsOptional() @IsUUID() shippingServiceId?: string | null;

  // Overrides — each falls back to the auto-resolved value when omitted.
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) costEur?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) shippingCostEur?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) @Max(100) vatPct?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) @Max(100) feePct?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) @Max(100) importPct?: number;
}

/** Solve listing prices for a product set across channels at a target margin. */
export class BulkPricingDto {
  @ApiProperty({ enum: ['specific', 'vendor', 'brand', 'type'] })
  @IsIn(['specific', 'vendor', 'brand', 'type']) mode!: 'specific' | 'vendor' | 'brand' | 'type';

  @ApiPropertyOptional({ description: 'Required when mode is "specific".' })
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) productIds?: string[];

  @ApiPropertyOptional({ description: 'Vendor / brand / product-type id for the group modes.' })
  @IsOptional() @IsUUID() groupId?: string;

  @ApiProperty({ type: [String] })
  @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) salesChannelIds!: string[];

  @ApiProperty({ description: 'Target net margin as a % of the buyer-paid price.' })
  @Type(() => Number) @Min(0) @Max(99) targetMarginPct!: number;

  /** Applies to every channel. A per-channel entry below overrides it. */
  @ApiPropertyOptional() @IsOptional() @IsUUID() shippingServiceId?: string | null;

  /**
   * Per-channel shipping service, keyed by sales channel id. Anything not listed falls
   * back to the default set on that channel's own country.
   */
  @ApiPropertyOptional({ description: 'Map of salesChannelId -> shippingServiceId.' })
  @IsOptional() @IsObject() shippingServiceByChannel?: Record<string, string>;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) shippingCostEur?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) @Max(100) importPct?: number;
}

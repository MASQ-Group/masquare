import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class GenerateOrderLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Quantity to order (editable in the draft PO).' })
  @IsInt()
  @Min(1)
  quantity!: number;

  /** Overrides the product's vendor — required for products with no vendor mapped. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string | null;

  /** Overrides the product's last purchase cost. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number | null;
}

export class GenerateOrdersDto {
  @ApiProperty({ description: 'Issuing legal entity for the generated purchase orders.' })
  @IsUUID()
  companyId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  destinationWarehouseId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiProperty({ type: [GenerateOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GenerateOrderLineDto)
  lines!: GenerateOrderLineDto[];
}

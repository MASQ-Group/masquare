import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

export class ProfitTierDto {
  @IsOptional() @IsString() name?: string | null;
  @IsNumber() fromPct!: number;
  @IsNumber() toPct!: number;
  @IsString() @MinLength(1) bgColor!: string;
  @IsString() @MinLength(1) fontColor!: string;
}

/** The tier list is edited as a whole in Global Settings and saved in one PUT. */
export class SaveProfitTiersDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ProfitTierDto)
  tiers!: ProfitTierDto[];
}

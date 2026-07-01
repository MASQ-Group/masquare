import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateSalesChannelDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() nativeCountryId?: string | null;
  @IsOptional() @IsString() nativeCurrency?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() contactName?: string;
}

export class UpdateSalesChannelDto extends CreateSalesChannelDto {
  @IsOptional() @IsString() @MinLength(1) declare name: string;
}

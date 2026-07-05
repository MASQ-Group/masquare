import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateIntegrationDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) channelType!: string;
  @IsOptional() @IsString() marketplace?: string | null;
  // Non-secret config fields (url, sellerId, …). Unknown keys are ignored.
  @IsOptional() @IsObject() config?: Record<string, string>;
  // Secret fields (consumer/secret keys). Encrypted before storage, never returned.
  @IsOptional() @IsObject() secrets?: Record<string, string>;
}

export class UpdateIntegrationDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() marketplace?: string | null;
  @IsOptional() @IsObject() config?: Record<string, string>;
  // Only provided secret fields are (re)set; omitted ones are left unchanged.
  @IsOptional() @IsObject() secrets?: Record<string, string>;
  @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';
  // Import settings.
  @IsOptional() @IsString() targetSalesChannelId?: string | null;
  @IsOptional() @IsString() targetCompanyId?: string | null;
  @IsOptional() @IsBoolean() autoSyncEnabled?: boolean;
  @IsOptional() @IsNumber() backfillDays?: number;
}

export class TestIntegrationDto {
  @IsOptional() @IsIn(['live', 'test']) mode?: 'live' | 'test';
}

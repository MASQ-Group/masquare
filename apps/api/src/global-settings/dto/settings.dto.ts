import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsIn(['metric', 'imperial']) measurementSystem?: 'metric' | 'imperial';
  @IsOptional() @IsIn(['ddmmyyyy', 'mmddyyyy', 'yyyymmdd']) dateFormat?: 'ddmmyyyy' | 'mmddyyyy' | 'yyyymmdd';
  // Standard column set for the Sales Transactions list (array of column keys).
  @IsOptional() @IsArray() @IsString({ each: true }) salesTxStandardColumns?: string[];
}

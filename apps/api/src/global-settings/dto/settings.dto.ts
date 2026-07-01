import { IsIn, IsOptional } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsIn(['metric', 'imperial']) measurementSystem?: 'metric' | 'imperial';
  @IsOptional() @IsIn(['ddmmyyyy', 'mmddyyyy', 'yyyymmdd']) dateFormat?: 'ddmmyyyy' | 'mmddyyyy' | 'yyyymmdd';
}

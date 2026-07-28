import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAttributeDto {
  @IsString() @MinLength(1) name!: string;
  @IsIn(['predefined', 'free_text']) inputType!: 'predefined' | 'free_text';
  @IsOptional() @IsBoolean() allowMultiple?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) values?: string[];
}

export class UpdateAttributeDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(['predefined', 'free_text']) inputType?: 'predefined' | 'free_text';
  @IsOptional() @IsBoolean() allowMultiple?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) values?: string[];
}

export class AddAttributeValueDto {
  @IsString() @MinLength(1) value!: string;
}

import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

export class VendorContactDto {
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsIn(['person', 'department']) contactType?: 'person' | 'department';
  @IsOptional() @IsString() contactRole?: string;
}

export class CreateVendorDto {
  @IsString() @MinLength(1) name!: string;

  @IsOptional() @IsString() vatNumber?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() addressCity?: string;
  @IsOptional() @IsString() addressRegion?: string;
  @IsOptional() @IsString() addressPostalCode?: string;
  @IsOptional() @IsString() addressCountry?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() website?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VendorContactDto)
  contacts?: VendorContactDto[];
}

export class UpdateVendorDto extends CreateVendorDto {
  @IsOptional() @IsString() @MinLength(1) declare name: string;
}

import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class VatRegistrationDto {
  @IsString()
  @MinLength(1)
  country!: string;

  @IsString()
  @MinLength(1)
  vatNumber!: string;
}

export class ContactPersonDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional() @IsString() surname?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() role?: string;
}

export class CreateCompanyDto {
  @IsString()
  @MinLength(1)
  officialName!: string;

  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() addressCity?: string;
  @IsOptional() @IsString() addressRegion?: string;
  @IsOptional() @IsString() addressPostalCode?: string;
  @IsOptional() @IsString() addressCountry?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() phoneLandline?: string;
  @IsOptional() @IsString() phoneMobile?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VatRegistrationDto)
  vatRegistrations?: VatRegistrationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactPersonDto)
  contactPersons?: ContactPersonDto[];
}

export class UpdateCompanyDto extends CreateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  declare officialName: string;
}

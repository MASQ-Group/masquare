import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

// Treat an empty string as "not provided" so optional fields with a format check (e.g. email)
// don't reject a blank value — @IsOptional() alone only skips undefined/null, not ''.
const blankToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class VendorContactDto {
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @Transform(blankToUndefined) @IsEmail() contactEmail?: string;
  @IsOptional() @IsIn(['person', 'department']) contactType?: 'person' | 'department';
  @IsOptional() @IsString() contactRole?: string;
}

export class CreateVendorDto {
  @IsString() @MinLength(1) name!: string;

  @IsOptional() @IsString() vatNumber?: string;
  /** How purchase orders to this vendor treat VAT. */
  @IsOptional() @IsIn(['standard', 'reverse_charge', 'outside_scope'])
  vatTreatment?: 'standard' | 'reverse_charge' | 'outside_scope';
  /** Currency this vendor invoices in — new POs and uploaded price files default to it. */
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  /** Whether this vendor's quoted MAP / suggested retail already contains VAT. */
  @IsOptional() @IsBoolean() mapIncludesVat?: boolean;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() addressCity?: string;
  @IsOptional() @IsString() addressRegion?: string;
  @IsOptional() @IsString() addressPostalCode?: string;
  @IsOptional() @IsString() addressCountry?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @Transform(blankToUndefined) @IsEmail() email?: string;
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

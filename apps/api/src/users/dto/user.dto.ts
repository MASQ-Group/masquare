import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional() @IsBoolean() isAdmin?: boolean;

  @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';

  /** Companies this user may access. Omit on create to grant all (new users default
   *  to all-access; admin toggles off). Pass [] for none. */
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) companyIds?: string[];

  /** Modules this user may use. Omit on create to grant all. */
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) moduleIds?: string[];

  /** The role this user starts from. Null means they hold only their own overrides. */
  @IsOptional() @IsUUID() roleId?: string | null;

  /**
   * Per-user deltas on top of the role, shaped like a role's grants. Validated against the
   * catalogue in the service, where an unknown key is refused with a message rather than dropped.
   */
  @IsOptional() accessOverrides?: unknown;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) fullName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @IsOptional() @IsBoolean() isAdmin?: boolean;
  @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) companyIds?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) moduleIds?: string[];
  /** Sent as null to clear the role. Absent means leave it alone. */
  @IsOptional() roleId?: string | null;
  @IsOptional() accessOverrides?: unknown;
}

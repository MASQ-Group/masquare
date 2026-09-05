import { Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Patch, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessArea, NoAccessCheck } from '../access/access.decorators';

/**
 * The vocabularies a product's compliance answers are chosen from.
 *
 * One endpoint family rather than five near-identical ones: the lists differ only in `kind`, and
 * five copies of the same CRUD is five places to fix a bug. Adding a value is a row, not a deploy,
 * which is the point — a plug type nobody anticipated should not need an engineer.
 */
export const COMPLIANCE_KINDS = [
  'VOLTAGE_RATING',
  'FREQUENCY',
  'PLUG_TYPE',
  'BATTERY_TYPE',
  'HAZMAT_CLASS',
] as const;
export type ComplianceKind = (typeof COMPLIANCE_KINDS)[number];

export const KIND_LABEL: Record<ComplianceKind, string> = {
  VOLTAGE_RATING: 'Voltage rating',
  FREQUENCY: 'Frequency',
  PLUG_TYPE: 'Plug type',
  BATTERY_TYPE: 'Battery type',
  HAZMAT_CLASS: 'Dangerous goods class',
};

export class CreateComplianceOptionDto {
  @IsString() @MinLength(1) kind!: string;
  @IsString() @MinLength(1) code!: string;
  @IsString() @MinLength(1) label!: string;
  @IsOptional() @IsInt() numericMin?: number | null;
  @IsOptional() @IsInt() numericMax?: number | null;
  @IsOptional() @IsString() note?: string | null;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateComplianceOptionDto {
  @IsOptional() @IsString() @MinLength(1) code?: string;
  @IsOptional() @IsString() @MinLength(1) label?: string;
  @IsOptional() @IsInt() numericMin?: number | null;
  @IsOptional() @IsInt() numericMax?: number | null;
  @IsOptional() @IsString() note?: string | null;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Injectable()
export class ComplianceOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(kind?: string, includeInactive = false) {
    return this.prisma.complianceOption.findMany({
      where: {
        deletedAt: null,
        ...(kind ? { kind } : {}),
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  private assertKind(kind: string) {
    if (!(COMPLIANCE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`Unknown list '${kind}'`);
    }
  }

  /**
   * A voltage rating without a range cannot be judged, so it is either deliberately unbounded
   * ("battery powered") or a mistake. Requiring both or neither makes the difference explicit
   * rather than leaving a half-filled rating to silently pass every market.
   */
  private assertRange(kind: string, min?: number | null, max?: number | null) {
    if (kind !== 'VOLTAGE_RATING') return;
    const hasMin = min != null;
    const hasMax = max != null;
    if (hasMin !== hasMax) throw new BadRequestException('Give a voltage rating both a minimum and a maximum, or neither');
    if (hasMin && hasMax && (min as number) > (max as number)) {
      throw new BadRequestException('The minimum voltage cannot be above the maximum');
    }
  }

  async create(dto: CreateComplianceOptionDto) {
    this.assertKind(dto.kind);
    this.assertRange(dto.kind, dto.numericMin, dto.numericMax);
    const clash = await this.prisma.complianceOption.findUnique({
      where: { kind_code: { kind: dto.kind, code: dto.code } },
    });
    if (clash) throw new BadRequestException(`${dto.code} already exists in ${KIND_LABEL[dto.kind as ComplianceKind]}`);
    return this.prisma.complianceOption.create({ data: { ...dto, sortOrder: dto.sortOrder ?? 999 } });
  }

  async update(id: string, dto: UpdateComplianceOptionDto) {
    const existing = await this.prisma.complianceOption.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Option not found');
    this.assertRange(
      existing.kind,
      dto.numericMin !== undefined ? dto.numericMin : existing.numericMin,
      dto.numericMax !== undefined ? dto.numericMax : existing.numericMax,
    );
    return this.prisma.complianceOption.update({ where: { id }, data: dto });
  }

  /**
   * Retire an option rather than delete it.
   *
   * Products already reference it, and a compliance answer that disappears from history is worse
   * than one that is merely no longer offered. Deactivating hides it from new selections and
   * leaves every existing product exactly as it was.
   */
  async remove(id: string) {
    const existing = await this.prisma.complianceOption.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Option not found');
    const inUse = await this.countUsage(existing.kind, id);
    if (inUse > 0) {
      await this.prisma.complianceOption.update({ where: { id }, data: { active: false } });
      return { ok: true, retired: true, inUse };
    }
    await this.prisma.complianceOption.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    return { ok: true, retired: false, inUse: 0 };
  }

  /** How many products point at this option, so the UI can say so before anything is removed. */
  private countUsage(kind: string, id: string): Promise<number> {
    const where =
      kind === 'VOLTAGE_RATING' ? { voltageRatingId: id }
      : kind === 'FREQUENCY' ? { frequencyId: id }
      : kind === 'PLUG_TYPE' ? { plugTypeId: id }
      : kind === 'BATTERY_TYPE' ? { batteryTypeId: id }
      : { hazmatClassId: id };
    return this.prisma.product.count({ where: { deletedAt: null, ...where } });
  }

  async usage(id: string) {
    const existing = await this.prisma.complianceOption.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Option not found');
    return { id, products: await this.countUsage(existing.kind, id) };
  }
}

// Reference data. Writing it is a settings action; READING it is not — a country list, a
// carrier name or a brand is needed by nearly every form in the platform, and gating those
// reads behind Global settings would break the shipment form for anyone in the warehouse for
// no benefit. So the GETs below carry @NoAccessCheck and the writes do not.
@AccessArea('global_settings')
@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('compliance-options')
export class ComplianceOptionsController {
  constructor(private readonly svc: ComplianceOptionsService) {}

  @NoAccessCheck() @Get('kinds')
  kinds() {
    return COMPLIANCE_KINDS.map((k) => ({ kind: k, label: KIND_LABEL[k] }));
  }

  @NoAccessCheck() @Get()
  list(@Query('kind') kind?: string, @Query('includeInactive') includeInactive?: string) {
    return this.svc.list(kind, includeInactive === 'true');
  }

  @NoAccessCheck() @Get(':id/usage')
  usage(@Param('id') id: string) {
    return this.svc.usage(id);
  }

  @Post()
  create(@Body() dto: CreateComplianceOptionDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateComplianceOptionDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}

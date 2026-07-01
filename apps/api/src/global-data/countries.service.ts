import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCountryDto, SetCountryZoneDto, UpdateCountryDto } from './dto/country.dto';

const include = {
  defaultShippingService: { select: { id: true, name: true } },
  shippingZoneMappings: { include: { zone: { select: { id: true, name: true } } } },
} satisfies Prisma.CountryInclude;

@Injectable()
export class CountriesService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(c: any) {
    return {
      id: c.id,
      name: c.name,
      isoCode: c.isoCode,
      continent: c.continent,
      euVatZone: c.euVatZone,
      vatRate: Number(c.vatRate),
      defaultShippingServiceId: c.defaultShippingServiceId,
      defaultShippingService: c.defaultShippingService ?? null,
      shippingZones: (c.shippingZoneMappings ?? []).map((m: any) => ({
        shippingServiceId: m.shippingServiceId,
        zoneId: m.zoneId,
        zoneName: m.zone?.name ?? null,
      })),
    };
  }

  async list(q?: string) {
    const rows = await this.prisma.country.findMany({
      where: { deletedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
      include,
    });
    return rows.map((r) => this.serialize(r));
  }

  private async getRaw(id: string) {
    const c = await this.prisma.country.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException('Country not found');
    return c;
  }

  async create(dto: CreateCountryDto, actorId?: string) {
    const row = await this.prisma.country.create({
      data: {
        name: dto.name,
        isoCode: dto.isoCode.toUpperCase(),
        continent: dto.continent,
        euVatZone: dto.euVatZone ?? false,
        vatRate: dto.vatRate ?? 0,
        defaultShippingServiceId: dto.defaultShippingServiceId ?? null,
        createdById: actorId,
        updatedById: actorId,
      },
      include,
    });
    return this.serialize(row);
  }

  async update(id: string, dto: UpdateCountryDto, actorId?: string) {
    await this.getRaw(id);
    const row = await this.prisma.country.update({
      where: { id },
      data: {
        name: dto.name,
        isoCode: dto.isoCode?.toUpperCase(),
        continent: dto.continent,
        euVatZone: dto.euVatZone,
        vatRate: dto.vatRate,
        defaultShippingServiceId: dto.defaultShippingServiceId,
        updatedById: actorId,
      },
      include,
    });
    return this.serialize(row);
  }

  async remove(id: string) {
    await this.getRaw(id);
    await this.prisma.country.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  /** Set or clear the zone of a shipping service that applies to this country. */
  async setZone(id: string, dto: SetCountryZoneDto) {
    await this.getRaw(id);
    if (dto.zoneId === null) {
      await this.prisma.countryShippingZone.deleteMany({
        where: { countryId: id, shippingServiceId: dto.shippingServiceId },
      });
    } else {
      await this.prisma.countryShippingZone.upsert({
        where: { countryId_shippingServiceId: { countryId: id, shippingServiceId: dto.shippingServiceId } },
        create: { countryId: id, shippingServiceId: dto.shippingServiceId, zoneId: dto.zoneId },
        update: { zoneId: dto.zoneId },
      });
    }
    const row = await this.prisma.country.findUnique({ where: { id }, include });
    return this.serialize(row);
  }
}

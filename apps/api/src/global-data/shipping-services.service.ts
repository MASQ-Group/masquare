import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShippingServiceDto, UpdateShippingServiceDto } from './dto/shipping.dto';

const include = {
  zones: {
    where: { deletedAt: null },
    orderBy: { name: 'asc' as const },
    include: {
      countries: { include: { country: { select: { id: true, name: true, isoCode: true } } } },
      rates: { where: { deletedAt: null }, orderBy: { fromWeightKg: 'asc' as const } },
    },
  },
} satisfies Prisma.ShippingServiceInclude;

@Injectable()
export class ShippingServicesService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(s: any) {
    return {
      id: s.id,
      name: s.name,
      alias: s.alias,
      trackingUrlTemplate: s.trackingUrlTemplate ?? null,
      calcMethod: s.calcMethod,
      zones: (s.zones ?? []).map((z: any) => ({
        id: z.id,
        name: z.name,
        countryIds: z.countries.map((c: any) => c.countryId),
        countries: z.countries.map((c: any) => c.country),
        rates: z.rates.map((r: any) => ({
          id: r.id,
          fromWeightKg: Number(r.fromWeightKg),
          toWeightKg: Number(r.toWeightKg),
          chargeEur: Number(r.chargeEur),
        })),
      })),
    };
  }

  list() {
    return this.prisma.shippingService
      .findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, include })
      .then((rows) => rows.map((r) => this.serialize(r)));
  }

  async get(id: string) {
    const s = await this.prisma.shippingService.findFirst({ where: { id, deletedAt: null }, include });
    if (!s) throw new NotFoundException('Shipping service not found');
    return this.serialize(s);
  }

  private async writeZonesAndRates(tx: Prisma.TransactionClient, serviceId: string, dto: CreateShippingServiceDto) {
    const zoneIdByName = new Map<string, string>();
    for (const z of dto.zones ?? []) {
      const zone = await tx.shippingZone.create({ data: { shippingServiceId: serviceId, name: z.name } });
      zoneIdByName.set(z.name, zone.id);
      if (z.countryIds?.length) {
        await tx.shippingZoneCountry.createMany({
          data: z.countryIds.map((countryId) => ({ zoneId: zone.id, countryId })),
          skipDuplicates: true,
        });
      }
    }
    // Batch-insert rates in one statement (handles thousands of rows efficiently).
    const rateData = (dto.rates ?? []).map((r) => {
      const zoneId = zoneIdByName.get(r.zoneName);
      if (!zoneId) throw new BadRequestException(`Rate references unknown zone "${r.zoneName}"`);
      return { zoneId, fromWeightKg: r.fromWeightKg, toWeightKg: r.toWeightKg, chargeEur: r.chargeEur };
    });
    if (rateData.length) await tx.shippingRate.createMany({ data: rateData });
  }

  async create(dto: CreateShippingServiceDto, actorId?: string) {
    const id = await this.prisma.$transaction(async (tx) => {
      const service = await tx.shippingService.create({
        data: { name: dto.name, alias: dto.alias, trackingUrlTemplate: dto.trackingUrlTemplate?.trim() || null, calcMethod: dto.calcMethod, createdById: actorId, updatedById: actorId },
      });
      await this.writeZonesAndRates(tx, service.id, dto);
      return service.id;
    }, { timeout: 30000, maxWait: 15000 });
    return this.get(id);
  }

  async update(id: string, dto: UpdateShippingServiceDto, actorId?: string) {
    await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.shippingZone.deleteMany({ where: { shippingServiceId: id } }); // cascades zone countries + rates
      await tx.shippingService.update({
        where: { id },
        data: { name: dto.name, alias: dto.alias, trackingUrlTemplate: dto.trackingUrlTemplate?.trim() || null, calcMethod: dto.calcMethod, updatedById: actorId },
      });
      await this.writeZonesAndRates(tx, id, dto);
    }, { timeout: 30000, maxWait: 15000 });
    return this.get(id);
  }

  async remove(id: string) {
    await this.get(id);
    // Clean up references so no country points at a removed service (soft-delete
    // doesn't fire the FK cascades).
    await this.prisma.countryShippingZone.deleteMany({ where: { shippingServiceId: id } });
    await this.prisma.country.updateMany({ where: { defaultShippingServiceId: id }, data: { defaultShippingServiceId: null } });
    await this.prisma.shippingService.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

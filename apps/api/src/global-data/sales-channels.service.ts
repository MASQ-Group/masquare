import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalesChannelDto, UpdateSalesChannelDto } from './dto/sales-channel.dto';

const include = {
  nativeCountry: { select: { id: true, name: true, isoCode: true } },
} satisfies Prisma.SalesChannelInclude;

@Injectable()
export class SalesChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  list(q?: string) {
    return this.prisma.salesChannel.findMany({
      where: { deletedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
      include,
    });
  }

  async get(id: string) {
    const row = await this.prisma.salesChannel.findFirst({ where: { id, deletedAt: null }, include });
    if (!row) throw new NotFoundException('Sales channel not found');
    return row;
  }

  create(dto: CreateSalesChannelDto, actorId?: string) {
    return this.prisma.salesChannel.create({
      data: {
        name: dto.name,
        description: dto.description,
        nativeCountryId: dto.nativeCountryId ?? null,
        nativeCurrency: dto.nativeCurrency,
        email: dto.email,
        website: dto.website,
        contactName: dto.contactName,
        createdById: actorId,
        updatedById: actorId,
      },
      include,
    });
  }

  async update(id: string, dto: UpdateSalesChannelDto, actorId?: string) {
    await this.get(id);
    return this.prisma.salesChannel.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        nativeCountryId: dto.nativeCountryId,
        nativeCurrency: dto.nativeCurrency,
        email: dto.email,
        website: dto.website,
        contactName: dto.contactName,
        updatedById: actorId,
      },
      include,
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.salesChannel.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ViesService } from './vies.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vies: ViesService,
  ) {}

  list(q?: string) {
    const where: Prisma.VendorWhereInput = {
      deletedAt: null,
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    };
    return this.prisma.vendor.findMany({
      where,
      include: { contacts: { where: { deletedAt: null } } },
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, deletedAt: null },
      include: { contacts: { where: { deletedAt: null } } },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async create(dto: CreateVendorDto, actorId?: string) {
    const { contacts, ...data } = dto;
    return this.prisma.vendor.create({
      data: {
        ...data,
        createdById: actorId,
        updatedById: actorId,
        contacts: contacts?.length ? { create: contacts } : undefined,
      },
      include: { contacts: { where: { deletedAt: null } } },
    });
  }

  async update(id: string, dto: UpdateVendorDto, actorId?: string) {
    await this.get(id);
    const { contacts, ...data } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (contacts) {
        await tx.vendorContact.updateMany({
          where: { vendorId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (contacts.length) {
          await tx.vendorContact.createMany({
            data: contacts.map((c) => ({ ...c, vendorId: id })),
          });
        }
      }
      return tx.vendor.update({
        where: { id },
        data: { ...data, updatedById: actorId },
        include: { contacts: { where: { deletedAt: null } } },
      });
    });
  }

  /**
   * Re-check the vendor's VAT number against VIES and record the outcome. Advisory:
   * an unreachable VIES stores "unknown" rather than failing the request.
   */
  async verifyVat(id: string) {
    const vendor = await this.get(id);
    const result = await this.vies.check(vendor.vatNumber);
    await this.prisma.vendor.update({
      where: { id },
      data: {
        vatNumberValid: result.valid,
        vatNumberCheckedAt: result.checkedAt,
        vatNumberCheckedName: result.name ?? null,
      },
    });
    return { ...result, vendor: await this.get(id) };
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.vendor.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

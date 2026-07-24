import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVatClassDto, UpdateVatClassDto } from './dto/vat-class.dto';

/** Decimal -> number, so the API speaks plain JSON numbers like the rest of the surface. */
function serialize<T extends { ratePct: unknown }>(row: T) {
  return { ...row, ratePct: Number(row.ratePct) };
}

@Injectable()
export class VatClassesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q?: string) {
    const rows = await this.prisma.vatClass.findMany({
      where: { deletedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(serialize);
  }

  async get(id: string) {
    const row = await this.prisma.vatClass.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('VAT class not found');
    return row;
  }

  async getOne(id: string) {
    return serialize(await this.get(id));
  }

  async create(dto: CreateVatClassDto, actorId?: string) {
    const row = await this.prisma.$transaction(async (tx) => {
      // Exactly one default: promoting this one demotes the incumbent.
      if (dto.isDefault) {
        await tx.vatClass.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.vatClass.create({ data: { ...dto, createdById: actorId, updatedById: actorId } });
    });
    return serialize(row);
  }

  async update(id: string, dto: UpdateVatClassDto, actorId?: string) {
    const current = await this.get(id);
    // Demoting the only default would leave products with nothing to default to.
    if (dto.isDefault === false && current.isDefault) {
      throw new ConflictException('Make another VAT class the default instead of unsetting this one');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.vatClass.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
      }
      return tx.vatClass.update({ where: { id }, data: { ...dto, updatedById: actorId } });
    });
    return serialize(row);
  }

  async remove(id: string) {
    const row = await this.get(id);
    if (row.isDefault) {
      throw new ConflictException('Cannot delete the default VAT class — make another class the default first');
    }
    // A VAT class is financial reference data: refuse to orphan products rather than
    // silently leave them pointing at a deleted class (or silently re-rate them).
    const inUse = await this.prisma.product.count({ where: { vatClassId: id, deletedAt: null } });
    if (inUse > 0) {
      throw new ConflictException(
        `Cannot delete — ${inUse} product${inUse === 1 ? '' : 's'} still use this VAT class. Reassign them first.`,
      );
    }
    await this.prisma.vatClass.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

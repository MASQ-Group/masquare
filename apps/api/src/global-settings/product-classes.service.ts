import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductClassDto, UpdateProductClassDto } from './dto/product-class.dto';

@Injectable()
export class ProductClassesService {
  constructor(private readonly prisma: PrismaService) {}

  list(q?: string) {
    return this.prisma.productClass.findMany({
      where: { deletedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async get(id: string) {
    const row = await this.prisma.productClass.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Product class not found');
    return row;
  }

  async create(dto: CreateProductClassDto, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.productClass.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.productClass.create({ data: { ...dto, createdById: actorId, updatedById: actorId } });
    });
  }

  async update(id: string, dto: UpdateProductClassDto, actorId?: string) {
    const current = await this.get(id);
    if (dto.isDefault === false && current.isDefault) {
      throw new ConflictException('Make another product class the default instead of unsetting this one');
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.productClass.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
      return tx.productClass.update({ where: { id }, data: { ...dto, updatedById: actorId } });
    });
  }

  async remove(id: string) {
    const row = await this.get(id);
    if (row.isDefault) throw new ConflictException('Cannot delete the default product class — make another the default first');
    const inUse = await this.prisma.product.count({ where: { productClassId: id, deletedAt: null } });
    if (inUse > 0) {
      throw new ConflictException(`Cannot delete — ${inUse} product${inUse === 1 ? '' : 's'} still use this class. Reassign them first.`);
    }
    await this.prisma.productClass.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

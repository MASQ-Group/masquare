import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddAttributeValueDto, CreateAttributeDto, UpdateAttributeDto } from './dto/attribute.dto';

@Injectable()
export class AttributesService {
  constructor(private readonly prisma: PrismaService) {}

  list(q?: string) {
    return this.prisma.attribute.findMany({
      where: { deletedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      include: { values: { where: { deletedAt: null }, orderBy: { value: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string) {
    const row = await this.prisma.attribute.findFirst({
      where: { id, deletedAt: null },
      include: { values: { where: { deletedAt: null }, orderBy: { value: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Attribute not found');
    return row;
  }

  create(dto: CreateAttributeDto, actorId?: string) {
    const values = dedupe(dto.values);
    return this.prisma.attribute.create({
      data: {
        name: dto.name,
        inputType: dto.inputType,
        createdById: actorId,
        updatedById: actorId,
        values: values.length ? { create: values.map((value) => ({ value })) } : undefined,
      },
      include: { values: { where: { deletedAt: null }, orderBy: { value: 'asc' } } },
    });
  }

  async update(id: string, dto: UpdateAttributeDto, actorId?: string) {
    await this.get(id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.values) {
        const values = dedupe(dto.values);
        await tx.attributeValue.updateMany({
          where: { attributeId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (values.length) {
          await tx.attributeValue.createMany({ data: values.map((value) => ({ attributeId: id, value })) });
        }
      }
      return tx.attribute.update({
        where: { id },
        data: { name: dto.name, inputType: dto.inputType, updatedById: actorId },
        include: { values: { where: { deletedAt: null }, orderBy: { value: 'asc' } } },
      });
    });
  }

  /** Append a value if it doesn't already exist — backs free-text create-on-confirm. */
  async addValue(id: string, dto: AddAttributeValueDto) {
    await this.get(id);
    const existing = await this.prisma.attributeValue.findFirst({
      where: { attributeId: id, deletedAt: null, value: { equals: dto.value, mode: 'insensitive' } },
    });
    if (existing) return existing;
    return this.prisma.attributeValue.create({ data: { attributeId: id, value: dto.value } });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.attribute.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

function dedupe(values?: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values ?? []) {
    const t = v.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

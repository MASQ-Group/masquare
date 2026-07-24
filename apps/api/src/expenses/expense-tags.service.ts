import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseTagDto, UpdateExpenseTagDto } from './dto/expense-tag.dto';

const ACTIVE = { deletedAt: null };

@Injectable()
export class ExpenseTagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: { q?: string; group?: string; includeInactive?: boolean } = {}) {
    const q = opts.q?.trim();
    const rows = await this.prisma.expenseTag.findMany({
      where: {
        ...ACTIVE,
        ...(opts.includeInactive ? {} : { isActive: true }),
        ...(opts.group ? { group: opts.group } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { group: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ group: 'asc' }, { name: 'asc' }],
    });
    return rows.map((t) => this.serialize(t));
  }

  /** Distinct group names, for the group combobox. */
  async groups() {
    const rows = await this.prisma.expenseTag.findMany({ where: { ...ACTIVE, group: { not: null } }, select: { group: true }, distinct: ['group'], orderBy: { group: 'asc' } });
    return rows.map((r) => r.group).filter((g): g is string => !!g);
  }

  async get(id: string) {
    const t = await this.prisma.expenseTag.findFirst({ where: { id, ...ACTIVE } });
    if (!t) throw new NotFoundException('Tag not found');
    return this.serialize(t);
  }

  async create(dto: CreateExpenseTagDto, actorId?: string) {
    const name = dto.name.trim();
    await this.assertNameFree(name);
    const t = await this.prisma.expenseTag.create({
      data: { name, group: dto.group?.trim() || null, description: dto.description?.trim() || null, isActive: dto.isActive ?? true, createdById: actorId ?? null, updatedById: actorId ?? null },
    });
    return this.serialize(t);
  }

  async update(id: string, dto: UpdateExpenseTagDto, actorId?: string) {
    const existing = await this.prisma.expenseTag.findFirst({ where: { id, ...ACTIVE } });
    if (!existing) throw new NotFoundException('Tag not found');
    const name = dto.name?.trim();
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) await this.assertNameFree(name);
    const t = await this.prisma.expenseTag.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(dto.group !== undefined ? { group: dto.group?.trim() || null } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedById: actorId ?? null,
      },
    });
    return this.serialize(t);
  }

  /** Soft-delete. A tag already used by an expense is deactivated (kept for history) instead. */
  async remove(id: string, actorId?: string) {
    const t = await this.prisma.expenseTag.findFirst({ where: { id, ...ACTIVE } });
    if (!t) throw new NotFoundException('Tag not found');
    const used = await this.prisma.expense.count({ where: { tagId: id, deletedAt: null } });
    if (used > 0) {
      const updated = await this.prisma.expenseTag.update({ where: { id }, data: { isActive: false, updatedById: actorId ?? null } });
      return { deleted: false, deactivated: true, tag: this.serialize(updated) };
    }
    await this.prisma.expenseTag.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId ?? null } });
    return { deleted: true, deactivated: false };
  }

  private async assertNameFree(name: string) {
    const clash = await this.prisma.expenseTag.findFirst({ where: { ...ACTIVE, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (clash) throw new BadRequestException(`A tag "${name}" already exists`);
  }

  private serialize(t: any) {
    return { id: t.id, name: t.name, group: t.group, description: t.description, isActive: t.isActive };
  }
}

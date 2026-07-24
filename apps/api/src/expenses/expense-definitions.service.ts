import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDefinitionDto, UpdateExpenseDefinitionDto } from './dto/expense-definition.dto';

const ACTIVE = { deletedAt: null };

@Injectable()
export class ExpenseDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: { q?: string; categoryId?: string; includeInactive?: boolean } = {}) {
    const q = opts.q?.trim();
    const rows = await this.prisma.expenseDefinition.findMany({
      where: {
        ...ACTIVE,
        ...(opts.includeInactive ? {} : { isActive: true }),
        ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((d) => this.serialize(d));
  }

  async get(id: string) {
    const d = await this.prisma.expenseDefinition.findFirst({ where: { id, ...ACTIVE }, include: { category: { select: { id: true, name: true } } } });
    if (!d) throw new NotFoundException('Expense name not found');
    return this.serialize(d);
  }

  async create(dto: CreateExpenseDefinitionDto, actorId?: string) {
    const name = dto.name.trim();
    await this.assertNameFree(name);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);

    const d = await this.prisma.expenseDefinition.create({
      data: {
        code: await this.nextCode(),
        name,
        categoryId: dto.categoryId ?? null,
        defaultOccurrence: dto.defaultOccurrence ?? null,
        isActive: dto.isActive ?? true,
        createdById: actorId ?? null,
        updatedById: actorId ?? null,
      },
      include: { category: { select: { id: true, name: true } } },
    });
    return this.serialize(d);
  }

  async update(id: string, dto: UpdateExpenseDefinitionDto, actorId?: string) {
    const existing = await this.prisma.expenseDefinition.findFirst({ where: { id, ...ACTIVE } });
    if (!existing) throw new NotFoundException('Expense name not found');

    const name = dto.name?.trim();
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) await this.assertNameFree(name);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);

    const d = await this.prisma.expenseDefinition.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId ?? null } : {}),
        ...(dto.defaultOccurrence !== undefined ? { defaultOccurrence: dto.defaultOccurrence ?? null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedById: actorId ?? null,
      },
      include: { category: { select: { id: true, name: true } } },
    });
    return this.serialize(d);
  }

  /** Soft-delete. A definition already used by a registered expense is deactivated
   *  (kept for history) rather than deleted. */
  async remove(id: string, actorId?: string) {
    const d = await this.prisma.expenseDefinition.findFirst({ where: { id, ...ACTIVE } });
    if (!d) throw new NotFoundException('Expense name not found');

    const used = await this.prisma.expense.count({ where: { definitionId: id, deletedAt: null } });
    if (used > 0) {
      const updated = await this.prisma.expenseDefinition.update({ where: { id }, data: { isActive: false, updatedById: actorId ?? null }, include: { category: { select: { id: true, name: true } } } });
      return { deleted: false, deactivated: true, definition: this.serialize(updated) };
    }
    await this.prisma.expenseDefinition.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId ?? null } });
    return { deleted: true, deactivated: false };
  }

  /** EXP-0001, EXP-0002, … — next sequential platform code. */
  private async nextCode(): Promise<string> {
    const last = await this.prisma.expenseDefinition.findFirst({ where: { code: { startsWith: 'EXP-' } }, orderBy: { code: 'desc' }, select: { code: true } });
    const n = last?.code?.match(/(\d+)$/);
    const next = (n ? parseInt(n[1], 10) : 0) + 1;
    return `EXP-${String(next).padStart(4, '0')}`;
  }

  private async assertCategory(id: string) {
    const found = await this.prisma.expenseCategory.findFirst({ where: { id, ...ACTIVE }, select: { id: true } });
    if (!found) throw new NotFoundException('Category not found');
  }

  private async assertNameFree(name: string) {
    const clash = await this.prisma.expenseDefinition.findFirst({ where: { ...ACTIVE, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (clash) throw new BadRequestException(`An expense name "${name}" already exists`);
  }

  private serialize(d: any) {
    return {
      id: d.id,
      code: d.code,
      name: d.name,
      categoryId: d.categoryId,
      categoryName: d.category?.name ?? null,
      defaultOccurrence: d.defaultOccurrence,
      isActive: d.isActive,
    };
  }
}

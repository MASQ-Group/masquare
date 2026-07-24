import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseCategoryDto, UpdateExpenseCategoryDto } from './dto/expense-category.dto';

export interface ExpenseCategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  /** Depth in the tree, 0 for roots — lets the UI indent without re-walking. */
  depth: number;
  /** Definitions filed directly under this category (excludes descendants). */
  definitionCount: number;
  /** Rolled up over this category and all descendants. */
  rollupDefinitionCount: number;
  children: ExpenseCategoryNode[];
}

const ACTIVE = { deletedAt: null };

@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Flat list, alphabetical, used by pickers. */
  async list() {
    const rows = await this.prisma.expenseCategory.findMany({ where: ACTIVE, orderBy: { name: 'asc' } });
    return rows.map((c) => this.serialize(c));
  }

  /** The full tree with definition counts, for the Categories page. */
  async tree(): Promise<ExpenseCategoryNode[]> {
    const rows = await this.prisma.expenseCategory.findMany({ where: ACTIVE, orderBy: { name: 'asc' } });

    // Own definition counts per category in one pass, rather than a query per node.
    const grouped = await this.prisma.expenseDefinition.groupBy({
      by: ['categoryId'],
      where: { deletedAt: null, categoryId: { not: null } },
      _count: { _all: true },
    });
    const counts = new Map(grouped.map((g) => [g.categoryId as string, g._count._all]));

    const nodes = new Map<string, ExpenseCategoryNode>();
    for (const c of rows) {
      nodes.set(c.id, { ...this.serialize(c), depth: 0, definitionCount: counts.get(c.id) ?? 0, rollupDefinitionCount: 0, children: [] });
    }

    const roots: ExpenseCategoryNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    const stamp = (node: ExpenseCategoryNode, depth: number): number => {
      node.depth = depth;
      node.rollupDefinitionCount = node.definitionCount + node.children.reduce((s, c) => s + stamp(c, depth + 1), 0);
      return node.rollupDefinitionCount;
    };
    roots.forEach((r) => stamp(r, 0));
    return roots;
  }

  async get(id: string) {
    const c = await this.prisma.expenseCategory.findFirst({ where: { id, ...ACTIVE } });
    if (!c) throw new NotFoundException('Category not found');
    return this.serialize(c);
  }

  async create(dto: CreateExpenseCategoryDto, actorId?: string) {
    const name = dto.name.trim();
    await this.assertNameFree(name, dto.parentId ?? null);
    if (dto.parentId) await this.assertExists(dto.parentId, 'Parent category not found');

    const c = await this.prisma.expenseCategory.create({
      data: { name, parentId: dto.parentId ?? null, createdById: actorId ?? null, updatedById: actorId ?? null },
    });
    return this.serialize(c);
  }

  async update(id: string, dto: UpdateExpenseCategoryDto, actorId?: string) {
    const existing = await this.prisma.expenseCategory.findFirst({ where: { id, ...ACTIVE } });
    if (!existing) throw new NotFoundException('Category not found');

    const name = dto.name?.trim();
    const nextParent = dto.parentId !== undefined ? dto.parentId ?? null : existing.parentId;
    if (name && (name.toLowerCase() !== existing.name.toLowerCase() || nextParent !== existing.parentId)) {
      await this.assertNameFree(name, nextParent, id);
    }

    if (dto.parentId !== undefined && dto.parentId !== existing.parentId && dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('A category cannot be its own parent');
      await this.assertExists(dto.parentId, 'Parent category not found');
      await this.assertNoCycle(id, dto.parentId);
    }

    const c = await this.prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId ?? null } : {}),
        updatedById: actorId ?? null,
      },
    });
    return this.serialize(c);
  }

  /** Soft-delete. Refused while the category has sub-categories or definitions filed under it. */
  async remove(id: string, actorId?: string) {
    const c = await this.prisma.expenseCategory.findFirst({ where: { id, ...ACTIVE } });
    if (!c) throw new NotFoundException('Category not found');

    const [children, definitions] = await Promise.all([
      this.prisma.expenseCategory.count({ where: { parentId: id, ...ACTIVE } }),
      this.prisma.expenseDefinition.count({ where: { categoryId: id, deletedAt: null } }),
    ]);
    if (children > 0) throw new BadRequestException(`"${c.name}" has ${children} sub-categor${children === 1 ? 'y' : 'ies'}. Move or delete them first.`);
    if (definitions > 0) throw new BadRequestException(`"${c.name}" has ${definitions} expense name${definitions === 1 ? '' : 's'} filed under it. Reassign them first.`);

    await this.prisma.expenseCategory.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId ?? null } });
    return { deleted: true };
  }

  /** Walk up from `parentId`; if we meet `id`, the move would close a loop. */
  private async assertNoCycle(id: string, parentId: string) {
    const seen = new Set<string>([id]);
    let cursor: string | null = parentId;
    while (cursor) {
      if (seen.has(cursor)) throw new BadRequestException('That parent would create a loop in the category tree');
      seen.add(cursor);
      const row: { parentId: string | null } | null = await this.prisma.expenseCategory.findUnique({ where: { id: cursor }, select: { parentId: true } });
      cursor = row?.parentId ?? null;
    }
  }

  private async assertExists(id: string, message: string) {
    const found = await this.prisma.expenseCategory.findFirst({ where: { id, ...ACTIVE }, select: { id: true } });
    if (!found) throw new NotFoundException(message);
  }

  /** Names are unique among siblings (same parent), case-insensitive. */
  private async assertNameFree(name: string, parentId: string | null, exceptId?: string) {
    const clash = await this.prisma.expenseCategory.findFirst({
      where: { ...ACTIVE, parentId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(`A category named "${name}" already exists here`);
  }

  private serialize(c: any) {
    return { id: c.id, name: c.name, parentId: c.parentId };
  }
}

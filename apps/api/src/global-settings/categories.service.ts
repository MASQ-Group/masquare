import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, MoveCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Flat list (id, name, parentId, sortOrder) — the client assembles the tree.
   *  Level is derived from depth, never stored. */
  list() {
    return this.prisma.productCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, parentId: true, sortOrder: true },
    });
  }

  private async get(id: string) {
    const row = await this.prisma.productCategory.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Category not found');
    return row;
  }

  private async assertUniqueSibling(name: string, parentId: string | null, exceptId?: string) {
    const clash = await this.prisma.productCategory.findFirst({
      where: {
        deletedAt: null,
        parentId: parentId ?? null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) throw new BadRequestException('A sibling category with this name already exists');
  }

  /** Ids of `id` and all its descendants — used to block cyclic re-parenting. */
  private async subtreeIds(id: string): Promise<Set<string>> {
    const all = await this.prisma.productCategory.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });
    const childrenOf = new Map<string, string[]>();
    for (const c of all) {
      const key = c.parentId ?? 'root';
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key)!.push(c.id);
    }
    const out = new Set<string>();
    const walk = (n: string) => {
      out.add(n);
      for (const child of childrenOf.get(n) ?? []) walk(child);
    };
    walk(id);
    return out;
  }

  async create(dto: CreateCategoryDto, actorId?: string) {
    if (dto.parentId) await this.get(dto.parentId);
    await this.assertUniqueSibling(dto.name, dto.parentId ?? null);
    const maxSort = await this.prisma.productCategory.aggregate({
      where: { deletedAt: null, parentId: dto.parentId ?? null },
      _max: { sortOrder: true },
    });
    return this.prisma.productCategory.create({
      data: {
        name: dto.name,
        parentId: dto.parentId ?? null,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        createdById: actorId,
        updatedById: actorId,
      },
    });
  }

  async update(id: string, dto: UpdateCategoryDto, actorId?: string) {
    const row = await this.get(id);
    if (dto.name && dto.name !== row.name) {
      await this.assertUniqueSibling(dto.name, row.parentId, id);
    }
    return this.prisma.productCategory.update({
      where: { id },
      data: { name: dto.name, updatedById: actorId },
    });
  }

  async move(id: string, dto: MoveCategoryDto, actorId?: string) {
    const row = await this.get(id);
    const parentId = dto.parentId ?? null;
    if (parentId) {
      if (parentId === id) throw new BadRequestException('A category cannot be its own parent');
      const subtree = await this.subtreeIds(id);
      if (subtree.has(parentId)) {
        throw new BadRequestException('Cannot move a category under one of its own descendants');
      }
      await this.get(parentId);
    }
    await this.assertUniqueSibling(row.name, parentId, id);
    return this.prisma.productCategory.update({
      where: { id },
      data: { parentId, sortOrder: dto.sortOrder ?? row.sortOrder, updatedById: actorId },
    });
  }

  /** Soft-delete a node and re-parent its direct children to the node's parent. */
  async remove(id: string) {
    const row = await this.get(id);
    await this.prisma.$transaction([
      this.prisma.productCategory.updateMany({
        where: { parentId: id, deletedAt: null },
        data: { parentId: row.parentId },
      }),
      this.prisma.productCategory.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
    return { ok: true };
  }
}

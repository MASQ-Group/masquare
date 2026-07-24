import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';

export interface WarehouseNode {
  id: string;
  name: string;
  type: string;
  parentWarehouseId: string | null;
  includeInInventory: boolean;
  isActive: boolean;
  notes: string | null;
  /** Depth in the tree, 0 for roots — lets the UI indent without re-walking. */
  depth: number;
  /** Distinct products with a non-zero balance here (this warehouse only). */
  productCount: number;
  /** Total units here (this warehouse only, excludes children). */
  unitCount: number;
  /** Rolled up over this warehouse and all descendants. */
  rollupUnitCount: number;
  children: WarehouseNode[];
}

const ACTIVE = { deletedAt: null };

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Flat list, alphabetical, used by pickers. */
  async list(opts: { includeInactive?: boolean; companyIds?: string[] } = {}) {
    const rows = await this.prisma.warehouse.findMany({
      where: { ...ACTIVE, ...(opts.companyIds ? { companyId: { in: opts.companyIds } } : {}), ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
    return rows.map((w) => this.serialize(w));
  }

  /** The full tree with stock counts, for the Warehouses page. */
  async tree(opts: { includeInactive?: boolean; companyIds?: string[] } = {}): Promise<WarehouseNode[]> {
    const rows = await this.prisma.warehouse.findMany({
      where: { ...ACTIVE, ...(opts.companyIds ? { companyId: { in: opts.companyIds } } : {}), ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });

    // Own totals per warehouse in one pass, rather than a query per node.
    const grouped = await this.prisma.stockLevel.groupBy({
      by: ['warehouseId'],
      where: { quantityOnHand: { not: 0 } },
      _sum: { quantityOnHand: true },
      _count: { _all: true },
    });
    const totals = new Map(grouped.map((g) => [g.warehouseId, { units: g._sum.quantityOnHand ?? 0, products: g._count._all }]));

    const nodes = new Map<string, WarehouseNode>();
    for (const w of rows) {
      const t = totals.get(w.id);
      nodes.set(w.id, {
        ...this.serialize(w),
        depth: 0,
        productCount: t?.products ?? 0,
        unitCount: t?.units ?? 0,
        rollupUnitCount: 0,
        children: [],
      });
    }

    const roots: WarehouseNode[] = [];
    for (const node of nodes.values()) {
      // A parent filtered out (inactive) leaves the child at the root rather than orphaned.
      const parent = node.parentWarehouseId ? nodes.get(node.parentWarehouseId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    const stamp = (node: WarehouseNode, depth: number): number => {
      node.depth = depth;
      node.rollupUnitCount = node.unitCount + node.children.reduce((s, c) => s + stamp(c, depth + 1), 0);
      return node.rollupUnitCount;
    };
    roots.forEach((r) => stamp(r, 0));
    return roots;
  }

  async get(id: string, companyIds?: string[]) {
    const w = await this.prisma.warehouse.findFirst({ where: { id, ...ACTIVE, ...(companyIds ? { companyId: { in: companyIds } } : {}) } });
    if (!w) throw new NotFoundException('Warehouse not found');
    return this.serialize(w);
  }

  async create(dto: CreateWarehouseDto, actorId?: string, companyId?: string) {
    const name = dto.name.trim();
    await this.assertNameFree(name);
    if (dto.parentWarehouseId) await this.assertExists(dto.parentWarehouseId, 'Parent warehouse not found');

    const w = await this.prisma.warehouse.create({
      data: {
        companyId,
        name,
        type: dto.type ?? 'physical',
        parentWarehouseId: dto.parentWarehouseId ?? null,
        includeInInventory: dto.includeInInventory ?? true,
        isActive: dto.isActive ?? true,
        notes: dto.notes?.trim() || null,
        createdById: actorId ?? null,
        updatedById: actorId ?? null,
      },
    });
    return this.serialize(w);
  }

  async update(id: string, dto: UpdateWarehouseDto, actorId?: string) {
    const existing = await this.prisma.warehouse.findFirst({ where: { id, ...ACTIVE } });
    if (!existing) throw new NotFoundException('Warehouse not found');

    const name = dto.name?.trim();
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) await this.assertNameFree(name);

    if (dto.parentWarehouseId !== undefined && dto.parentWarehouseId !== existing.parentWarehouseId) {
      if (dto.parentWarehouseId) {
        if (dto.parentWarehouseId === id) throw new BadRequestException('A warehouse cannot be its own parent');
        await this.assertExists(dto.parentWarehouseId, 'Parent warehouse not found');
        await this.assertNoCycle(id, dto.parentWarehouseId);
      }
    }

    const w = await this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.parentWarehouseId !== undefined ? { parentWarehouseId: dto.parentWarehouseId ?? null } : {}),
        ...(dto.includeInInventory !== undefined ? { includeInInventory: dto.includeInInventory } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        updatedById: actorId ?? null,
      },
    });
    return this.serialize(w);
  }

  /**
   * Soft-delete. Refused while the warehouse still holds stock or has children —
   * deleting either would strand balances or orphan the subtree. A warehouse with
   * history but no stock is deactivated instead, so its movements stay explainable.
   */
  async remove(id: string, actorId?: string) {
    const w = await this.prisma.warehouse.findFirst({ where: { id, ...ACTIVE } });
    if (!w) throw new NotFoundException('Warehouse not found');

    const [units, children, movements] = await Promise.all([
      this.prisma.stockLevel.aggregate({ where: { warehouseId: id }, _sum: { quantityOnHand: true } }),
      this.prisma.warehouse.count({ where: { parentWarehouseId: id, ...ACTIVE } }),
      this.prisma.stockMovement.count({ where: { warehouseId: id } }),
    ]);

    const held = units._sum.quantityOnHand ?? 0;
    if (held !== 0) {
      throw new BadRequestException(
        `${w.name} still holds ${held} unit${Math.abs(held) === 1 ? '' : 's'}. Move or write off the stock first.`,
      );
    }
    if (children > 0) {
      throw new BadRequestException(`${w.name} has ${children} sub-warehouse${children === 1 ? '' : 's'}. Move or delete them first.`);
    }

    if (movements > 0) {
      const updated = await this.prisma.warehouse.update({
        where: { id },
        data: { isActive: false, updatedById: actorId ?? null },
      });
      return { deleted: false, deactivated: true, warehouse: this.serialize(updated) };
    }

    await this.prisma.warehouse.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId ?? null } });
    return { deleted: true, deactivated: false };
  }

  /** Walk up from `parentId`; if we meet `id`, the move would close a loop. */
  private async assertNoCycle(id: string, parentId: string) {
    const seen = new Set<string>([id]);
    let cursor: string | null = parentId;
    while (cursor) {
      if (seen.has(cursor)) throw new BadRequestException('That parent would create a loop in the warehouse tree');
      seen.add(cursor);
      const row: { parentWarehouseId: string | null } | null = await this.prisma.warehouse.findUnique({
        where: { id: cursor },
        select: { parentWarehouseId: true },
      });
      cursor = row?.parentWarehouseId ?? null;
    }
  }

  private async assertExists(id: string, message: string) {
    const found = await this.prisma.warehouse.findFirst({ where: { id, ...ACTIVE }, select: { id: true } });
    if (!found) throw new NotFoundException(message);
  }

  private async assertNameFree(name: string) {
    const clash = await this.prisma.warehouse.findFirst({
      where: { ...ACTIVE, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(`A warehouse named "${name}" already exists`);
  }

  private serialize(w: any) {
    return {
      id: w.id,
      name: w.name,
      type: w.type,
      parentWarehouseId: w.parentWarehouseId,
      includeInInventory: w.includeInInventory,
      isActive: w.isActive,
      notes: w.notes,
    };
  }
}

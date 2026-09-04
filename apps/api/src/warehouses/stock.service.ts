import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustStockDto, SetStockDto, StockImportItemDto, StockImportRowDto } from './dto/warehouse.dto';

export interface StockQuery {
  q?: string;
  warehouseId?: string;
  /** Include stock held in descendants of warehouseId. */
  includeChildren?: boolean;
  /** Only rows with a non-zero balance. */
  nonZeroOnly?: boolean;
  /** Enforced company isolation (stock scopes via its warehouse's company). */
  companyIds?: string[];
  page?: number;
  pageSize?: number;
}

/** Warehouses whose stock counts as sellable. The single source of truth for
 *  "available" — every caller must go through availabilityFor/availabilityMap. */
const SELLABLE_WAREHOUSE: Prisma.WarehouseWhereInput = { deletedAt: null, isActive: true, includeInInventory: true };

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- reads

  /** Sellable warehouses, optionally narrowed to the companies the caller may see. */
  private sellableWhere(companyIds?: string[]): Prisma.WarehouseWhereInput {
    return { ...SELLABLE_WAREHOUSE, ...(companyIds ? { companyId: { in: companyIds } } : {}) };
  }

  /** Company-wide sellable quantity for one product (optionally scoped to given companies). */
  async availabilityFor(productId: string, companyIds?: string[]): Promise<number> {
    const agg = await this.prisma.stockLevel.aggregate({
      where: { productId, warehouse: this.sellableWhere(companyIds) },
      _sum: { quantityOnHand: true },
    });
    return agg._sum.quantityOnHand ?? 0;
  }

  /**
   * Sellable quantity for many products at once — one query, not N.
   * Products with no stock row are absent from the map; callers treat that as 0.
   */
  async availabilityMap(productIds: string[], companyIds?: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.stockLevel.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, warehouse: this.sellableWhere(companyIds) },
      _sum: { quantityOnHand: true },
    });
    return new Map(rows.map((r) => [r.productId, r._sum.quantityOnHand ?? 0]));
  }

  /** Ids of products physically on a sellable shelf right now (positive on-hand). */
  async stockedProductIds(companyIds?: string[]): Promise<string[]> {
    const rows = await this.prisma.stockLevel.groupBy({
      by: ['productId'],
      where: { warehouse: this.sellableWhere(companyIds) },
      _sum: { quantityOnHand: true },
      having: { quantityOnHand: { _sum: { gt: 0 } } },
    });
    return rows.map((r) => r.productId);
  }

  /** Per-warehouse breakdown for one product, including excluded warehouses (flagged). */
  async byProduct(productId: string, companyIds?: string[]) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, mainSku: true, title: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const levels = await this.prisma.stockLevel.findMany({
      where: { productId, warehouse: { deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) } },
      include: { warehouse: { select: { id: true, name: true, type: true, isActive: true, includeInInventory: true } } },
      orderBy: { warehouse: { name: 'asc' } },
    });

    const rows = levels.map((l) => ({
      warehouseId: l.warehouseId,
      warehouseName: l.warehouse.name,
      warehouseType: l.warehouse.type,
      includeInInventory: l.warehouse.includeInInventory,
      isActive: l.warehouse.isActive,
      quantityOnHand: l.quantityOnHand,
    }));

    return {
      product,
      rows,
      available: rows.filter((r) => r.includeInInventory && r.isActive).reduce((s, r) => s + r.quantityOnHand, 0),
      total: rows.reduce((s, r) => s + r.quantityOnHand, 0),
    };
  }

  /** Paged product × warehouse stock list. */
  async levels(query: StockQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, query.pageSize ?? 50));

    let warehouseIds: string[] | undefined;
    if (query.warehouseId) {
      warehouseIds = query.includeChildren ? await this.descendantIds(query.warehouseId) : [query.warehouseId];
    }

    const where: Prisma.StockLevelWhereInput = {
      warehouse: { deletedAt: null, ...(query.companyIds ? { companyId: { in: query.companyIds } } : {}) },
      product: { deletedAt: null },
      ...(warehouseIds ? { warehouseId: { in: warehouseIds } } : {}),
      ...(query.nonZeroOnly ? { quantityOnHand: { not: 0 } } : {}),
      ...(query.q?.trim()
        ? {
            product: {
              deletedAt: null,
              OR: [
                { mainSku: { contains: query.q.trim(), mode: 'insensitive' } },
                { title: { contains: query.q.trim(), mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.stockLevel.count({ where }),
      this.prisma.stockLevel.findMany({
        where,
        include: {
          product: { select: { id: true, mainSku: true, title: true } },
          warehouse: { select: { id: true, name: true, includeInInventory: true, isActive: true } },
        },
        orderBy: [{ product: { mainSku: 'asc' } }, { warehouse: { name: 'asc' } }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      rows: rows.map((r) => ({
        productId: r.productId,
        sku: r.product.mainSku,
        productName: r.product.title,
        warehouseId: r.warehouseId,
        warehouseName: r.warehouse.name,
        includeInInventory: r.warehouse.includeInInventory,
        quantityOnHand: r.quantityOnHand,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Movement history, newest first. */
  async movements(query: { productId?: string; warehouseId?: string; companyIds?: string[]; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, query.pageSize ?? 50));
    const where: Prisma.StockMovementWhereInput = {
      ...(query.companyIds ? { warehouse: { companyId: { in: query.companyIds } } } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        include: {
          product: { select: { mainSku: true, title: true } },
          warehouse: { select: { name: true } },
          transfer: { select: { reference: true, fromWarehouse: { select: { name: true } }, toWarehouse: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      rows: rows.map((m) => ({
        id: m.id,
        createdAt: m.createdAt,
        sku: m.product.mainSku,
        productName: m.product.title,
        warehouseName: m.warehouse.name,
        qtyDelta: m.qtyDelta,
        balanceAfter: m.balanceAfter,
        reason: m.reason,
        reference: m.reference,
        notes: m.notes,
        serials: m.serials,
        // The other end of a transfer, so a -12 row can say where the 12 went without a second look.
        counterparty: m.transfer
          ? m.qtyDelta < 0
            ? m.transfer.toWarehouse.name
            : m.transfer.fromWarehouse.name
          : null,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // ---------------------------------------------------------------- writes

  /**
   * The only way a balance changes. Applies a signed delta and writes the movement
   * in one transaction, so a level can never drift from its history.
   */
  async adjust(dto: AdjustStockDto, actorId?: string) {
    if (dto.qtyDelta === 0) throw new BadRequestException('Quantity change cannot be zero');
    return this.applyDelta(dto.productId, dto.warehouseId, dto.qtyDelta, dto.reason, actorId, dto.reference ?? null, dto.notes ?? null);
  }

  /** Stocktake: caller states the true count, we derive the delta. */
  async setLevel(dto: SetStockDto, actorId?: string) {
    if (dto.quantityOnHand < 0) throw new BadRequestException('Quantity on hand cannot be negative');
    const current = await this.prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: dto.productId, warehouseId: dto.warehouseId } },
      select: { quantityOnHand: true },
    });
    const delta = dto.quantityOnHand - (current?.quantityOnHand ?? 0);
    if (delta === 0) return { changed: false, quantityOnHand: dto.quantityOnHand };
    const res = await this.applyDelta(dto.productId, dto.warehouseId, delta, dto.reason, actorId, null, dto.notes ?? null);
    return { changed: true, ...res };
  }

  private async applyDelta(
    productId: string,
    warehouseId: string,
    qtyDelta: number,
    reason: string,
    actorId?: string,
    reference: string | null = null,
    notes: string | null = null,
  ) {
    return this.prisma.$transaction((tx) =>
      this.applyDeltaWithin(tx, { productId, warehouseId, qtyDelta, reason, actorId, reference, notes }),
    );
  }

  /**
   * The stock-move primitive, running on a caller-supplied transaction client so a
   * larger operation (e.g. posting a goods receipt) can move stock, update its own
   * records and commit or roll back as one unit. Always writes a movement row, so a
   * balance can never change without an explanation.
   */
  async applyDeltaWithin(
    tx: Prisma.TransactionClient,
    args: {
      productId: string;
      warehouseId: string;
      qtyDelta: number;
      reason: string;
      actorId?: string;
      reference?: string | null;
      notes?: string | null;
      /** The individual units this movement covers, for serial-tracked products. */
      serials?: string[];
      /** Set on both legs of a transfer, which is what pairs them. */
      transferId?: string | null;
    },
  ) {
    const {
      productId, warehouseId, qtyDelta, reason, actorId,
      reference = null, notes = null, serials = [], transferId = null,
    } = args;
    const [product, warehouse] = await Promise.all([
      tx.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, mainSku: true } }),
      tx.warehouse.findFirst({ where: { id: warehouseId, deletedAt: null }, select: { id: true, name: true, isActive: true } }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (!warehouse.isActive) throw new BadRequestException(`${warehouse.name} is inactive — reactivate it before moving stock`);

    const existing = await tx.stockLevel.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
      select: { quantityOnHand: true },
    });
    const balanceAfter = (existing?.quantityOnHand ?? 0) + qtyDelta;
    if (balanceAfter < 0) {
      throw new BadRequestException(
        `${product.mainSku} has ${existing?.quantityOnHand ?? 0} in ${warehouse.name} — cannot remove ${Math.abs(qtyDelta)}`,
      );
    }

    await tx.stockLevel.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      create: { productId, warehouseId, quantityOnHand: balanceAfter },
      update: { quantityOnHand: balanceAfter },
    });
    await tx.stockMovement.create({
      data: {
        productId, warehouseId, qtyDelta, balanceAfter, reason, reference, notes,
        serials, transferId, createdById: actorId ?? null,
      },
    });

    return { productId, warehouseId, quantityOnHand: balanceAfter, qtyDelta };
  }

  // ---------------------------------------------------------------- import

  /**
   * Dry-run an opening-stock sheet: resolve SKU + warehouse name, report every
   * problem before anything is written. Mirrors the shipment import contract.
   */
  async importValidate(rows: StockImportRowDto[]) {
    const warehouses = await this.prisma.warehouse.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true },
    });
    const byName = new Map(warehouses.map((w) => [w.name.trim().toLowerCase(), w]));

    const skus = [...new Set(rows.map((r) => String(r.sku ?? '').trim()).filter(Boolean))];
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, mainSku: { in: skus, mode: 'insensitive' } },
      select: { id: true, mainSku: true, title: true },
    });
    const bySku = new Map(products.map((p) => [p.mainSku.trim().toLowerCase(), p]));

    // Aliases cover SKUs the catalogue knows under another code.
    const aliases = await this.prisma.productSkuAlias.findMany({
      where: { skuValue: { in: skus, mode: 'insensitive' }, deletedAt: null, product: { deletedAt: null } },
      select: { skuValue: true, product: { select: { id: true, mainSku: true, title: true } } },
    });
    for (const a of aliases) {
      const key = a.skuValue.trim().toLowerCase();
      if (!bySku.has(key)) bySku.set(key, a.product);
    }

    const seen = new Map<string, number>();
    const out = rows.map((raw, i) => {
      const errors: string[] = [];
      const sku = String(raw.sku ?? '').trim();
      const warehouseName = String(raw.warehouse ?? '').trim();
      const qtyRaw = String(raw.quantity ?? '').trim();

      const product = sku ? bySku.get(sku.toLowerCase()) : undefined;
      if (!sku) errors.push('SKU is required');
      else if (!product) errors.push(`SKU "${sku}" is not in the catalogue`);

      const warehouse = warehouseName ? byName.get(warehouseName.toLowerCase()) : undefined;
      if (!warehouseName) errors.push('Warehouse is required');
      else if (!warehouse) errors.push(`No active warehouse named "${warehouseName}"`);

      const qty = Number(qtyRaw);
      if (qtyRaw === '') errors.push('Quantity is required');
      else if (!Number.isFinite(qty) || !Number.isInteger(qty)) errors.push(`Quantity "${qtyRaw}" is not a whole number`);
      else if (qty < 0) errors.push('Quantity cannot be negative');

      // The last row of a duplicated pair would silently win, so reject both.
      if (product && warehouse) {
        const key = `${product.id}|${warehouse.id}`;
        const first = seen.get(key);
        if (first !== undefined) errors.push(`Duplicate of row ${first + 2} — same SKU and warehouse`);
        else seen.set(key, i);
      }

      return {
        row: i + 2, // +2: 1-based, and the sheet has a header
        sku,
        productId: product?.id ?? null,
        productName: product?.title ?? null,
        warehouse: warehouseName,
        warehouseId: warehouse?.id ?? null,
        quantityOnHand: Number.isInteger(qty) ? qty : null,
        errors,
        valid: errors.length === 0,
      };
    });

    return { rows: out, validCount: out.filter((r) => r.valid).length, errorCount: out.filter((r) => !r.valid).length };
  }

  /** Write the validated rows as absolute counts. */
  async importCommit(items: StockImportItemDto[], reason = 'opening_balance', actorId?: string) {
    let applied = 0;
    let unchanged = 0;
    for (const item of items) {
      const res = await this.setLevel(
        { productId: item.productId, warehouseId: item.warehouseId, quantityOnHand: item.quantityOnHand, reason },
        actorId,
      );
      if (res.changed) applied++;
      else unchanged++;
    }
    return { applied, unchanged, total: items.length };
  }

  // ---------------------------------------------------------------- helpers

  /** A warehouse and every warehouse beneath it. */
  private async descendantIds(rootId: string): Promise<string[]> {
    const all = await this.prisma.warehouse.findMany({
      where: { deletedAt: null },
      select: { id: true, parentWarehouseId: true },
    });
    const childrenOf = new Map<string, string[]>();
    for (const w of all) {
      if (!w.parentWarehouseId) continue;
      const list = childrenOf.get(w.parentWarehouseId) ?? [];
      list.push(w.id);
      childrenOf.set(w.parentWarehouseId, list);
    }
    const out: string[] = [];
    const queue = [rootId];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue; // defensive: a cycle would otherwise hang the request
      seen.add(id);
      out.push(id);
      queue.push(...(childrenOf.get(id) ?? []));
    }
    return out;
  }
}

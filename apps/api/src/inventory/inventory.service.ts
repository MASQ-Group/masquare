import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../warehouses/stock.service';

export interface InventoryQuery {
  q?: string;
  vendorId?: string;
  /** all (default) | in_stock (positive on-hand) */
  filter?: string;
  /** Enforced company isolation: stock quantities reflect only these companies' warehouses. */
  companyIds?: string[];
  page?: number;
  pageSize?: number;
}

const round2 = (v: number) => Number(v.toFixed(2));

/**
 * Demand that has committed stock but not yet shipped — the same "open sale" definition
 * the procurement workbench uses, so the two views can never disagree about what's owed.
 */
const OPEN_TRANSACTION: Prisma.SalesTransactionWhereInput = {
  deletedAt: null,
  fulfilmentStatus: { notIn: ['shipped', 'cancelled'] },
  resolution: { not: 'cancelled' },
};

/**
 * The inventory picture per product, distinct from the Products catalogue: it answers
 * "how much have I got, how much is spoken for, and how much is coming" rather than
 * "what is this product". All figures are derived, never stored:
 *  - On hand   : physical stock in inventory-counting warehouses (stock.availabilityMap)
 *  - Committed : units owed to open, unshipped sales
 *  - On order  : outstanding units on submitted/partially-received POs
 *  - Available : on hand minus committed, floored at zero (nothing is physically negative)
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  async list(query: InventoryQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const q = query.q?.trim();

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(q
        ? {
            OR: [
              { mainSku: { contains: q, mode: 'insensitive' } },
              { title: { contains: q, mode: 'insensitive' } },
              { aliases: { some: { skuValue: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    // "In stock" restricts to products physically on a shelf right now. Computed once up
    // front so the paged query and count both see the same restricted set.
    if (query.filter === 'in_stock') {
      const stocked = await this.stock.stockedProductIds(query.companyIds);
      where.id = { in: stocked };
    }

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { mainSku: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          mainSku: true,
          title: true,
          averageCostEur: true,
          averageCostQty: true,
          vendor: { select: { id: true, name: true } },
          media: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
        },
      }),
    ]);

    const ids = products.map((p) => p.id);
    if (ids.length === 0) {
      return { rows: [], total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
    }

    // Three batched aggregates for the whole page — never per row.
    const [onHand, ordered, committed] = await Promise.all([
      this.stock.availabilityMap(ids, query.companyIds),
      this.openOrderedMap(ids, query.companyIds),
      this.committedMap(ids, query.companyIds),
    ]);

    const rows = products.map((p) => {
      const oh = onHand.get(p.id) ?? 0;
      const com = committed.get(p.id) ?? 0;
      const avg = p.averageCostEur == null ? null : Number(p.averageCostEur);
      return {
        productId: p.id,
        sku: p.mainSku,
        title: p.title,
        imageUrl: p.media[0]?.url ?? null,
        vendor: p.vendor,
        onHand: oh,
        committed: com,
        onOrder: ordered.get(p.id) ?? 0,
        available: Math.max(0, oh - com),
        averageCostEur: avg,
        averageCostQty: p.averageCostQty ?? 0,
        // Value of what's physically on hand at the running average.
        stockValueEur: avg == null ? null : round2(avg * oh),
      };
    });

    return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** The stock-owed register: units sold before they were in stock. */
  async listOwed(query: { status?: string; companyIds?: string[]; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const where: Prisma.StockOwedWhereInput = {
      deletedAt: null,
      // Company isolation: scope owed stock via the sale that could not be covered.
      ...(query.companyIds ? { salesTransaction: { companyId: { in: query.companyIds } } } : {}),
      // Default view is what still needs action; 'all' shows the history too.
      ...(query.status && query.status !== 'all' ? { status: query.status } : query.status ? {} : { status: 'open' }),
    };

    const [total, rows, openAgg] = await Promise.all([
      this.prisma.stockOwed.count({ where }),
      this.prisma.stockOwed.findMany({
        where,
        include: {
          product: { select: { id: true, mainSku: true, title: true } },
          salesTransaction: { select: { id: true, transactionRef: true } },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: { openedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockOwed.aggregate({ where: { deletedAt: null, status: 'open' }, _sum: { quantity: true } }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        productId: r.productId,
        sku: r.product?.mainSku ?? '—',
        productName: r.product?.title ?? '',
        salesTransactionId: r.salesTransactionId,
        transactionRef: r.transactionRef ?? r.salesTransaction?.transactionRef ?? null,
        warehouse: r.warehouse,
        quantity: r.quantity,
        quantitySettled: r.quantitySettled,
        status: r.status,
        reason: r.reason,
        openedAt: r.openedAt,
        settledAt: r.settledAt,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      totalOpenUnits: openAgg._sum.quantity ?? 0,
    };
  }

  /** Outstanding units on POs still being delivered, summed per product. */
  private async openOrderedMap(productIds: string[], companyIds?: string[]): Promise<Map<string, number>> {
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        productId: { in: productIds },
        purchaseOrder: { deletedAt: null, status: { in: ['submitted', 'partially_received'] }, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      },
      select: { productId: true, quantityOrdered: true, quantityReceived: true },
    });
    const map = new Map<string, number>();
    for (const l of lines) {
      if (!l.productId) continue;
      const outstanding = Math.max(0, l.quantityOrdered - l.quantityReceived);
      map.set(l.productId, (map.get(l.productId) ?? 0) + outstanding);
    }
    return map;
  }

  /** Units owed to open (unshipped, non-cancelled) sales, summed per product. */
  private async committedMap(productIds: string[], companyIds?: string[]): Promise<Map<string, number>> {
    const items = await this.prisma.salesTransactionItem.findMany({
      where: { deletedAt: null, productId: { in: productIds }, transaction: { ...OPEN_TRANSACTION, ...(companyIds ? { companyId: { in: companyIds } } : {}) } },
      select: { productId: true, quantity: true },
    });
    const map = new Map<string, number>();
    for (const it of items) {
      if (!it.productId) continue;
      map.set(it.productId, (map.get(it.productId) ?? 0) + it.quantity);
    }
    return map;
  }
}

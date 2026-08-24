import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../warehouses/stock.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { GenerateOrdersDto } from './dto/procurement.dto';

export interface DemandQuery {
  q?: string;
  salesChannelId?: string;
  /** all | needs_ordering | partial | in_stock */
  stockStatus?: string;
  /** Enforced company isolation: demand + stock reflect only these companies. */
  companyIds?: string[];
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export type StockStatus = 'in_stock' | 'partial' | 'needs_ordering';

/**
 * Demand comes from sales that still owe the customer goods — anything not fully
 * shipped and not cancelled (matches the platform's fulfilmentStatus model, Q3).
 */
const OPEN_TRANSACTION: Prisma.SalesTransactionWhereInput = {
  deletedAt: null,
  fulfilmentStatus: { notIn: ['shipped', 'cancelled'] },
  resolution: { not: 'cancelled' },
};

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly purchaseOrders: PurchaseOrdersService,
  ) {}

  /**
   * The workbench list: one row per product across all open sales, with how much is
   * required, where the demand came from, and whether stock covers it.
   *
   * Performance (§5): the whole list is built from three queries — the demand rows,
   * one batched availability lookup, and one product lookup — never per-row.
   */
  async demand(query: DemandQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

    const items = await this.prisma.salesTransactionItem.findMany({
      where: {
        deletedAt: null,
        productId: { not: null }, // unlinked SKUs can't be ordered — they surface as catalogue alerts
        transaction: {
          ...OPEN_TRANSACTION,
          ...(query.companyIds ? { companyId: { in: query.companyIds } } : {}),
          ...(query.salesChannelId ? { salesChannelId: query.salesChannelId } : {}),
          ...(query.from || query.to
            ? { date: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: endOfDay(query.to) } : {}) } }
            : {}),
        },
      },
      select: {
        productId: true,
        quantity: true,
        transaction: {
          select: {
            id: true, transactionRef: true, date: true,
            salesChannel: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Fold to one row per product.
    type Row = {
      productId: string;
      requiredQuantity: number;
      orderCount: number;
      channels: Map<string, string>;
      refs: { id: string; ref: string; date: Date; quantity: number }[];
      firstSale: Date;
      lastSale: Date;
    };
    const byProduct = new Map<string, Row>();
    for (const it of items) {
      const pid = it.productId!;
      const t = it.transaction;
      const row: Row = byProduct.get(pid) ?? {
        productId: pid, requiredQuantity: 0, orderCount: 0,
        channels: new Map<string, string>(), refs: [], firstSale: t.date, lastSale: t.date,
      };
      row.requiredQuantity += Number(it.quantity);
      row.orderCount += 1;
      if (t.salesChannel) row.channels.set(t.salesChannel.id, t.salesChannel.name);
      row.refs.push({ id: t.id, ref: t.transactionRef, date: t.date, quantity: Number(it.quantity) });
      if (t.date < row.firstSale) row.firstSale = t.date;
      if (t.date > row.lastSale) row.lastSale = t.date;
      byProduct.set(pid, row);
    }

    const productIds = [...byProduct.keys()];
    if (productIds.length === 0) {
      return { rows: [], total: 0, page, pageSize, pageCount: 1, summary: { needsOrdering: 0, partial: 0, inStock: 0 } };
    }

    // Two batched lookups for the whole page-set — never per row.
    const [products, availability] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: {
          id: true, mainSku: true, title: true,
          purchaseCostAmount: true, purchaseCostCurrency: true,
          vendor: { select: { id: true, name: true } },
          media: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
        },
      }),
      this.stock.availabilityMap(productIds, query.companyIds),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));

    let rows = productIds
      .map((pid) => {
        const d = byProduct.get(pid)!;
        const p = productById.get(pid);
        if (!p) return null; // product deleted since the sale
        const available = availability.get(pid) ?? 0;
        const status: StockStatus = available >= d.requiredQuantity ? 'in_stock' : available > 0 ? 'partial' : 'needs_ordering';
        return {
          productId: pid,
          sku: p.mainSku,
          productName: p.title,
          imageUrl: p.media[0]?.url ?? null,
          vendor: p.vendor,
          lastPurchaseCost: p.purchaseCostAmount != null ? Number(p.purchaseCostAmount) : null,
          purchaseCostCurrency: p.purchaseCostCurrency,
          requiredQuantity: d.requiredQuantity,
          availableQuantity: available,
          shortfall: Math.max(0, d.requiredQuantity - available),
          stockStatus: status,
          orderCount: d.orderCount,
          channels: [...d.channels.entries()].map(([id, name]) => ({ id, name })),
          orderRefs: d.refs.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 25),
          firstSaleDate: d.firstSale,
          lastSaleDate: d.lastSale,
        };
      })
      .filter(Boolean) as NonNullable<ReturnType<() => any>>[];

    // Summary is computed before the status filter so the chips always show the full picture.
    const summary = {
      needsOrdering: rows.filter((r) => r.stockStatus === 'needs_ordering').length,
      partial: rows.filter((r) => r.stockStatus === 'partial').length,
      inStock: rows.filter((r) => r.stockStatus === 'in_stock').length,
    };

    if (query.stockStatus && query.stockStatus !== 'all') {
      rows = rows.filter((r) => r.stockStatus === query.stockStatus);
    }
    if (query.q?.trim()) {
      const needle = query.q.trim().toLowerCase();
      rows = rows.filter((r) => `${r.sku} ${r.productName} ${r.vendor?.name ?? ''}`.toLowerCase().includes(needle));
    }

    // Most urgent first: biggest shortfall, then oldest demand.
    rows.sort((a, b) => b.shortfall - a.shortfall || a.firstSaleDate.getTime() - b.firstSaleDate.getTime());

    const total = rows.length;
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      summary,
    };
  }

  /**
   * Turn a selection into draft POs — one per vendor (PR3). Every line carries the
   * product, the quantity to order and the last known unit cost, all editable in the
   * draft. A product with no vendor must be given one in the request.
   */
  async generateOrders(dto: GenerateOrdersDto, actorId?: string, companyId?: string) {
    if (!dto.lines?.length) throw new BadRequestException('Select at least one product to order');

    const productIds = [...new Set(dto.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true, mainSku: true, vendorId: true, purchaseCostAmount: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const missing = productIds.filter((id) => !productById.has(id));
    if (missing.length) throw new BadRequestException('One or more selected products no longer exist');

    // Resolve each line's vendor: explicit override wins, else the product's vendor.
    const resolved = dto.lines.map((l) => {
      const p = productById.get(l.productId)!;
      const vendorId = l.vendorId ?? p.vendorId ?? null;
      return { ...l, vendorId, sku: p.mainSku, defaultCost: p.purchaseCostAmount != null ? Number(p.purchaseCostAmount) : 0 };
    });

    const unassigned = resolved.filter((l) => !l.vendorId);
    if (unassigned.length) {
      throw new BadRequestException(
        `Pick a vendor for: ${unassigned.map((l) => l.sku).join(', ')}`,
      );
    }

    // One draft PO per vendor.
    const byVendor = new Map<string, typeof resolved>();
    for (const l of resolved) {
      const list = byVendor.get(l.vendorId!) ?? [];
      list.push(l);
      byVendor.set(l.vendorId!, list);
    }

    const created: { id: string; poNumber: string; vendorId: string; lineCount: number }[] = [];
    for (const [vendorId, lines] of byVendor) {
      const po = await this.purchaseOrders.create(
        {
          companyId: dto.companyId,
          vendorId,
          currency: dto.currency ?? 'EUR',
          destinationWarehouseId: dto.destinationWarehouseId ?? null,
          notes: dto.notes ?? null,
          lines: lines.map((l) => ({
            productId: l.productId,
            quantityOrdered: l.quantity,
            unitCost: l.unitCost ?? l.defaultCost,
          })),
        },
        actorId,
        companyId, // enforced active company owns the generated POs
      );
      created.push({ id: po.id, poNumber: po.poNumber, vendorId, lineCount: lines.length });
    }

    return { created, orderCount: created.length };
  }
}

function endOfDay(iso: string): Date {
  const d = new Date(iso);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

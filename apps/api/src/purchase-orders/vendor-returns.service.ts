import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../warehouses/stock.service';
import { CostingService } from './costing.service';
import { CreateVendorReturnDto, VendorReturnQuery } from './dto/vendor-return.dto';

const ACTIVE = { deletedAt: null };
const round2 = (v: number) => Number(v.toFixed(2));

@Injectable()
export class VendorReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly costing: CostingService,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(query: VendorReturnQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.VendorReturnWhereInput = {
      ...ACTIVE,
      ...(query.companyIds ? { companyId: { in: query.companyIds } } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}),
      ...(query.q?.trim()
        ? {
            OR: [
              { returnNumber: { contains: query.q.trim(), mode: 'insensitive' } },
              { creditNoteRef: { contains: query.q.trim(), mode: 'insensitive' } },
              { vendor: { name: { contains: query.q.trim(), mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.vendorReturn.count({ where }),
      this.prisma.vendorReturn.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, poNumber: true } },
          warehouse: { select: { id: true, name: true } },
          lines: { select: { quantity: true } },
        },
        orderBy: { postedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        returnNumber: r.returnNumber,
        status: r.status,
        vendor: r.vendor,
        purchaseOrder: r.purchaseOrder,
        warehouse: r.warehouse,
        reason: r.reason,
        creditNoteRef: r.creditNoteRef,
        totalQuantity: r.totalQuantity,
        totalCostEur: Number(r.totalCostEur),
        lineCount: r.lines.length,
        postedAt: r.postedAt,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async get(id: string, companyIds?: string[]) {
    const r = await this.prisma.vendorReturn.findFirst({
      where: { id, ...ACTIVE, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      include: {
        vendor: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        warehouse: { select: { id: true, name: true } },
        lines: {
          include: { product: { select: { id: true, mainSku: true, title: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!r) throw new NotFoundException('Vendor return not found');
    return {
      id: r.id,
      returnNumber: r.returnNumber,
      status: r.status,
      vendor: r.vendor,
      purchaseOrder: r.purchaseOrder,
      warehouse: r.warehouse,
      reason: r.reason,
      creditNoteRef: r.creditNoteRef,
      notes: r.notes,
      totalQuantity: r.totalQuantity,
      totalCostEur: Number(r.totalCostEur),
      postedAt: r.postedAt,
      createdAt: r.createdAt,
      lines: r.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        sku: l.product?.mainSku ?? '—',
        productName: l.product?.title ?? '',
        purchaseOrderLineId: l.purchaseOrderLineId,
        quantity: l.quantity,
        unitCostEur: Number(l.unitCostEur),
        lineCostEur: round2(Number(l.unitCostEur) * l.quantity),
      })),
    };
  }

  /** What is still returnable against a PO — received less already returned, per line. */
  async returnableForPo(purchaseOrderId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, ...ACTIVE },
      include: {
        lines: {
          include: {
            product: { select: { id: true, mainSku: true, title: true, averageCostEur: true } },
            vendorReturnLines: { select: { quantity: true, vendorReturn: { select: { status: true, deletedAt: true } } } },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    return {
      purchaseOrderId: po.id,
      poNumber: po.poNumber,
      vendorId: po.vendorId,
      warehouseId: po.destinationWarehouseId,
      lines: po.lines.map((l) => {
        const returned = l.vendorReturnLines
          .filter((v) => v.vendorReturn.status === 'posted' && v.vendorReturn.deletedAt == null)
          .reduce((s, v) => s + v.quantity, 0);
        return {
          purchaseOrderLineId: l.id,
          productId: l.productId,
          sku: l.product?.mainSku ?? '—',
          productName: l.product?.title ?? '',
          quantityReceived: l.quantityReceived,
          quantityReturned: returned,
          returnable: Math.max(0, l.quantityReceived - returned),
          averageCostEur: l.product?.averageCostEur == null ? null : Number(l.product.averageCostEur),
        };
      }),
    };
  }

  // ---------------------------------------------------------------- write

  /**
   * Post a return. One transaction: stock out, cost out at the running average, the PO's
   * received quantity reduced, and the order's status recalculated.
   *
   * Availability is checked first against the warehouse it leaves from — you cannot send
   * back stock that is not there, and finding that out half-way through would leave the
   * ledger describing a movement that never happened.
   */
  async create(dto: CreateVendorReturnDto, actorId?: string, companyId?: string) {
    if (!dto.lines?.length) throw new BadRequestException('Add at least one line to return');

    const [vendor, warehouse] = await Promise.all([
      this.prisma.vendor.findFirst({ where: { id: dto.vendorId, ...ACTIVE } }),
      this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, ...ACTIVE } }),
    ]);
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const productIds = [...new Set(dto.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, mainSku: true, averageCostEur: true },
    });
    const byProduct = new Map(products.map((p) => [p.id, p]));
    const missing = productIds.filter((id) => !byProduct.has(id));
    if (missing.length) throw new BadRequestException('One or more products no longer exist');

    // Stock must cover the return in the warehouse it leaves from.
    const levels = await this.prisma.stockLevel.findMany({
      where: { warehouseId: dto.warehouseId, productId: { in: productIds } },
      select: { productId: true, quantityOnHand: true },
    });
    const onHand = new Map(levels.map((l) => [l.productId, l.quantityOnHand]));
    const short: string[] = [];
    const wanted = new Map<string, number>();
    for (const l of dto.lines) {
      if (l.quantity <= 0) throw new BadRequestException('Return quantities must be greater than zero');
      wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);
    }
    for (const [productId, qty] of wanted) {
      const have = onHand.get(productId) ?? 0;
      if (qty > have) short.push(`${byProduct.get(productId)?.mainSku ?? productId} (returning ${qty}, ${have} on hand)`);
    }
    if (short.length) {
      throw new BadRequestException(`Not enough stock in ${warehouse.name} to return: ${short.join(', ')}`);
    }

    // A line tied to a PO line cannot send back more than that line actually received.
    const poLineIds = dto.lines.map((l) => l.purchaseOrderLineId).filter(Boolean) as string[];
    if (poLineIds.length) {
      const poLines = await this.prisma.purchaseOrderLine.findMany({
        where: { id: { in: poLineIds } },
        include: {
          product: { select: { mainSku: true } },
          vendorReturnLines: { select: { quantity: true, vendorReturn: { select: { status: true, deletedAt: true } } } },
        },
      });
      const byLine = new Map(poLines.map((l) => [l.id, l]));
      const over: string[] = [];
      for (const l of dto.lines) {
        if (!l.purchaseOrderLineId) continue;
        const pl = byLine.get(l.purchaseOrderLineId);
        if (!pl) throw new BadRequestException('A purchase order line on this return no longer exists');
        const already = pl.vendorReturnLines
          .filter((v) => v.vendorReturn.status === 'posted' && v.vendorReturn.deletedAt == null)
          .reduce((s, v) => s + v.quantity, 0);
        if (l.quantity + already > pl.quantityReceived) {
          over.push(`${pl.product?.mainSku ?? 'line'} (received ${pl.quantityReceived}, already returned ${already})`);
        }
      }
      if (over.length) throw new BadRequestException(`Returning more than was received: ${over.join(', ')}`);
    }

    // The read-back must happen after the commit: this.get() runs on its own connection
    // and would not see rows the open transaction has not yet written.
    const createdId = await this.prisma.$transaction(async (tx) => {
      const returnNumber = await nextReturnNumber(tx);
      let totalQuantity = 0;
      let totalCostEur = 0;
      const lineData: Prisma.VendorReturnLineCreateWithoutVendorReturnInput[] = [];

      for (const [i, l] of dto.lines.entries()) {
        await this.stock.applyDeltaWithin(tx, {
          productId: l.productId,
          warehouseId: dto.warehouseId,
          qtyDelta: -l.quantity,
          reason: 'vendor_return',
          reference: returnNumber,
          actorId,
        });

        // Out at the running average, so the cost of the units that stay is undisturbed.
        const moved = await this.costing.applyMovement(tx, {
          productId: l.productId,
          qtyDelta: -l.quantity,
          reason: 'vendor_return',
          refType: 'vendor_return',
          reference: returnNumber,
          actorId,
        });

        if (l.purchaseOrderLineId) {
          await tx.purchaseOrderLine.update({
            where: { id: l.purchaseOrderLineId },
            data: { quantityReceived: { decrement: l.quantity } },
          });
        }

        totalQuantity += l.quantity;
        totalCostEur = round2(totalCostEur + moved.unitCost * l.quantity);
        lineData.push({
          product: { connect: { id: l.productId } },
          ...(l.purchaseOrderLineId ? { purchaseOrderLine: { connect: { id: l.purchaseOrderLineId } } } : {}),
          quantity: l.quantity,
          unitCostEur: new Prisma.Decimal(round2(moved.unitCost)),
          sortOrder: i,
        });
      }

      const created = await tx.vendorReturn.create({
        data: {
          returnNumber,
          companyId,
          vendorId: dto.vendorId,
          purchaseOrderId: dto.purchaseOrderId ?? null,
          warehouseId: dto.warehouseId,
          status: 'posted',
          reason: dto.reason.trim(),
          creditNoteRef: dto.creditNoteRef?.trim() || null,
          notes: dto.notes?.trim() || null,
          totalQuantity,
          totalCostEur: new Prisma.Decimal(totalCostEur),
          createdById: actorId ?? null,
          lines: { create: lineData },
        },
      });

      // Point the cost ledger rows at the document now that it has an id.
      await tx.productCostEvent.updateMany({
        where: { refType: 'vendor_return', reference: returnNumber, refId: null },
        data: { refId: created.id },
      });

      if (dto.purchaseOrderId) await this.recalcPoStatus(tx, dto.purchaseOrderId, returnNumber, actorId);

      return created.id;
    });

    return this.get(createdId);
  }

  /**
   * Bring the PO's status back in line after stock went back.
   *
   * A fully received order that has had goods returned is outstanding again, so it
   * reverts to submitted or partially received rather than staying closed.
   */
  private async recalcPoStatus(tx: Prisma.TransactionClient, purchaseOrderId: string, reference: string, actorId?: string) {
    const po = await tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { lines: true } });
    if (!po || po.status === 'cancelled') return;

    const anyReceived = po.lines.some((l) => l.quantityReceived > 0);
    const outstanding = po.lines.reduce((s, l) => s + Math.max(0, l.quantityOrdered - l.quantityReceived), 0);
    const next = outstanding === 0 ? 'received' : anyReceived ? 'partially_received' : 'submitted';
    if (next === po.status) return;

    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: {
        status: next,
        receivedAt: next === 'received' ? po.receivedAt : null,
        updatedById: actorId ?? null,
        statusEvents: {
          create: { status: next, note: `Reopened by return ${reference}`, createdById: actorId ?? null },
        },
      },
    });
  }
}

/** RTV-YYYY-NNNNN, year-scoped, generated inside the caller's transaction. */
async function nextReturnNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `RTV-${year}-`;
  const last = await tx.vendorReturn.findFirst({
    where: { returnNumber: { startsWith: prefix } },
    orderBy: { returnNumber: 'desc' },
    select: { returnNumber: true },
  });
  const n = last ? Number(last.returnNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(5, '0')}`;
}

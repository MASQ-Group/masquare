import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ACTIVE = { deletedAt: null };

export interface SerialQuery {
  q?: string;
  productId?: string;
  warehouseId?: string;
  status?: string;
  /** Enforced company isolation (serials scope via their warehouse's company). */
  companyIds?: string[];
  page?: number;
  pageSize?: number;
}

/**
 * The register of individual units for serial-tracked products.
 *
 * Every state change goes through here so the rules live in one place: a serial is
 * received once, leaves once, and can never be in two places at the same time.
 */
@Injectable()
export class SerialsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- reads

  async list(query: SerialQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const where: Prisma.SerialNumberWhereInput = {
      ...(query.companyIds ? { warehouse: { companyId: { in: query.companyIds } } } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q?.trim()
        ? {
            OR: [
              { serial: { contains: query.q.trim(), mode: 'insensitive' } },
              { product: { mainSku: { contains: query.q.trim(), mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.serialNumber.count({ where }),
      this.prisma.serialNumber.findMany({
        where,
        include: {
          product: { select: { id: true, mainSku: true, title: true } },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: [{ status: 'asc' }, { serial: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      rows: rows.map((s) => ({
        id: s.id,
        serial: s.serial,
        status: s.status,
        product: s.product,
        warehouse: s.warehouse,
        receivedAt: s.receivedAt,
        dispatchedAt: s.dispatchedAt,
        salesTransactionId: s.salesTransactionId,
        vendorReturnId: s.vendorReturnId,
        notes: s.notes,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Serials on the shelf for a product — what a sale or return can pick from. */
  async available(productId: string, warehouseId?: string, companyIds?: string[]) {
    const rows = await this.prisma.serialNumber.findMany({
      where: { productId, status: 'in_stock', ...(warehouseId ? { warehouseId } : {}), ...(companyIds ? { warehouse: { companyId: { in: companyIds } } } : {}) },
      include: { warehouse: { select: { id: true, name: true } } },
      orderBy: { serial: 'asc' },
    });
    return rows.map((s) => ({ id: s.id, serial: s.serial, warehouse: s.warehouse, receivedAt: s.receivedAt }));
  }

  /** Which of these products require serials — one query the callers can branch on. */
  async trackedProductIds(productIds: string[]): Promise<Set<string>> {
    if (!productIds.length) return new Set();
    const rows = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(productIds)] }, serialTracked: true, ...ACTIVE },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  // ---------------------------------------------------------------- writes

  /**
   * Take serials into stock against a goods receipt.
   *
   * Duplicates are refused rather than merged: the same serial arriving twice means
   * either a typo or a real mix-up, and silently accepting it would make the register
   * describe stock that does not exist.
   */
  async receiveWithin(
    tx: Prisma.TransactionClient,
    args: { productId: string; serials: string[]; warehouseId: string; goodsReceiptId: string; actorId?: string },
  ) {
    const cleaned = args.serials.map((s) => s.trim()).filter(Boolean);
    const dupInBatch = cleaned.filter((s, i) => cleaned.indexOf(s) !== i);
    if (dupInBatch.length) {
      throw new BadRequestException(`The same serial was entered twice: ${[...new Set(dupInBatch)].join(', ')}`);
    }

    const clash = await tx.serialNumber.findMany({
      where: { productId: args.productId, serial: { in: cleaned } },
      select: { serial: true, status: true },
    });
    if (clash.length) {
      throw new BadRequestException(
        `Already registered for this product: ${clash.map((c) => `${c.serial} (${c.status.replace('_', ' ')})`).join(', ')}`,
      );
    }

    const now = new Date();
    await tx.serialNumber.createMany({
      data: cleaned.map((serial) => ({
        productId: args.productId,
        serial,
        status: 'in_stock',
        warehouseId: args.warehouseId,
        goodsReceiptId: args.goodsReceiptId,
        receivedAt: now,
        createdById: args.actorId ?? null,
      })),
    });
    return cleaned.length;
  }

  /**
   * Retire serials as they leave. `serials` are the codes, resolved per product so a
   * caller never has to hold ids.
   */
  async dispatchWithin(
    tx: Prisma.TransactionClient,
    args: {
      productId: string;
      serials: string[];
      to: 'sold' | 'returned_to_vendor' | 'scrapped';
      salesTransactionId?: string;
      vendorReturnId?: string;
      warehouseId?: string;
    },
  ) {
    const cleaned = args.serials.map((s) => s.trim()).filter(Boolean);
    if (!cleaned.length) return 0;

    const found = await tx.serialNumber.findMany({
      where: { productId: args.productId, serial: { in: cleaned } },
      select: { id: true, serial: true, status: true, warehouseId: true },
    });
    const bySerial = new Map(found.map((f) => [f.serial, f]));

    const unknown = cleaned.filter((s) => !bySerial.has(s));
    if (unknown.length) throw new BadRequestException(`Not a registered serial for this product: ${unknown.join(', ')}`);

    const notInStock = found.filter((f) => f.status !== 'in_stock');
    if (notInStock.length) {
      throw new BadRequestException(
        `Already gone: ${notInStock.map((f) => `${f.serial} (${f.status.replace('_', ' ')})`).join(', ')}`,
      );
    }
    if (args.warehouseId) {
      const elsewhere = found.filter((f) => f.warehouseId && f.warehouseId !== args.warehouseId);
      if (elsewhere.length) {
        throw new BadRequestException(`Not in the selected warehouse: ${elsewhere.map((f) => f.serial).join(', ')}`);
      }
    }

    await tx.serialNumber.updateMany({
      where: { id: { in: found.map((f) => f.id) } },
      data: {
        status: args.to,
        warehouseId: null,
        dispatchedAt: new Date(),
        salesTransactionId: args.salesTransactionId ?? null,
        vendorReturnId: args.vendorReturnId ?? null,
      },
    });
    return found.length;
  }

  /** Put serials back on the shelf — used when a dispatch is undone. */
  async restockWithin(tx: Prisma.TransactionClient, args: { salesTransactionId?: string; vendorReturnId?: string; warehouseId?: string }) {
    if (!args.salesTransactionId && !args.vendorReturnId) return 0;
    const where: Prisma.SerialNumberWhereInput = args.salesTransactionId
      ? { salesTransactionId: args.salesTransactionId }
      : { vendorReturnId: args.vendorReturnId! };
    const rows = await tx.serialNumber.findMany({ where, select: { id: true } });
    if (!rows.length) return 0;
    await tx.serialNumber.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: {
        status: 'in_stock',
        warehouseId: args.warehouseId ?? null,
        dispatchedAt: null,
        salesTransactionId: null,
        vendorReturnId: null,
      },
    });
    return rows.length;
  }

  async get(id: string) {
    const s = await this.prisma.serialNumber.findUnique({
      where: { id },
      include: { product: { select: { id: true, mainSku: true, title: true } }, warehouse: { select: { id: true, name: true } } },
    });
    if (!s) throw new NotFoundException('Serial not found');
    return s;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AvailabilityQuery {
  q?: string;
  brandId?: string;
  vendorId?: string;
  productTypeId?: string;
  /** Only rows whose availability has (or hasn't) been set yet. */
  unset?: boolean;
  page?: number;
  pageSize?: number;
}

const ACTIVE = { deletedAt: null };

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(p: any) {
    return {
      productId: p.id,
      mainSku: p.mainSku,
      title: p.title,
      brand: p.brand?.name ?? null,
      vendor: p.vendor?.name ?? null,
      productType: p.productType?.name ?? null,
      quantity: p.availability?.quantity ?? null, // null = never set
      lastSource: p.availability?.lastSource ?? null,
      updatedAt: p.availability?.updatedAt ?? null,
    };
  }

  /** The product filter shared by list() and listIds() so "select all matching" uses the same set. */
  private buildWhere(query: AvailabilityQuery): Prisma.ProductWhereInput {
    const q = query.q?.trim();
    return {
      ...ACTIVE,
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.productTypeId ? { productTypeId: query.productTypeId } : {}),
      ...(query.unset != null ? { availability: query.unset ? { is: null } : { isNot: null } } : {}),
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
  }

  /** Every product id matching the current filter — backs "select all N" across pages. */
  async listIds(query: AvailabilityQuery): Promise<string[]> {
    const rows = await this.prisma.product.findMany({ where: this.buildWhere(query), select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Products with their channel-availability quantity (the number broadcast to sales channels). */
  async list(query: AvailabilityQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const where = this.buildWhere(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { mainSku: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, mainSku: true, title: true,
          brand: { select: { name: true } },
          vendor: { select: { name: true } },
          productType: { select: { name: true } },
          availability: { select: { quantity: true, lastSource: true, updatedAt: true } },
        },
      }),
    ]);
    return { items: rows.map((r) => this.serialize(r)), total, page, pageSize };
  }

  async get(productId: string) {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, ...ACTIVE },
      select: {
        id: true, mainSku: true, title: true,
        brand: { select: { name: true } }, vendor: { select: { name: true } }, productType: { select: { name: true } },
        availability: { select: { quantity: true, lastSource: true, updatedAt: true } },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    const ledger = await this.prisma.availabilityLedger.findMany({
      where: { productId }, orderBy: { createdAt: 'desc' }, take: 25,
    });
    return { ...this.serialize(p), ledger };
  }

  /** Set the absolute available quantity (manual). Records the change in the ledger. */
  async setQuantity(productId: string, quantity: number, note: string | null, actorId?: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, ...ACTIVE }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const qty = Math.max(0, Math.trunc(quantity));
    const current = await this.prisma.productAvailability.findUnique({ where: { productId }, select: { quantity: true } });
    const prev = current?.quantity ?? 0;
    return this.prisma.$transaction(async (tx) => {
      await tx.productAvailability.upsert({
        where: { productId },
        create: { productId, quantity: qty, lastSource: 'manual', updatedById: actorId ?? null },
        update: { quantity: qty, lastSource: 'manual', updatedById: actorId ?? null },
      });
      await tx.availabilityLedger.create({
        data: { productId, delta: qty - prev, newQuantity: qty, reason: 'manual_set', note: note?.trim() || null, createdById: actorId ?? null },
      });
      return this.get(productId);
    });
  }

  /**
   * Move availability by a delta (never below zero), for the sell-through / return flows.
   * Composable in an outer transaction. Returns the new quantity. Used by later phases —
   * a sale calls `adjust(productId, -qty, 'sale', …)`, a cancellation the positive inverse.
   */
  async adjust(
    productId: string,
    delta: number,
    reason: 'sale' | 'cancellation' | 'return' | 'vendor_import' | 'manual_adjust',
    ref: { refType?: string; refId?: string; note?: string } = {},
    actorId?: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const current = await db.productAvailability.findUnique({ where: { productId }, select: { quantity: true } });
    const prev = current?.quantity ?? 0;
    const next = Math.max(0, prev + Math.trunc(delta));
    const source = reason === 'vendor_import' ? 'vendor_import' : reason === 'return' || reason === 'cancellation' ? 'return' : reason === 'sale' ? 'sale' : 'manual';
    await db.productAvailability.upsert({
      where: { productId },
      create: { productId, quantity: next, lastSource: source, updatedById: actorId ?? null },
      update: { quantity: next, lastSource: source, updatedById: actorId ?? null },
    });
    await db.availabilityLedger.create({
      data: { productId, delta: next - prev, newQuantity: next, reason, refType: ref.refType ?? null, refId: ref.refId ?? null, note: ref.note ?? null, createdById: actorId ?? null },
    });
    return next;
  }
}

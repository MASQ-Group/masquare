import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AvailabilityQuery {
  q?: string;
  brandId?: string;
  vendorId?: string;
  productTypeId?: string;
  /** Only rows whose availability has (or hasn't) been set yet. */
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
  /**
   * The availability list is the availability table, not the catalogue.
   *
   * A product is here because someone put it here — a vendor file or a person. Listing every
   * product instead and leaving a blank where there was no row made the two indistinguishable:
   * "we hold none of this" looked the same as "nobody has ever assessed this", and there was
   * nothing for an operator to add because everything was already on screen. Products that are
   * listed on a channel but absent from here are work to do, and they have their own tab.
   */
  private buildWhere(query: AvailabilityQuery): Prisma.ProductWhereInput {
    const q = query.q?.trim();
    return {
      ...ACTIVE,
      availability: { isNot: null },
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.productTypeId ? { productTypeId: query.productTypeId } : {}),
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

  /**
   * SKUs live on a sales channel but absent from availability — the onboarding worklist.
   *
   * A listing whose SKU is not in availability is deliberately ignored by every quantity path: it is
   * never pushed, and never set to zero. That silence is correct, but it made the gap invisible, so
   * a product could sit listed and unmanaged indefinitely with nothing to say so. This is that gap,
   * named.
   *
   * Two kinds appear, and the difference decides what to do about them:
   *   • linked to a product — add it to availability and it is ready to sell
   *   • linked to nothing — the channel SKU matches no product at all, so the product must be
   *     created first. Grouped by SKU so one row means one thing to fix, not one per marketplace.
   */
  async missingFromAvailability(query: { q?: string; channelType?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const q = query.q?.trim()?.toLowerCase();

    const rows = await this.prisma.channelListing.findMany({
      where: {
        // Absent from availability. A listing whose product IS in availability is already handled.
        OR: [{ productId: null }, { product: { availability: { is: null } } }],
        ...(query.channelType ? { integration: { channelType: query.channelType } } : {}),
        ...(q ? { channelSku: { contains: q, mode: 'insensitive' } } : {}),
      },
      select: {
        channelSku: true,
        marketplace: true,
        listedQuantity: true,
        listingStatus: true,
        productId: true,
        product: { select: { id: true, mainSku: true, title: true } },
        integration: { select: { channelType: true, name: true } },
      },
    });

    // One row per SKU: the same product listed on five marketplaces is one job, not five.
    // Grouped by platform, because "listed on Amazon" is the fact that matters at a glance and the
    // eleven marketplaces behind it are the detail. eBay runs one integration across many markets,
    // so its market comes from the listing; Amazon and OnBuy carry theirs on the integration.
    const bySku = new Map<string, {
      channelSku: string;
      productId: string | null;
      mainSku: string | null;
      title: string | null;
      channels: { platform: string; markets: string[] }[];
      listedQuantity: number;
    }>();
    for (const r of rows) {
      const key = (r.product?.mainSku ?? r.channelSku).trim().toLowerCase();
      const cur = bySku.get(key) ?? {
        channelSku: r.channelSku,
        productId: r.productId,
        mainSku: r.product?.mainSku ?? null,
        title: r.product?.title ?? null,
        channels: [],
        listedQuantity: 0,
      };
      const platform = r.integration?.channelType ?? 'unknown';
      const market = platform === 'ebay' && r.marketplace
        ? `eBay ${r.marketplace.toUpperCase()}`
        : r.integration?.name ?? platform;
      let group = cur.channels.find((c) => c.platform === platform);
      if (!group) { group = { platform, markets: [] }; cur.channels.push(group); }
      if (!group.markets.includes(market)) group.markets.push(market);
      // What the marketplaces currently advertise, which is a useful starting figure but not a
      // number the platform vouches for — the operator still decides what goes into availability.
      cur.listedQuantity = Math.max(cur.listedQuantity, r.listedQuantity ?? 0);
      bySku.set(key, cur);
    }

    const all = [...bySku.values()].sort((a, b) => {
      // Products we already know come first: they are one click from being onboarded.
      if (!!a.productId !== !!b.productId) return a.productId ? -1 : 1;
      return (a.mainSku ?? a.channelSku).localeCompare(b.mainSku ?? b.channelSku);
    });

    return {
      items: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      /** Split so the UI can say how much is "add to availability" and how much is "create first". */
      withProduct: all.filter((r) => r.productId).length,
      withoutProduct: all.filter((r) => !r.productId).length,
      page,
      pageSize,
    };
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

  /**
   * Clear availability entirely, so it can be rebuilt from figures someone vouches for.
   *
   * Almost every row arrived by a route that is no longer allowed: `adjust` used to upsert, so an
   * order for a product nobody had stocked created a row, sales clamped it at zero, and each
   * cancellation added one to nothing. 664 of 690 rows came from trade rather than from a vendor
   * file or a person, and 324 advertised units that never existed. A row at zero would still claim
   * "we know this product and hold none", which nobody ever established — so the table is emptied
   * rather than zeroed, and each product re-enters deliberately.
   *
   * The lines' recorded deductions go with it. Leaving 5,473 units of debt against rows that no
   * longer exist would reinvent the bug: re-add a product, cancel an old order, and the difference
   * between "deducted" and "desired" hands back units that were never taken.
   *
   * The ledger is kept. It is the record of what the system did, mistakes included, and deleting it
   * would erase the evidence of why the table was emptied.
   */
  async purgeAll(opts: { confirm?: boolean } = {}, actorId?: string) {
    const rows = await this.prisma.productAvailability.findMany({
      select: { productId: true, quantity: true, lastSource: true },
    });
    const lines = await this.prisma.salesTransactionItem.aggregate({
      where: { deletedAt: null, availabilityDeductedQty: { not: 0 } },
      _count: true,
      _sum: { availabilityDeductedQty: true },
    });

    const bySource = new Map<string, { rows: number; units: number }>();
    for (const r of rows) {
      const k = r.lastSource ?? '(none)';
      const cur = bySource.get(k) ?? { rows: 0, units: 0 };
      cur.rows += 1;
      cur.units += r.quantity;
      bySource.set(k, cur);
    }

    // Rows never set by a person or a vendor file: the ones trade created on its own.
    const deliberate = await this.prisma.availabilityLedger.findMany({
      where: { reason: { in: ['manual_set', 'manual_adjust', 'vendor_import'] } },
      select: { productId: true },
      distinct: ['productId'],
    });
    const deliberateIds = new Set(deliberate.map((d) => d.productId));

    const summary = {
      rows: rows.length,
      unitsAdvertised: rows.reduce((s, r) => s + r.quantity, 0),
      rowsFromTradeOnly: rows.filter((r) => !deliberateIds.has(r.productId)).length,
      bySource: [...bySource].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.rows - a.rows),
      linesHoldingADeduction: lines._count,
      unitsHeldOnLines: lines._sum.availabilityDeductedQty ?? 0,
    };

    if (!opts.confirm) return { dryRun: true as const, ...summary };

    await this.prisma.$transaction(async (tx) => {
      // One ledger line per product saying where its quantity went, so a product that reappears
      // later has an explanation rather than an unaccountable gap.
      for (const r of rows) {
        if (r.quantity === 0) continue;
        await tx.availabilityLedger.create({
          data: {
            productId: r.productId,
            delta: -r.quantity,
            newQuantity: 0,
            reason: 'purge',
            note: 'Availability cleared — rebuilt from vendor files and manual entry',
            createdById: actorId ?? null,
          },
        });
      }
      await tx.productAvailability.deleteMany({});
      await tx.salesTransactionItem.updateMany({
        where: { availabilityDeductedQty: { not: 0 } },
        data: { availabilityDeductedQty: 0 },
      });
    });

    return { dryRun: false as const, ...summary };
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
   * Move an EXISTING availability row by a delta (never below zero). Returns the new quantity, or
   * null when the product is not in availability.
   *
   * It will not create a row. A product enters availability deliberately — from a vendor file or by
   * a person — and never as a side effect of trade. This used to upsert, so an order for a product
   * nobody had ever stocked created a row: sales clamped it at zero, then each cancellation added
   * one to nothing. 664 rows arrived that way, 324 of them showing 1,096 units that never existed,
   * and every one of those was a candidate to be broadcast to the marketplaces as sellable.
   *
   * A product outside availability is simply not our concern: no row, no ledger entry, nothing
   * recorded against the line. If it is added later it starts from the figure the operator or the
   * vendor file gives it, which is the only number anyone can vouch for.
   */
  async adjust(
    productId: string,
    delta: number,
    // No 'return': a return never moves availability. A cancellation does, but only before shipment,
    // which the caller decides.
    reason: 'sale' | 'cancellation' | 'vendor_import' | 'manual_adjust',
    ref: { refType?: string; refId?: string; note?: string } = {},
    actorId?: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number | null> {
    const current = await db.productAvailability.findUnique({ where: { productId }, select: { quantity: true } });
    if (!current) return null;
    const prev = current.quantity;
    const next = Math.max(0, prev + Math.trunc(delta));
    // A cancellation is the sale reversing itself, so it reads as the sale did. There is no
    // 'return' source: a return never moves availability.
    const source = reason === 'vendor_import' ? 'vendor_import' : reason === 'manual_adjust' ? 'manual' : 'sale';
    await db.productAvailability.update({
      where: { productId },
      data: { quantity: next, lastSource: source, updatedById: actorId ?? null },
    });
    await db.availabilityLedger.create({
      data: { productId, delta: next - prev, newQuantity: next, reason, refType: ref.refType ?? null, refId: ref.refId ?? null, note: ref.note ?? null, createdById: actorId ?? null },
    });
    return next;
  }
}

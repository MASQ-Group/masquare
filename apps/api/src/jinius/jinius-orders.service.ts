import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { JINIUS_PATHS, readJiniusTest } from '../integrations/jinius';
import { readJiniusOrders, unitsToHold, STATES_WORTH_PULLING, type JiniusOrderRead } from './jinius-orders';
import { buildLocalSaleDraft, jiniusSaleRef, type JiniusSaleLineIn } from './jinius-local-sale';
import { SalesTransactionsService } from '../sales-transactions/sales-transactions.service';

/** Mirakl's maximum page size for offset pagination. */
const PAGE = 100;

/**
 * Jinius orders: pulled from Mirakl, matched to products, and kept out of the revenue reports.
 *
 * The reports count the LOCAL transaction accounting issues for these sales, so an order here is the
 * trail back to the marketplace rather than a sale of its own. What it does affect is availability:
 * a Jinius sale takes units out of the shared pool every channel is told about, or the other channels
 * would go on offering stock that is already sold.
 */
@Injectable()
export class JiniusOrdersService {
  private readonly logger = new Logger(JiniusOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly sales: SalesTransactionsService,
  ) {}

  /** The Jinius connection: the one named, or the only one the caller can see. */
  private async integration(integrationId?: string, companyIds?: string[]) {
    const rows = await this.prisma.channelIntegration.findMany({
      where: {
        deletedAt: null, channelType: 'jinius',
        ...(integrationId ? { id: integrationId } : {}),
        ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
      },
      select: { id: true, name: true, targetCompanyId: true, lastSyncedAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!rows.length) throw new NotFoundException('No Jinius connection is set up for this company.');
    if (!integrationId && rows.length > 1) throw new BadRequestException('More than one Jinius connection — say which.');
    return rows[0];
  }

  /**
   * Pull orders from Jinius.
   *
   * Incremental by `start_update_date`, which Mirakl itself widens by a small delta so an order
   * updated during the previous run is not missed. The first run reaches back `backfillDays`, so the
   * orders already placed on the shop arrive with it.
   */
  async sync(args: { integrationId?: string; companyIds?: string[]; sinceDays?: number; actorId?: string } = {}) {
    const integration = await this.integration(args.integrationId, args.companyIds);
    const since = args.sinceDays != null
      ? new Date(Date.now() - args.sinceDays * 864e5)
      : integration.lastSyncedAt ?? new Date(Date.now() - 365 * 864e5);

    const counts = { scanned: 0, created: 0, updated: 0, lines: 0, unmatched: 0 };
    let newest: Date | null = null;

    for (let offset = 0; ; offset += PAGE) {
      const r = await this.integrations.jiniusGet(integration.id, JINIUS_PATHS.orders, {
        max: PAGE,
        offset,
        start_update_date: since.toISOString(),
        order_state_codes: STATES_WORTH_PULLING.join(','),
      });
      if (!r.ok) throw new BadRequestException(readJiniusTest(r.status, r.json ?? r.text, r.shopId).message);
      const json = r.json;

      const orders = readJiniusOrders(json);
      if (!orders.length) break;
      for (const order of orders) {
        const saved = await this.save(integration, order);
        counts.scanned += 1;
        counts[saved.created ? 'created' : 'updated'] += 1;
        counts.lines += order.lines.length;
        counts.unmatched += saved.unmatched;
        if (order.orderedAt && (!newest || order.orderedAt > newest)) newest = order.orderedAt;
      }
      const total = Number(json?.total_count ?? 0);
      if (total && offset + PAGE >= total) break;
      if (orders.length < PAGE) break;
    }

    await this.prisma.channelIntegration.update({ where: { id: integration.id }, data: { lastSyncedAt: new Date() } });
    const moved = await this.settleAvailability(integration.id, args.actorId);
    this.logger.log(`Jinius orders: ${counts.scanned} scanned, ${counts.created} new, ${counts.unmatched} lines unmatched, availability ${moved.deducted} taken / ${moved.returned} given back`);
    return { ok: true as const, ...counts, availability: moved, newestOrder: newest };
  }

  /** One order and its lines, matched to products by our own SKU. */
  private async save(integration: { id: string; targetCompanyId: string | null }, order: JiniusOrderRead) {
    const skus = order.lines.map((l) => l.offerSku);
    const products = await this.productsBySku(skus);
    const header = {
      companyId: integration.targetCompanyId,
      commercialId: order.commercialId,
      orderedAt: order.orderedAt!,
      state: order.state,
      currency: order.currency,
      taxMode: order.taxMode,
      priceTotal: order.priceTotal,
      shippingPrice: order.shippingPrice,
      totalCommission: order.totalCommission,
      totalPrice: order.totalPrice,
      raw: order as unknown as object,
      lastPulledAt: new Date(),
    };
    const existing = await this.prisma.jiniusOrder.findUnique({
      where: { integrationId_orderId: { integrationId: integration.id, orderId: order.orderId } },
      select: { id: true },
    });
    const row = existing
      ? await this.prisma.jiniusOrder.update({ where: { id: existing.id }, data: header, select: { id: true } })
      : await this.prisma.jiniusOrder.create({ data: { integrationId: integration.id, orderId: order.orderId, ...header }, select: { id: true } });

    let unmatched = 0;
    for (const l of order.lines) {
      const productId = products.get(l.offerSku.trim().toLowerCase()) ?? null;
      if (!productId) unmatched += 1;
      const data = {
        offerSku: l.offerSku, productTitle: l.productTitle, productId,
        quantity: l.quantity, price: l.price, unitPrice: l.unitPrice, shippingPrice: l.shippingPrice,
        totalCommission: l.totalCommission, taxAmount: l.taxAmount, state: l.state,
      };
      await this.prisma.jiniusOrderLine.upsert({
        where: { jiniusOrderId_orderLineId: { jiniusOrderId: row.id, orderLineId: l.orderLineId } },
        create: { jiniusOrderId: row.id, orderLineId: l.orderLineId, ...data },
        update: data,
      });
    }
    return { created: !existing, unmatched };
  }

  /** Our own SKUs, main and alias, lowercased — the same matching the listings sync uses. */
  private async productsBySku(skus: string[]): Promise<Map<string, string>> {
    const wanted = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
    if (!wanted.length) return new Map();
    const [products, aliases] = await Promise.all([
      this.prisma.product.findMany({ where: { deletedAt: null, mainSku: { in: wanted, mode: 'insensitive' } }, select: { id: true, mainSku: true } }),
      this.prisma.productSkuAlias.findMany({ where: { deletedAt: null, skuValue: { in: wanted, mode: 'insensitive' } }, select: { productId: true, skuValue: true } }),
    ]);
    const out = new Map<string, string>();
    for (const a of aliases) out.set(a.skuValue.trim().toLowerCase(), a.productId);
    // A main SKU wins over an alias that happens to spell the same thing.
    for (const p of products) out.set(p.mainSku.trim().toLowerCase(), p.id);
    return out;
  }

  /**
   * Bring availability into line with what the orders now say.
   *
   * Per line, not per order: a line already counted stays counted, and only the difference moves. A
   * cancelled or refused order gives its units back, which is why this runs over everything rather
   * than only over what this pull touched.
   */
  async settleAvailability(integrationId: string, actorId?: string) {
    const lines = await this.prisma.jiniusOrderLine.findMany({
      where: { order: { integrationId, deletedAt: null }, productId: { not: null } },
      select: {
        id: true, productId: true, quantity: true, state: true, availabilityDeductedQty: true,
        order: { select: { id: true, orderId: true, state: true, availabilityDeductedAt: true } },
      },
    });
    let deducted = 0;
    let returned = 0;
    for (const l of lines) {
      const want = unitsToHold({ quantity: l.quantity, state: l.state }, l.order.state);
      const delta = want - l.availabilityDeductedQty;
      if (delta === 0) continue;
      const availability = await this.prisma.productAvailability.findUnique({ where: { productId: l.productId! }, select: { quantity: true } });
      // No availability row means the product is not in the shared pool at all; there is nothing to
      // lower, and inventing a row would advertise a quantity nobody set.
      if (!availability) continue;
      const next = Math.max(0, availability.quantity - delta);
      await this.prisma.$transaction([
        this.prisma.productAvailability.update({ where: { productId: l.productId! }, data: { quantity: next, lastSource: 'sale' } }),
        this.prisma.availabilityLedger.create({
          data: {
            productId: l.productId!, delta: -(delta), newQuantity: next,
            reason: delta > 0 ? 'sale' : 'cancellation',
            refType: 'jinius_order', refId: l.order.id,
            note: `Jinius order ${l.order.orderId} (${l.order.state})`,
            createdById: actorId ?? null,
          },
        }),
        this.prisma.jiniusOrderLine.update({ where: { id: l.id }, data: { availabilityDeductedQty: want } }),
      ]);
      if (delta > 0) deducted += delta; else returned += -delta;
      if (!l.order.availabilityDeductedAt && want > 0) {
        await this.prisma.jiniusOrder.update({ where: { id: l.order.id }, data: { availabilityDeductedAt: new Date() } });
      }
    }
    return { deducted, returned };
  }

  /** The orders list: newest first, with their lines and whether a local transaction covers them. */
  async list(args: { integrationId?: string; companyIds?: string[]; linked?: 'yes' | 'no'; q?: string; limit?: number }) {
    const integration = await this.integration(args.integrationId, args.companyIds);
    const rows = await this.prisma.jiniusOrder.findMany({
      where: {
        integrationId: integration.id, deletedAt: null,
        ...(args.linked === 'yes' ? { linkedTransactionId: { not: null } } : args.linked === 'no' ? { linkedTransactionId: null } : {}),
        ...(args.q?.trim()
          ? {
            OR: [
              { orderId: { contains: args.q.trim(), mode: 'insensitive' as const } },
              { commercialId: { contains: args.q.trim(), mode: 'insensitive' as const } },
              { lines: { some: { offerSku: { contains: args.q.trim(), mode: 'insensitive' as const } } } },
            ],
          }
          : {}),
      },
      orderBy: { orderedAt: 'desc' },
      take: Math.min(args.limit ?? 200, 500),
      include: {
        lines: { orderBy: { createdAt: 'asc' } },
        linkedTransaction: { select: { id: true, transactionRef: true, date: true, status: true } },
      },
    });
    return {
      integrationId: integration.id,
      orders: rows.map((o) => ({
        id: o.id,
        orderId: o.orderId,
        commercialId: o.commercialId,
        orderedAt: o.orderedAt,
        state: o.state,
        currency: o.currency,
        taxMode: o.taxMode,
        priceTotal: o.priceTotal,
        shippingPrice: o.shippingPrice,
        totalCommission: o.totalCommission,
        totalPrice: o.totalPrice,
        /** What the local invoice would carry for this order: the price less everything Jinius keeps. */
        netOfCommission: round2(o.priceTotal - o.totalCommission),
        availabilityDeductedAt: o.availabilityDeductedAt,
        linked: o.linkedTransaction
          ? { id: o.linkedTransaction.id, ref: o.linkedTransaction.transactionRef, date: o.linkedTransaction.date, status: o.linkedTransaction.status }
          : null,
        lines: o.lines.map((l) => ({
          id: l.id, sku: l.offerSku, title: l.productTitle, productId: l.productId,
          quantity: l.quantity, price: l.price, unitPrice: l.unitPrice, totalCommission: l.totalCommission,
          netOfCommission: round2(l.price - l.totalCommission), state: l.state,
        })),
      })),
    };
  }


  // ---------------------------------------------------------------- the local invoice

  /** The orders of a selection, with their lines and each product's local VAT rate. */
  private async selection(orderIds: string[], companyIds?: string[]) {
    const orders = await this.prisma.jiniusOrder.findMany({
      where: {
        id: { in: orderIds }, deletedAt: null,
        ...(companyIds ? { integration: { targetCompanyId: { in: companyIds } } } : {}),
      },
      include: { lines: { orderBy: { createdAt: 'asc' } }, linkedTransaction: { select: { id: true, transactionRef: true } } },
      orderBy: { orderedAt: 'asc' },
    });
    if (!orders.length) throw new NotFoundException('No Jinius orders found for that selection.');
    const productIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.productId)).filter(Boolean) as string[])];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, vatClass: { select: { ratePct: true } } } })
      : [];
    const vatByProduct = new Map(products.map((x) => [x.id, x.vatClass ? Number(x.vatClass.ratePct) : null]));
    const lines: JiniusSaleLineIn[] = orders.flatMap((o) =>
      o.lines.map((l) => ({
        orderId: o.orderId,
        orderLineId: l.orderLineId,
        sku: l.offerSku,
        title: l.productTitle,
        productId: l.productId,
        quantity: l.quantity,
        price: l.price,
        totalCommission: l.totalCommission,
        vatPct: l.productId ? vatByProduct.get(l.productId) ?? null : null,
      })),
    );
    const orderedAt = new Map(orders.map((o) => [o.orderId, o.orderedAt]));
    return { orders, lines, orderedAt };
  }

  /**
   * What the local transaction would look like for a selection. Writes nothing.
   *
   * An order already covered by a transaction is refused here rather than at save: invoicing the
   * same sale twice is the whole thing this exists to prevent.
   */
  async previewLocalSale(orderIds: string[], companyIds?: string[]) {
    const { orders, lines, orderedAt } = await this.selection(orderIds, companyIds);
    const already = orders.filter((o) => o.linkedTransactionId);
    const draft = buildLocalSaleDraft(lines, orderedAt);
    return {
      orderCount: orders.length,
      orders: orders.map((o) => ({ id: o.id, orderId: o.orderId, orderedAt: o.orderedAt, state: o.state })),
      ...draft,
      problems: [
        ...already.map((o) => `Order ${o.orderId} is already on transaction ${o.linkedTransaction?.transactionRef ?? '-'}`),
        ...draft.problems,
      ],
      suggestedRef: jiniusSaleRef(draft.date, orders.length),
    };
  }

  /**
   * Create the local sales transaction for a selection, as a DRAFT for somebody to review.
   *
   * The transaction is the sale as far as the reports are concerned; the orders behind it become its
   * trail. Its lines carry the money that actually arrives - the price less everything Jinius keeps -
   * with VAT split out at each product's own rate.
   *
   * Its units are NOT taken off availability again: the Jinius orders did that when they shipped.
   */
  async createLocalSale(
    orderIds: string[],
    args: { salesChannelId: string; date?: string; transactionRef?: string; companyIds?: string[]; actorId?: string },
  ) {
    const preview = await this.previewLocalSale(orderIds, args.companyIds);
    if (preview.problems.length) {
      throw new BadRequestException(`Cannot create the transaction yet - ${preview.problems.join('; ')}.`);
    }
    if (!preview.lines.length) throw new BadRequestException('That selection has nothing to invoice.');

    const channel = await this.prisma.salesChannel.findFirst({
      where: { id: args.salesChannelId, deletedAt: null },
      select: { id: true, kind: true, name: true, companyId: true },
    });
    if (!channel) throw new NotFoundException('Sales channel not found');
    // A marketplace channel would report the sale a second time; the point is a LOCAL invoice.
    if (channel.kind !== 'local') throw new BadRequestException(`${channel.name} is not a local sales channel. Choose the one accounting invoices these sales on.`);

    const date = args.date ? new Date(args.date) : preview.date ?? new Date();
    const created: any = await this.sales.create({
      date: date.toISOString(),
      transactionRef: args.transactionRef?.trim() || preview.suggestedRef,
      salesChannelId: channel.id,
      companyId: channel.companyId ?? undefined,
      items: preview.lines.map((l) => ({
        productId: l.productId,
        sku: l.sku,
        quantity: l.quantity,
        netSalesAmount: l.netSalesAmount,
      })),
    } as any, args.actorId, 'user');

    await this.prisma.$transaction([
      // The units left the shared pool when the orders shipped; submitting this must not take them again.
      this.prisma.salesTransaction.update({ where: { id: created.id }, data: { availabilityHandledElsewhere: true } }),
      this.prisma.jiniusOrder.updateMany({
        where: { id: { in: preview.orders.map((o) => o.id) } },
        data: { linkedTransactionId: created.id, linkedAt: new Date(), linkedById: args.actorId ?? null },
      }),
    ]);
    this.logger.log(`Jinius: local transaction ${created.id} from ${preview.orders.length} order(s), ${preview.grossTotal}`);
    return { ok: true as const, transactionId: created.id, transactionRef: created.transactionRef ?? null, orderCount: preview.orders.length, grossTotal: preview.grossTotal };
  }

  /**
   * Link orders to a transaction somebody already entered - the answer for every sale invoiced
   * before this existed. Same effect as creating one: the orders stop being loose ends.
   */
  async link(orderIds: string[], transactionId: string, args: { companyIds?: string[]; actorId?: string } = {}) {
    const { orders } = await this.selection(orderIds, args.companyIds);
    const tx = await this.prisma.salesTransaction.findFirst({
      where: { id: transactionId, deletedAt: null },
      select: { id: true, transactionRef: true, salesChannel: { select: { kind: true } } },
    });
    if (!tx) throw new NotFoundException('Sales transaction not found');
    if (tx.salesChannel?.kind !== 'local') throw new BadRequestException(`${tx.transactionRef} is not on a local sales channel.`);
    const taken = orders.filter((o) => o.linkedTransactionId && o.linkedTransactionId !== transactionId);
    if (taken.length) throw new BadRequestException(`Already on another transaction: ${taken.map((o) => o.orderId).join(', ')}.`);

    await this.prisma.jiniusOrder.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { linkedTransactionId: tx.id, linkedAt: new Date(), linkedById: args.actorId ?? null },
    });
    return { ok: true as const, linked: orders.length, transactionRef: tx.transactionRef };
  }

  /** Undo a link. The transaction itself is left alone - removing it is a person's decision. */
  async unlink(orderIds: string[], args: { companyIds?: string[]; actorId?: string } = {}) {
    const { orders } = await this.selection(orderIds, args.companyIds);
    await this.prisma.jiniusOrder.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { linkedTransactionId: null, linkedAt: null, linkedById: args.actorId ?? null },
    });
    return { ok: true as const, unlinked: orders.length };
  }
}

const round2 = (v: number) => Number(v.toFixed(2));

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { JINIUS_PATHS, readJiniusTest } from '../integrations/jinius';
import { holdsStock, readJiniusOrders, STATES_WORTH_PULLING, type JiniusOrderRead } from './jinius-orders';
import { buildLocalSaleDraft, jiniusSaleRef, jiniusTransactionLines, type JiniusSaleLineIn } from './jinius-local-sale';
import { SalesTransactionsService } from '../sales-transactions/sales-transactions.service';

/** Mirakl's maximum page size for offset pagination. */
const PAGE = 100;

/**
 * Jinius orders: pulled from Mirakl, recorded as sales transactions, and superseded when accounting
 * invoices them locally.
 *
 * A Jinius sale is an ordinary sale and is reported as one — same revenue, fee and profit arithmetic
 * as Amazon, eBay and OnBuy, and it moves stock the same way. What is special is what happens next:
 * accounting issues a LOCAL invoice covering a batch of these orders, and that invoice is entered
 * here as its own transaction. The same money would then be counted twice, so linking an order to
 * that invoice marks its Jinius transaction as invoiced locally: it stays in Sales Transactions,
 * keeps its trail, and stops counting in revenue and profit.
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
      select: { id: true, name: true, targetCompanyId: true, targetSalesChannelId: true, lastSyncedAt: true },
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

    // Before anything else, undo the holds the first version of this took: the sale is a transaction
    // now, and the transaction moves the stock. Does nothing once there is nothing left to give back.
    const released = await this.releaseLegacyHolds(integration.id, args.actorId);

    const counts = { scanned: 0, created: 0, updated: 0, lines: 0, unmatched: 0, transactions: 0, released, txProblems: [] as string[] };
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
        // The sale itself, reported like any other channel's.
        const tx = await this.recordTransaction(integration, saved.orderRowId, order, args.actorId);
        if (tx.written) counts.transactions += 1;
        if (tx.problem) counts.txProblems.push(tx.problem);
        if (order.orderedAt && (!newest || order.orderedAt > newest)) newest = order.orderedAt;
      }
      const total = Number(json?.total_count ?? 0);
      if (total && offset + PAGE >= total) break;
      if (orders.length < PAGE) break;
    }

    await this.prisma.channelIntegration.update({ where: { id: integration.id }, data: { lastSyncedAt: new Date() } });
    this.logger.log(`Jinius orders: ${counts.scanned} scanned, ${counts.created} new, ${counts.transactions} transaction(s) written, ${counts.unmatched} line(s) matching no product`);
    return { ok: true as const, ...counts, newestOrder: newest };
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
    return { created: !existing, unmatched, orderRowId: row.id };
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
   * Give back what the order-level hold took.
   *
   * The first version of this feature lowered availability from the ORDER, because a Jinius sale was
   * not a transaction. It is one now, and a transaction moves stock like every other channel's — so
   * those holds would be taken twice. This returns them once, writes the ledger line that says so,
   * and is a no-op from then on.
   */
  private async releaseLegacyHolds(integrationId: string, actorId?: string): Promise<number> {
    const held = await this.prisma.jiniusOrderLine.findMany({
      where: { order: { integrationId }, availabilityDeductedQty: { gt: 0 }, productId: { not: null } },
      select: { id: true, productId: true, availabilityDeductedQty: true, order: { select: { id: true, orderId: true } } },
    });
    let returned = 0;
    for (const l of held) {
      const availability = await this.prisma.productAvailability.findUnique({ where: { productId: l.productId! }, select: { quantity: true } });
      if (availability) {
        const next = availability.quantity + l.availabilityDeductedQty;
        await this.prisma.$transaction([
          this.prisma.productAvailability.update({ where: { productId: l.productId! }, data: { quantity: next } }),
          this.prisma.availabilityLedger.create({
            data: {
              productId: l.productId!, delta: l.availabilityDeductedQty, newQuantity: next, reason: 'cancellation',
              refType: 'jinius_order', refId: l.order.id,
              note: `Returned: Jinius order ${l.order.orderId} is reported as a sales transaction, which moves the stock`,
              createdById: actorId ?? null,
            },
          }),
        ]);
        returned += l.availabilityDeductedQty;
      }
      await this.prisma.jiniusOrderLine.update({ where: { id: l.id }, data: { availabilityDeductedQty: 0 } });
    }
    if (held.length) {
      await this.prisma.jiniusOrder.updateMany({ where: { integrationId, availabilityDeductedAt: { not: null } }, data: { availabilityDeductedAt: null } });
      this.logger.log(`Jinius: ${returned} unit(s) returned to availability — the sales transactions hold them now`);
    }
    return returned;
  }

  /**
   * The sales transaction for one Jinius order: created on the first pull, kept in step after that.
   *
   * Every figure comes from Jinius where Jinius states it — the price, the commission it keeps, the
   * tax inside the price — and from the sales channel where it does not. The transaction is a DRAFT,
   * as every channel import is, so a person reviews it before it is final.
   *
   * A transaction already invoiced locally is left alone apart from its money: re-pulling an order
   * must not quietly un-supersede it.
   */
  private async recordTransaction(
    integration: { id: string; targetCompanyId: string | null; targetSalesChannelId: string | null; name: string },
    jiniusOrderId: string,
    order: JiniusOrderRead,
    actorId?: string,
  ): Promise<{ written: boolean; problem?: string }> {
    if (!integration.targetSalesChannelId) {
      return { written: false, problem: `${integration.name} is not linked to a sales channel, so its orders cannot be reported. Link one in Setup → Integrations.` };
    }
    const row = await this.prisma.jiniusOrder.findUnique({
      where: { id: jiniusOrderId },
      select: { id: true, salesTransactionId: true, linkedTransactionId: true, lines: { select: { offerSku: true, productId: true, quantity: true, price: true, shippingPrice: true, totalCommission: true, taxAmount: true } } },
    });
    if (!row || !row.lines.length) return { written: false };

    const channel = await this.prisma.salesChannel.findFirst({
      where: { id: integration.targetSalesChannelId, deletedAt: null },
      select: { id: true, companyId: true, nativeCountryId: true, nativeCurrency: true, nativeCountry: { select: { vatRate: true } } },
    });
    if (!channel) return { written: false, problem: 'The sales channel this Jinius connection points at no longer exists.' };
    const vatPct = channel.nativeCountry?.vatRate != null ? Number(channel.nativeCountry.vatRate) : 0;

    const items = jiniusTransactionLines(
      row.lines.map((l) => ({
        sku: l.offerSku, productId: l.productId, quantity: l.quantity,
        price: l.price, shippingPrice: l.shippingPrice, totalCommission: l.totalCommission, taxAmount: l.taxAmount,
      })),
      vatPct,
    );

    const header = {
      date: order.orderedAt!,
      salesChannelId: channel.id,
      companyId: channel.companyId ?? integration.targetCompanyId,
      destinationCountryId: channel.nativeCountryId,
      currency: order.currency || channel.nativeCurrency || 'EUR',
      // Cyprus sales in euro: no conversion, and the VAT is ours to report.
      exchangeRate: 1,
      feeExchangeRate: 1,
      taxType: 'vat',
      vatCollectedByChannel: false,
      fulfilmentStatus: order.state === 'CANCELED' || order.state === 'REFUSED' ? 'cancelled' : holdsStock(order.state) ? 'shipped' : 'pending',
      resolution: order.state === 'CANCELED' || order.state === 'REFUSED' ? 'cancelled' : 'none',
      source: 'jinius',
      integrationId: integration.id,
      updatedById: actorId ?? null,
    };

    if (row.salesTransactionId) {
      await this.prisma.$transaction([
        this.prisma.salesTransaction.update({ where: { id: row.salesTransactionId }, data: header }),
        this.prisma.salesTransactionItem.deleteMany({ where: { transactionId: row.salesTransactionId } }),
        this.prisma.salesTransactionItem.createMany({ data: items.map((i) => ({ transactionId: row.salesTransactionId!, ...i })) }),
      ]);
      return { written: true };
    }

    const tx = await this.prisma.salesTransaction.create({
      data: {
        ...header,
        transactionRef: order.commercialId || order.orderId,
        createdById: actorId ?? null,
        items: { create: items },
      },
      select: { id: true },
    });
    await this.prisma.jiniusOrder.update({ where: { id: row.id }, data: { salesTransactionId: tx.id } });
    return { written: true };
  }


  /**
   * Take the Jinius transactions of these orders out of the reports, and say why on the row.
   *
   * They stay in Sales Transactions, marked. Removing them would lose the trail from a marketplace
   * order to the money; counting them would report the sale twice, once as a Jinius sale and once on
   * the local invoice that covers it.
   */
  private async setSuperseded(orderIds: string[], ref: string | null) {
    const rows = await this.prisma.jiniusOrder.findMany({
      where: { id: { in: orderIds }, salesTransactionId: { not: null } },
      select: { salesTransactionId: true },
    });
    if (!rows.length) return;
    await this.prisma.salesTransaction.updateMany({
      where: { id: { in: rows.map((r) => r.salesTransactionId!) } },
      data: {
        excludedFromReports: true,
        excludedReason: ref ? `Invoiced locally on ${ref}` : 'Invoiced locally',
      },
    });
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
        salesTransaction: { select: { id: true, transactionRef: true, status: true, excludedFromReports: true } },
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
        /** The sale as the platform reports it, and whether it still counts. */
        transaction: o.salesTransaction
          ? { id: o.salesTransaction.id, ref: o.salesTransaction.transactionRef, status: o.salesTransaction.status, counted: !o.salesTransaction.excludedFromReports }
          : null,
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

  /**
   * The orders a selection names, however it names them.
   *
   * The Sales Transactions page selects TRANSACTIONS — that is where a Jinius sale is seen — so an id
   * may be either an order of ours or the transaction reporting it. Both resolve to the same orders.
   */
  private async selection(orderIds: string[], companyIds?: string[]) {
    const orders = await this.prisma.jiniusOrder.findMany({
      where: {
        OR: [{ id: { in: orderIds } }, { salesTransactionId: { in: orderIds } }], deletedAt: null,
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
      // The goods moved on the Jinius transactions; this invoice is the same goods seen by accounting.
      this.prisma.salesTransaction.update({ where: { id: created.id }, data: { availabilityHandledElsewhere: true } }),
      this.prisma.jiniusOrder.updateMany({
        where: { id: { in: preview.orders.map((o) => o.id) } },
        data: { linkedTransactionId: created.id, linkedAt: new Date(), linkedById: args.actorId ?? null },
      }),
    ]);
    await this.setSuperseded(preview.orders.map((o) => o.id), created.transactionRef ?? null);
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
    await this.setSuperseded(orders.map((o) => o.id), tx.transactionRef);
    return { ok: true as const, linked: orders.length, transactionRef: tx.transactionRef };
  }

  /**
   * Unlinked Jinius sales, for the Jinius Order ID box on a local sale.
   *
   * Each comes back with its lines already priced the way the local invoice prices them — the money
   * that actually arrived, split into a unit net price and the product's VAT rate — so choosing one
   * fills the form with figures that match what creating the invoice here would have produced.
   */
  async unlinkedForPicker(args: { q?: string; limit?: number; companyIds?: string[] }) {
    const orders = await this.prisma.jiniusOrder.findMany({
      where: {
        deletedAt: null, linkedTransactionId: null,
        ...(args.companyIds ? { integration: { targetCompanyId: { in: args.companyIds } } } : {}),
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
      take: Math.min(args.limit ?? 20, 50),
      select: { id: true },
    });
    if (!orders.length) return { orders: [] };

    const { orders: rows, lines, orderedAt } = await this.selection(orders.map((o) => o.id), args.companyIds);
    const draft = buildLocalSaleDraft(lines, orderedAt);
    const byOrder = new Map(rows.map((o) => [o.orderId, o]));
    return {
      orders: rows.map((o) => {
        const mine = draft.lines.filter((l) => l.orderId === o.orderId);
        return {
          id: o.id,
          ref: o.commercialId || o.orderId,
          orderId: o.orderId,
          orderedAt: o.orderedAt,
          state: o.state,
          /** What the local invoice would carry for the whole order. */
          grossTotal: round2(mine.reduce((t, l) => t + l.grossAmount, 0)),
          lines: mine.map((l) => ({
            sku: l.sku,
            productId: l.productId,
            title: l.title,
            quantity: l.quantity,
            /** Per unit and net of VAT, which is what a local line is entered as. */
            unitNetPrice: l.quantity > 0 ? round2(l.netSalesAmount / l.quantity) : l.netSalesAmount,
            vatPct: l.vatPct,
            grossAmount: l.grossAmount,
          })),
          /** Said plainly rather than hidden: a line the invoice cannot carry is a thing to fix first. */
          problems: draft.problems.filter((p) => p.includes(o.orderId)),
        };
      }).filter((o) => byOrder.has(o.orderId)),
    };
  }

  /**
   * Attach orders to a local transaction somebody entered by hand, naming them on its lines.
   *
   * The same effect as linking from the list: the orders are covered, their own Jinius transactions
   * stop counting, and this transaction moves no stock because they already did.
   */
  async attachOrders(orderIds: string[], transactionId: string, actorId?: string) {
    const ids = [...new Set(orderIds.filter(Boolean))];
    if (!ids.length) return { attached: 0 };
    const orders = await this.prisma.jiniusOrder.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, orderId: true, linkedTransactionId: true },
    });
    const taken = orders.filter((o) => o.linkedTransactionId && o.linkedTransactionId !== transactionId);
    if (taken.length) throw new BadRequestException(`Already on another transaction: ${taken.map((o) => o.orderId).join(', ')}.`);

    const tx = await this.prisma.salesTransaction.findFirst({ where: { id: transactionId, deletedAt: null }, select: { transactionRef: true } });
    await this.prisma.$transaction([
      this.prisma.jiniusOrder.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { linkedTransactionId: transactionId, linkedAt: new Date(), linkedById: actorId ?? null },
      }),
      // The Jinius transactions moved the goods; this one records the same sale for accounting.
      this.prisma.salesTransaction.update({ where: { id: transactionId }, data: { availabilityHandledElsewhere: true } }),
    ]);
    await this.setSuperseded(orders.map((o) => o.id), tx?.transactionRef ?? null);
    return { attached: orders.length };
  }

  /**
   * Orders no longer named on a transaction's lines: they are loose again.
   *
   * An edit that drops a Jinius line must give that sale back to the reports, or removing a line
   * would quietly delete revenue.
   */
  async detachOrdersExcept(transactionId: string, keepOrderIds: string[]) {
    const stale = await this.prisma.jiniusOrder.findMany({
      where: { linkedTransactionId: transactionId, id: { notIn: keepOrderIds.length ? keepOrderIds : ['00000000-0000-0000-0000-000000000000'] } },
      select: { id: true, salesTransactionId: true },
    });
    if (!stale.length) return { detached: 0 };
    await this.prisma.$transaction([
      this.prisma.jiniusOrder.updateMany({ where: { id: { in: stale.map((o) => o.id) } }, data: { linkedTransactionId: null, linkedAt: null } }),
      this.prisma.salesTransaction.updateMany({
        where: { id: { in: stale.map((o) => o.salesTransactionId).filter(Boolean) as string[] } },
        data: { excludedFromReports: false, excludedReason: null },
      }),
    ]);
    return { detached: stale.length };
  }

  /** Undo a link. The transaction itself is left alone - removing it is a person's decision. */
  async unlink(orderIds: string[], args: { companyIds?: string[]; actorId?: string } = {}) {
    const { orders } = await this.selection(orderIds, args.companyIds);
    await this.prisma.jiniusOrder.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { linkedTransactionId: null, linkedAt: null, linkedById: args.actorId ?? null },
    });
    // Counted again: nothing invoices these sales now, so the reports must see them.
    await this.prisma.salesTransaction.updateMany({
      where: { id: { in: orders.map((o) => o.salesTransactionId).filter(Boolean) as string[] } },
      data: { excludedFromReports: false, excludedReason: null },
    });
    return { ok: true as const, unlinked: orders.length };
  }
}

const round2 = (v: number) => Number(v.toFixed(2));

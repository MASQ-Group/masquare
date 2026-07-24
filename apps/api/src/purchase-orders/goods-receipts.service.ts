import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../warehouses/stock.service';
import { PostGoodsReceiptDto } from './dto/goods-receipt.dto';
import { CostingService, type AllocatableCost, type AllocationMethod, type CostableLine } from './costing.service';
import { SerialsService } from '../warehouses/serials.service';

export interface GoodsReceiptQuery {
  q?: string;
  /** 'open' = pending incl. backorders (the default working view). */
  status?: string;
  purchaseOrderId?: string;
  vendorId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const ACTIVE = { deletedAt: null };

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly costing: CostingService,
    private readonly serials: SerialsService,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(query: GoodsReceiptQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));

    // 'open' is the one-click preset the receiving desk lives on: everything still
    // awaiting goods, backorders included.
    const statusWhere: Prisma.GoodsReceiptWhereInput =
      !query.status || query.status === 'open'
        ? { status: 'pending' }
        : query.status === 'all'
          ? {}
          : { status: query.status };

    const where: Prisma.GoodsReceiptWhereInput = {
      ...ACTIVE,
      ...statusWhere,
      ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}),
      ...(query.vendorId ? { purchaseOrder: { vendorId: query.vendorId } } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: endOfDay(query.to) } : {}) } }
        : {}),
      ...(query.q?.trim()
        ? {
            OR: [
              { receiptNumber: { contains: query.q.trim(), mode: 'insensitive' } },
              { purchaseOrder: { poNumber: { contains: query.q.trim(), mode: 'insensitive' } } },
              { purchaseOrder: { vendor: { name: { contains: query.q.trim(), mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.goodsReceipt.count({ where }),
      this.prisma.goodsReceipt.findMany({
        where,
        include: {
          purchaseOrder: { select: { id: true, poNumber: true, currency: true, vendor: { select: { id: true, name: true } } } },
          destinationWarehouse: { select: { id: true, name: true } },
          lines: { select: { quantityExpected: true, quantityReceived: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        status: r.status,
        isBackorder: r.isBackorder,
        purchaseOrder: r.purchaseOrder ? { id: r.purchaseOrder.id, poNumber: r.purchaseOrder.poNumber } : null,
        vendor: r.purchaseOrder?.vendor ?? null,
        destinationWarehouse: r.destinationWarehouse,
        createdAt: r.createdAt,
        postedAt: r.postedAt,
        lineCount: r.lines.length,
        expectedQuantity: r.lines.reduce((s, l) => s + l.quantityExpected, 0),
        receivedQuantity: r.lines.reduce((s, l) => s + l.quantityReceived, 0),
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async get(id: string) {
    const r = await this.prisma.goodsReceipt.findFirst({ where: { id, ...ACTIVE }, include: FULL_INCLUDE });
    if (!r) throw new NotFoundException('Goods receipt not found');
    return this.serialize(r);
  }

  /** All receipts raised against a PO — powers the PO detail view (PR10). */
  async forPurchaseOrder(purchaseOrderId: string) {
    const rows = await this.prisma.goodsReceipt.findMany({
      where: { purchaseOrderId, ...ACTIVE },
      include: { lines: { select: { quantityExpected: true, quantityReceived: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      status: r.status,
      isBackorder: r.isBackorder,
      createdAt: r.createdAt,
      postedAt: r.postedAt,
      expectedQuantity: r.lines.reduce((s, l) => s + l.quantityExpected, 0),
      receivedQuantity: r.lines.reduce((s, l) => s + l.quantityReceived, 0),
    }));
  }

  // ---------------------------------------------------------------- writes

  /**
   * Raise the pending receipt that covers everything still outstanding on a PO.
   * Called when a PO is submitted (PR7) and again for each backorder (PR8). Runs on
   * the caller's transaction so it commits with whatever triggered it.
   */
  async createPendingForPo(
    tx: Prisma.TransactionClient,
    purchaseOrderId: string,
    opts: { actorId?: string; isBackorder?: boolean; parentReceiptId?: string } = {},
  ) {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, ...ACTIVE },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    // Only lines with something still to come.
    const outstanding = po.lines
      .map((l) => ({ l, remaining: l.quantityOrdered - l.quantityReceived }))
      .filter((x) => x.remaining > 0);
    if (outstanding.length === 0) return null;

    // Seed this receipt's landed costs with its pro-rata share of the PO figures,
    // by value of the goods it covers. A single-delivery PO therefore carries the
    // whole cost; a split delivery gets a sensible starting split the user can correct
    // against the freight invoice that actually arrives with the shipment.
    const orderedValue = po.lines.reduce((sum, l) => sum + Number(l.unitCost) * l.quantityOrdered, 0);
    const thisValue = outstanding.reduce((sum, x) => sum + Number(x.l.unitCost) * x.remaining, 0);
    const share = orderedValue > 0 ? thisValue / orderedValue : 1;
    const prorate = (v: Prisma.Decimal | null) => (v == null ? null : round2(Number(v) * share));

    const receiptNumber = await nextReceiptNumber(tx);
    return tx.goodsReceipt.create({
      data: {
        receiptNumber,
        purchaseOrderId,
        status: 'pending',
        isBackorder: opts.isBackorder ?? false,
        parentReceiptId: opts.parentReceiptId ?? null,
        destinationWarehouseId: po.destinationWarehouseId,
        // Costs default from the order; allocation methods are snapshotted so editing
        // the PO later never rewrites how a posted receipt was costed.
        shippingCost: prorate(po.shippingCost),
        shippingCurrency: po.shippingCurrency,
        shippingAllocation: po.shippingAllocation,
        customsDuty: prorate(po.customsDuty),
        customsDutyCurrency: po.customsDutyCurrency,
        customsDutyAllocation: po.customsDutyAllocation,
        importHandling: prorate(po.importHandling),
        importHandlingCurrency: po.importHandlingCurrency,
        importHandlingAllocation: po.importHandlingAllocation,
        importVat: prorate(po.importVat),
        importVatCurrency: po.importVatCurrency,
        createdById: opts.actorId ?? null,
        updatedById: opts.actorId ?? null,
        lines: {
          create: outstanding.map((x, i) => ({
            purchaseOrderLineId: x.l.id,
            quantityExpected: x.remaining,
            sortOrder: i,
          })),
        },
      },
    });
  }

  /** Cancel every pending receipt on a PO — used when the PO itself is cancelled. */
  async cancelPendingForPo(tx: Prisma.TransactionClient, purchaseOrderId: string, actorId?: string) {
    await tx.goodsReceipt.updateMany({
      where: { purchaseOrderId, status: 'pending', deletedAt: null },
      data: { status: 'cancelled', updatedById: actorId ?? null },
    });
  }

  /**
   * Post a receipt. Atomic per §3.4: stock increments, the PO's received quantities,
   * the PO status recalculation and any backorder all commit together or not at all.
   */
  async post(id: string, dto: PostGoodsReceiptDto, actorId?: string) {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id, ...ACTIVE },
      include: {
        purchaseOrder: { include: { lines: true } },
        lines: {
          include: {
            purchaseOrderLine: {
              include: {
                product: {
                  select: {
                    id: true, mainSku: true,
                    packageWeightKg: true, productWeightKg: true,
                    packageLengthCm: true, packageWidthCm: true, packageHeightCm: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!receipt) throw new NotFoundException('Goods receipt not found');
    if (receipt.status !== 'pending') throw new BadRequestException(`This receipt is already ${receipt.status}`);
    if (receipt.purchaseOrder.status === 'cancelled') throw new BadRequestException('Its purchase order has been cancelled');
    // A PO unlocked back to draft is being edited — its quantities are in flux.
    if (receipt.purchaseOrder.status === 'draft') throw new BadRequestException('Its purchase order was unlocked for editing — re-submit it first');

    const warehouseId = dto.destinationWarehouseId ?? receipt.destinationWarehouseId ?? receipt.purchaseOrder.destinationWarehouseId;
    if (!warehouseId) throw new BadRequestException('Choose a warehouse to receive the goods into');

    // Match the submitted quantities to this receipt's lines.
    const byLineId = new Map(dto.lines.map((l) => [l.lineId, l.quantityReceived]));
    const unknown = dto.lines.find((l) => !receipt.lines.some((rl) => rl.id === l.lineId));
    if (unknown) throw new BadRequestException('A submitted line does not belong to this receipt');

    // Over-receipt guard: compare against what the PO line still expects.
    const overages: string[] = [];
    for (const rl of receipt.lines) {
      const received = byLineId.get(rl.id) ?? 0;
      const poLine = rl.purchaseOrderLine;
      const outstanding = poLine.quantityOrdered - poLine.quantityReceived;
      if (received > outstanding) {
        overages.push(`${poLine.product?.mainSku ?? 'line'} +${received - outstanding}`);
      }
    }
    if (overages.length && !dto.allowOverReceipt) {
      throw new BadRequestException(
        `Receiving more than ordered (${overages.join(', ')}). Confirm the over-receipt to proceed.`,
      );
    }

    const totalReceived = receipt.lines.reduce((s, rl) => s + (byLineId.get(rl.id) ?? 0), 0);
    if (totalReceived <= 0) throw new BadRequestException('Enter at least one received quantity');

    // --- Landed costing -------------------------------------------------------
    // The rate frozen for this shipment brings goods priced in the vendor's currency
    // into EUR. An unknown rate is refused rather than assumed 1:1, which would value
    // a foreign order at its face number.
    const poCcy = receipt.purchaseOrder.currency ?? 'EUR';
    const fxToEur = poEffectiveRate(receipt.purchaseOrder);
    if (fxToEur == null) {
      throw new BadRequestException(
        `No exchange rate for ${poCcy} on ${receipt.purchaseOrder.poNumber} — set the FX rate or the amount paid on the order before receiving.`,
      );
    }

    const costableLines: CostableLine[] = [];
    const lineIndex: { receiptLineId: string; qty: number }[] = [];
    for (const rl of receipt.lines) {
      const qty = byLineId.get(rl.id) ?? 0;
      if (qty <= 0) continue;
      const prod = rl.purchaseOrderLine.product;
      costableLines.push({
        productId: rl.purchaseOrderLine.productId,
        sku: prod?.mainSku ?? '—',
        quantity: qty,
        lineNetEur: round2(Number(rl.purchaseOrderLine.unitCost) * qty * fxToEur),
        packageWeightKg: prod?.packageWeightKg == null ? null : Number(prod.packageWeightKg),
        productWeightKg: prod?.productWeightKg == null ? null : Number(prod.productWeightKg),
        packageLengthCm: prod?.packageLengthCm == null ? null : Number(prod.packageLengthCm),
        packageWidthCm: prod?.packageWidthCm == null ? null : Number(prod.packageWidthCm),
        packageHeightCm: prod?.packageHeightCm == null ? null : Number(prod.packageHeightCm),
      });
      lineIndex.push({ receiptLineId: rl.id, qty });
    }

    // Amounts the user confirmed on this post win over what the receipt was seeded with.
    const pick = <T,>(a: T | null | undefined, b: T | null | undefined) => (a ?? b) ?? null;
    const toEur = (amount: number | null, currency: string) => {
      if (!amount) return 0;
      if ((currency ?? 'EUR').toUpperCase() === 'EUR') return round2(amount);
      if ((currency ?? '').toUpperCase() === poCcy.toUpperCase()) return round2(amount * fxToEur);
      throw new BadRequestException(
        `${currency} costs cannot be converted on this receipt — enter shipping, duty and handling in EUR or in ${poCcy}.`,
      );
    };

    const num = (v: Prisma.Decimal | number | null) => (v == null ? null : Number(v));
    // Import VAT is deliberately absent: it is recoverable and must never enter cost.
    const ancillary: AllocatableCost[] = [
      {
        label: 'Shipping',
        amountEur: toEur(pick(dto.shippingCost, num(receipt.shippingCost)), dto.shippingCurrency ?? receipt.shippingCurrency),
        method: (dto.shippingAllocation ?? receipt.shippingAllocation) as AllocationMethod,
      },
      {
        label: 'Customs duty',
        amountEur: toEur(pick(dto.customsDuty, num(receipt.customsDuty)), dto.customsDutyCurrency ?? receipt.customsDutyCurrency),
        method: (dto.customsDutyAllocation ?? receipt.customsDutyAllocation) as AllocationMethod,
      },
      {
        label: 'Import handling',
        amountEur: toEur(pick(dto.importHandling, num(receipt.importHandling)), dto.importHandlingCurrency ?? receipt.importHandlingCurrency),
        method: (dto.importHandlingAllocation ?? receipt.importHandlingAllocation) as AllocationMethod,
      },
    ];

    // Serial-tracked lines need one serial per unit. Checked up front with everything
    // else so a receipt is either fully valid or fully rejected.
    const trackedIds = await this.serials.trackedProductIds(receipt.lines.map((rl) => rl.purchaseOrderLineId && rl.purchaseOrderLine.productId));
    const serialsByLine = new Map<string, string[]>();
    const serialProblems: string[] = [];
    for (const rl of receipt.lines) {
      const qty = byLineId.get(rl.id) ?? 0;
      if (qty <= 0) continue;
      const productId = rl.purchaseOrderLine.productId;
      if (!trackedIds.has(productId)) continue;
      const sku = rl.purchaseOrderLine.product?.mainSku ?? 'line';
      const given = (dto.lines.find((l) => l.lineId === rl.id)?.serials ?? []).map((x) => x.trim()).filter(Boolean);
      if (given.length !== qty) {
        serialProblems.push(`${sku}: ${given.length} serial${given.length === 1 ? '' : 's'} for ${qty} unit${qty === 1 ? '' : 's'}`);
      }
      serialsByLine.set(rl.id, given);
    }
    if (serialProblems.length) {
      throw new BadRequestException(
        `Serial-tracked products need one serial per unit — ${serialProblems.join('; ')}.`,
      );
    }

    // Fail before writing anything, so a data gap never leaves a half-costed receipt.
    this.costing.assertCostable(costableLines, ancillary);
    const allocation = this.costing.allocateAll(costableLines, ancillary);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Stock in, one movement per line, referenced to this receipt.
      for (const rl of receipt.lines) {
        const qty = byLineId.get(rl.id) ?? 0;
        if (qty <= 0) continue;
        await this.stock.applyDeltaWithin(tx, {
          productId: rl.purchaseOrderLine.productId,
          warehouseId,
          qtyDelta: qty,
          reason: 'goods_receipt',
          reference: receipt.receiptNumber,
          actorId,
        });

        // 1a. Register the individual units, if this product is tracked that way.
        const lineSerials = serialsByLine.get(rl.id);
        if (lineSerials?.length) {
          await this.serials.receiveWithin(tx, {
            productId: rl.purchaseOrderLine.productId,
            serials: lineSerials,
            warehouseId,
            goodsReceiptId: receipt.id,
            actorId,
          });
        }

        // 1b. Cost it in. Landed unit cost = the goods in EUR plus this line's share of
        //     shipping, duty and handling, so the average reflects what the stock really
        //     cost to get here — not just the invoice price.
        const ci = lineIndex.findIndex((x) => x.receiptLineId === rl.id);
        if (ci >= 0) {
          const cl = costableLines[ci];
          const addOn = allocation.byLine[ci] ?? 0;
          await this.costing.applyMovement(tx, {
            productId: cl.productId,
            qtyDelta: qty,
            unitCostEur: (cl.lineNetEur + addOn) / qty,
            landedAddOnEur: addOn / qty,
            reason: 'goods_receipt',
            refType: 'goods_receipt',
            refId: receipt.id,
            reference: receipt.receiptNumber,
            actorId,
          });
        }
        // 1c. Settle any stock this product owed: units sold before they arrived ship to
        //     those earlier sales now, oldest owed first. Net on-hand therefore rises by
        //     (received − settled).
        await this.settleOwedStock(tx, {
          productId: rl.purchaseOrderLine.productId,
          warehouseId,
          incoming: qty,
          reference: receipt.receiptNumber,
          actorId,
        });

        // 2. Receipt + PO line quantities.
        await tx.goodsReceiptLine.update({ where: { id: rl.id }, data: { quantityReceived: qty } });
        await tx.purchaseOrderLine.update({
          where: { id: rl.purchaseOrderLineId },
          data: { quantityReceived: { increment: qty } },
        });
      }

      // 3. Seal the receipt, recording the landed costs actually invoiced for this
      //    shipment and the FX rate used to bring the goods to EUR. Both are frozen
      //    here so a later change to the PO can never restate what this cost.
      const ccy = (v: string | undefined, fallback: string) => (v ?? fallback).toUpperCase();
      await tx.goodsReceipt.update({
        where: { id },
        data: {
          status: 'posted',
          postedAt: new Date(),
          postedById: actorId ?? null,
          destinationWarehouseId: warehouseId,
          shippingCost: dto.shippingCost ?? receipt.shippingCost,
          shippingCurrency: ccy(dto.shippingCurrency, receipt.shippingCurrency),
          shippingAllocation: dto.shippingAllocation ?? receipt.shippingAllocation,
          customsDuty: dto.customsDuty ?? receipt.customsDuty,
          customsDutyCurrency: ccy(dto.customsDutyCurrency, receipt.customsDutyCurrency),
          customsDutyAllocation: dto.customsDutyAllocation ?? receipt.customsDutyAllocation,
          importHandling: dto.importHandling ?? receipt.importHandling,
          importHandlingCurrency: ccy(dto.importHandlingCurrency, receipt.importHandlingCurrency),
          importHandlingAllocation: dto.importHandlingAllocation ?? receipt.importHandlingAllocation,
          importVat: dto.importVat ?? receipt.importVat,
          importVatCurrency: ccy(dto.importVatCurrency, receipt.importVatCurrency),
          fxRateUsed: poEffectiveRate(receipt.purchaseOrder),
          notes: dto.notes?.trim() || undefined,
          updatedById: actorId ?? null,
        },
      });

      // 4. Recalculate the PO from its now-updated lines.
      const poLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: receipt.purchaseOrderId } });
      const shortfall = poLines.reduce((s, l) => s + Math.max(0, l.quantityOrdered - l.quantityReceived), 0);
      const anyReceived = poLines.some((l) => l.quantityReceived > 0);
      const closingShort = shortfall > 0 && !!dto.closeShort;
      const nextStatus = shortfall === 0 || closingShort ? 'received' : anyReceived ? 'partially_received' : receipt.purchaseOrder.status;

      let backorder: { id: string; receiptNumber: string } | null = null;
      if (shortfall > 0 && !closingShort) {
        // 5. Raise the backorder for what's still owed.
        const created = await this.createPendingForPo(tx, receipt.purchaseOrderId, {
          actorId,
          isBackorder: true,
          parentReceiptId: id,
        });
        if (created) backorder = { id: created.id, receiptNumber: created.receiptNumber };
      }

      if (nextStatus !== receipt.purchaseOrder.status || closingShort) {
        await tx.purchaseOrder.update({
          where: { id: receipt.purchaseOrderId },
          data: {
            status: nextStatus,
            receivedAt: nextStatus === 'received' ? new Date() : undefined,
            updatedById: actorId ?? null,
            statusEvents: {
              create: {
                status: nextStatus,
                note: closingShort
                  ? `Closed short on ${receipt.receiptNumber} — ${shortfall} unit${shortfall === 1 ? '' : 's'} not delivered`
                  : `${receipt.receiptNumber} posted${backorder ? ` — backorder ${backorder.receiptNumber} raised` : ''}`,
                createdById: actorId ?? null,
              },
            },
          },
        });
      }

      return { shortfall, closingShort, backorder, nextStatus };
    });

    const posted = await this.get(id);
    return {
      ...posted,
      overReceipt: overages.length > 0 ? overages : null,
      backorder: result.backorder,
      shortfall: result.shortfall,
      closedShort: result.closingShort,
      purchaseOrderStatus: result.nextStatus,
    };
  }

  /** Cancel a pending receipt (a posted one is immutable). */
  async cancel(id: string, reason?: string | null, actorId?: string) {
    const r = await this.prisma.goodsReceipt.findFirst({ where: { id, ...ACTIVE }, select: { id: true, status: true } });
    if (!r) throw new NotFoundException('Goods receipt not found');
    if (r.status === 'posted') throw new BadRequestException('A posted receipt cannot be cancelled — it has already moved stock');
    if (r.status === 'cancelled') throw new BadRequestException('This receipt is already cancelled');
    await this.prisma.goodsReceipt.update({
      where: { id },
      data: { status: 'cancelled', notes: reason?.trim() || undefined, updatedById: actorId ?? null },
    });
    return this.get(id);
  }

  /**
   * Clear a product's stock-owed debt with just-received units.
   *
   * A row's `quantity` is the units still outstanding. We take units back out of the
   * warehouse they just landed in (they ship to the customer who ordered before they
   * arrived), move the sale's line from owed to deducted so its books balance, and close
   * the row once it reaches zero. Oldest debt is cleared first, and never more than arrived.
   */
  private async settleOwedStock(
    tx: Prisma.TransactionClient,
    a: { productId: string; warehouseId: string; incoming: number; reference: string; actorId?: string },
  ) {
    let remaining = a.incoming;
    if (remaining <= 0) return;

    const owed = await tx.stockOwed.findMany({
      where: { productId: a.productId, status: 'open', deletedAt: null, quantity: { gt: 0 } },
      orderBy: { openedAt: 'asc' },
    });

    for (const row of owed) {
      if (remaining <= 0) break;
      const settle = Math.min(row.quantity, remaining);

      // These units go straight out to the earlier sale.
      await this.stock.applyDeltaWithin(tx, {
        productId: a.productId,
        warehouseId: a.warehouseId,
        qtyDelta: -settle,
        reason: 'sale',
        reference: row.transactionRef ?? a.reference,
        notes: 'Settled stock owed on receipt',
        actorId: a.actorId,
      });

      // Move the sale's line from owed → deducted so deducted + owed still equals its quantity.
      const item = await tx.salesTransactionItem.findFirst({
        where: { transactionId: row.salesTransactionId, productId: a.productId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      if (item) {
        await tx.salesTransactionItem.update({
          where: { id: item.id },
          data: { stockDeductedQty: { increment: settle }, stockWarehouseId: a.warehouseId },
        });
      }

      const clears = row.quantity - settle <= 0;
      await tx.stockOwed.update({
        where: { id: row.id },
        data: clears
          ? { quantity: 0, quantitySettled: { increment: settle }, status: 'settled', settledAt: new Date() }
          : { quantity: { decrement: settle }, quantitySettled: { increment: settle } },
      });
      remaining -= settle;
    }
  }

  // ---------------------------------------------------------------- helpers

  private serialize(r: any) {
    return {
      id: r.id,
      receiptNumber: r.receiptNumber,
      status: r.status,
      isBackorder: r.isBackorder,
      parentReceiptId: r.parentReceiptId,
      notes: r.notes,
      createdAt: r.createdAt,
      postedAt: r.postedAt,
      destinationWarehouse: r.destinationWarehouse ?? null,
      // Landed costs for this shipment — pro-rated defaults until posted, then frozen.
      shippingCost: r.shippingCost == null ? null : Number(r.shippingCost),
      shippingCurrency: r.shippingCurrency ?? 'EUR',
      shippingAllocation: r.shippingAllocation ?? 'weight',
      customsDuty: r.customsDuty == null ? null : Number(r.customsDuty),
      customsDutyCurrency: r.customsDutyCurrency ?? 'EUR',
      customsDutyAllocation: r.customsDutyAllocation ?? 'value',
      importHandling: r.importHandling == null ? null : Number(r.importHandling),
      importHandlingCurrency: r.importHandlingCurrency ?? 'EUR',
      importHandlingAllocation: r.importHandlingAllocation ?? 'value',
      importVat: r.importVat == null ? null : Number(r.importVat),
      importVatCurrency: r.importVatCurrency ?? 'EUR',
      fxRateUsed: r.fxRateUsed == null ? null : Number(r.fxRateUsed),
      purchaseOrder: r.purchaseOrder
        ? {
            id: r.purchaseOrder.id,
            poNumber: r.purchaseOrder.poNumber,
            status: r.purchaseOrder.status,
            currency: r.purchaseOrder.currency,
            expectedDeliveryDate: r.purchaseOrder.expectedDeliveryDate,
            destinationWarehouseId: r.purchaseOrder.destinationWarehouseId,
            vendor: r.purchaseOrder.vendor ? { id: r.purchaseOrder.vendor.id, name: r.purchaseOrder.vendor.name } : null,
          }
        : null,
      lines: (r.lines ?? []).map((l: any) => ({
        id: l.id,
        purchaseOrderLineId: l.purchaseOrderLineId,
        productId: l.purchaseOrderLine?.productId ?? null,
        sku: l.purchaseOrderLine?.product?.mainSku ?? null,
        productName: l.purchaseOrderLine?.product?.title ?? null,
        quantityOrdered: l.purchaseOrderLine?.quantityOrdered ?? 0,
        quantityAlreadyReceived: l.purchaseOrderLine?.quantityReceived ?? 0,
        quantityExpected: l.quantityExpected,
        quantityReceived: l.quantityReceived,
        unitCost: l.purchaseOrderLine ? Number(l.purchaseOrderLine.unitCost) : 0,
      })),
      expectedQuantity: (r.lines ?? []).reduce((s: number, l: any) => s + l.quantityExpected, 0),
      receivedQuantity: (r.lines ?? []).reduce((s: number, l: any) => s + l.quantityReceived, 0),
    };
  }
}

const FULL_INCLUDE = {
  purchaseOrder: { include: { vendor: { select: { id: true, name: true } } } },
  destinationWarehouse: { select: { id: true, name: true } },
  lines: {
    include: { purchaseOrderLine: { include: { product: { select: { id: true, mainSku: true, title: true } } } } },
    orderBy: { sortOrder: 'asc' as const },
  },
} satisfies Prisma.GoodsReceiptInclude;

/** GR-YYYY-NNNNN, year-scoped, derived from the highest existing suffix. */
async function nextReceiptNumber(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = `GR-${new Date().getUTCFullYear()}-`;
  const latest = await tx.goodsReceipt.findFirst({
    where: { receiptNumber: { startsWith: prefix } },
    orderBy: { receiptNumber: 'desc' },
    select: { receiptNumber: true },
  });
  const lastSeq = latest ? Number(latest.receiptNumber.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(5, '0')}`;
}

/**
 * EUR per one unit of the order currency, frozen onto a receipt when it posts.
 *
 * A settled payment is the truth — what we actually paid divided by what we ordered is
 * the rate we really got. Otherwise fall back to the working estimate, which is stored
 * the other way round (order currency per 1 EUR). Null means no rate is known yet.
 */
function poEffectiveRate(po: {
  currency: string;
  fxRate: Prisma.Decimal | null;
  amountPaidEur: Prisma.Decimal | null;
  lines: { unitCost: Prisma.Decimal; quantityOrdered: number }[];
}): number | null {
  if (po.currency === 'EUR') return 1;
  const goodsNet = po.lines.reduce((sum, l) => sum + Number(l.unitCost) * l.quantityOrdered, 0);
  if (po.amountPaidEur != null && goodsNet > 0) return Number((Number(po.amountPaidEur) / goodsNet).toFixed(8));
  const rate = po.fxRate == null ? null : Number(po.fxRate);
  return rate && rate > 0 ? Number((1 / rate).toFixed(8)) : null;
}

/** Money rounding — landed costs are carried to the cent. */
function round2(v: number): number {
  return Number(v.toFixed(2));
}

function endOfDay(iso: string): Date {
  const d = new Date(iso);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

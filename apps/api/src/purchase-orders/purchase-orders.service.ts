import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PdfService } from './pdf/pdf.service';
import { renderPurchaseOrderHtml } from './pdf/purchase-order-template';
import { AmendPurchaseOrderDto, CreatePurchaseOrderDto, PurchaseOrderLineInput, UpdatePurchaseOrderDto } from './dto/purchase-order.dto';

export interface PurchaseOrderQuery {
  q?: string;
  status?: string;
  vendorId?: string;
  companyId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const ACTIVE = { deletedAt: null };

/** Statuses in which a PO's header and lines may still be edited. */
const EDITABLE_STATUSES = ['draft'];

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receipts: GoodsReceiptsService,
    private readonly pdf: PdfService,
  ) {}

  // ---------------------------------------------------------------- reads

  /** The list filter, shared by the paged list and the "select all matching" id query. */
  private buildWhere(query: PurchaseOrderQuery): Prisma.PurchaseOrderWhereInput {
    return {
      ...ACTIVE,
      ...(query.status ? { status: query.status } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: endOfDay(query.to) } : {}) } }
        : {}),
      ...(query.q?.trim()
        ? {
            OR: [
              { poNumber: { contains: query.q.trim(), mode: 'insensitive' } },
              { vendor: { name: { contains: query.q.trim(), mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  /** Every id matching a filter — for "select all matching" across pages. */
  async allIds(query: PurchaseOrderQuery) {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: this.buildWhere(query),
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    return { ids: rows.map((r) => r.id), total: rows.length };
  }

  async list(query: PurchaseOrderQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));

    const where = this.buildWhere(query);

    const [total, rows] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true } },
          company: { select: { id: true, officialName: true } },
          lines: { select: { quantityOrdered: true, quantityReceived: true, unitCost: true, vatAmount: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      rows: rows.map((po) => {
        const totals = lineTotals(po.lines);
        return {
          id: po.id,
          poNumber: po.poNumber,
          status: po.status,
          currency: po.currency,
          vendor: po.vendor,
          company: po.company,
          expectedDeliveryDate: po.expectedDeliveryDate,
          createdAt: po.createdAt,
          submittedAt: po.submittedAt,
          lineCount: po.lines.length,
          totalQuantity: totals.quantity,
          totalReceived: totals.received,
          total: totals.total,
        };
      }),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async get(id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...ACTIVE },
      include: {
        vendor: true,
        company: true,
        destinationWarehouse: { select: { id: true, name: true } },
        lines: {
          include: { product: { select: { id: true, mainSku: true, title: true } }, vatClass: { select: { id: true, name: true } } },
          orderBy: { sortOrder: 'asc' },
        },
        statusEvents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return this.serialize(po);
  }

  // ---------------------------------------------------------------- writes

  /**
   * FX + ancillary cost columns, shared by create and update.
   *
   * An EUR order needs no rate, so any supplied one is dropped rather than stored as
   * a misleading 1.0-ish number. Costs keep their own currency because freight and
   * customs are commonly invoiced in EUR even when the goods are not.
   */
  private costColumns(dto: CreatePurchaseOrderDto, currency: string) {
    const isEur = currency === 'EUR';
    const ccy = (v: string | undefined) => (v ?? 'EUR').toUpperCase();
    return {
      fxRate: isEur ? null : dto.fxRate ?? null,
      amountPaidEur: isEur ? null : dto.amountPaidEur ?? null,
      shippingCost: dto.shippingCost ?? null,
      shippingCurrency: ccy(dto.shippingCurrency),
      shippingAllocation: dto.shippingAllocation ?? 'weight',
      customsDuty: dto.customsDuty ?? null,
      customsDutyCurrency: ccy(dto.customsDutyCurrency),
      customsDutyAllocation: dto.customsDutyAllocation ?? 'value',
      importHandling: dto.importHandling ?? null,
      importHandlingCurrency: ccy(dto.importHandlingCurrency),
      importHandlingAllocation: dto.importHandlingAllocation ?? 'value',
      importVat: dto.importVat ?? null,
      importVatCurrency: ccy(dto.importVatCurrency),
    };
  }

  async create(dto: CreatePurchaseOrderDto, actorId?: string) {
    await this.assertRefs(dto);
    // The vendor's treatment is snapshotted onto the order so editing the vendor
    // later never rewrites historical VAT.
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: dto.vendorId }, select: { vatTreatment: true, currency: true } });
    const vatTreatment = dto.vatTreatment ?? vendor.vatTreatment;
    const vatByProduct = await this.resolveLineVat(dto.lines, vatTreatment);
    // Goods are priced in the vendor's currency unless the caller overrides it.
    const currency = (dto.currency ?? vendor.currency ?? 'EUR').toUpperCase();

    return this.prisma.$transaction(async (tx) => {
      const poNumber = await nextPoNumber(tx);
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          companyId: dto.companyId,
          vendorId: dto.vendorId,
          currency,
          ...this.costColumns(dto, currency),
          expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : null,
          vatTreatment,
          destinationWarehouseId: dto.destinationWarehouseId ?? null,
          notes: dto.notes?.trim() || null,
          status: 'draft',
          createdById: actorId ?? null,
          updatedById: actorId ?? null,
          lines: { create: dto.lines.map((l, i) => lineData(l, i, vatByProduct.get(l.productId)!)) },
          statusEvents: { create: { status: 'draft', note: 'Created', createdById: actorId ?? null } },
        },
        include: this.fullInclude,
      });
      return this.serialize(po);
    });
  }

  /** Full replace of a draft's header + lines. Refused once the PO leaves draft. */
  async update(id: string, dto: UpdatePurchaseOrderDto, actorId?: string) {
    const existing = await this.prisma.purchaseOrder.findFirst({ where: { id, ...ACTIVE }, select: { id: true, status: true } });
    if (!existing) throw new NotFoundException('Purchase order not found');
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(`A ${existing.status.replace('_', ' ')} purchase order cannot be edited`);
    }
    await this.assertRefs(dto);
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: dto.vendorId }, select: { vatTreatment: true, currency: true } });
    const vatTreatment = dto.vatTreatment ?? vendor.vatTreatment;
    const vatByProduct = await this.resolveLineVat(dto.lines, vatTreatment);
    const currency = (dto.currency ?? vendor.currency ?? 'EUR').toUpperCase();

    return this.prisma.$transaction(async (tx) => {
      // Lines are replaced wholesale: nothing is received in draft, so there is no
      // received-quantity to preserve.
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      const po = await tx.purchaseOrder.update({
        where: { id },
        data: {
          companyId: dto.companyId,
          vendorId: dto.vendorId,
          currency,
          ...this.costColumns(dto, currency),
          expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : null,
          vatTreatment,
          destinationWarehouseId: dto.destinationWarehouseId ?? null,
          notes: dto.notes?.trim() || null,
          updatedById: actorId ?? null,
          lines: { create: dto.lines.map((l, i) => lineData(l, i, vatByProduct.get(l.productId)!)) },
        },
        include: this.fullInclude,
      });
      return this.serialize(po);
    });
  }

  /**
   * Draft → submitted. Locks the lines and raises the pending Goods Receipt that
   * covers the whole order (PR7), both in one transaction.
   */
  async submit(id: string, actorId?: string) {
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, ...ACTIVE }, include: { lines: true } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== 'draft') throw new BadRequestException(`Only a draft can be submitted (this one is ${po.status.replace('_', ' ')})`);
    if (po.lines.length === 0) throw new BadRequestException('Add at least one line before submitting');

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'submitted',
          submittedAt: new Date(),
          updatedById: actorId ?? null,
          statusEvents: { create: { status: 'submitted', note: 'Submitted to vendor', createdById: actorId ?? null } },
        },
      });
      await this.receipts.createPendingForPo(tx, id, { actorId });
    });
    return this.get(id);
  }

  /**
   * Submit several POs at once. Each goes through the same single-PO submit (so the pending
   * goods receipt is raised for every one), and anything that can't be submitted — already
   * submitted, empty, cancelled — is skipped with a reason rather than failing the batch.
   */
  async bulkSubmit(ids: string[], actorId?: string) {
    const unique = [...new Set(ids)];
    let submitted = 0;
    const skipped: { id: string; reason: string }[] = [];
    for (const id of unique) {
      try {
        await this.submit(id, actorId);
        submitted++;
      } catch (e: any) {
        skipped.push({ id, reason: e?.message ?? 'Could not submit' });
      }
    }
    return { submitted, skipped, requested: unique.length };
  }

  /** Cancel — allowed only while nothing has been received. */
  async cancel(id: string, reason?: string | null, actorId?: string) {
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, ...ACTIVE }, include: { lines: { select: { quantityReceived: true } } } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'cancelled') throw new BadRequestException('This purchase order is already cancelled');
    if (po.status === 'received') throw new BadRequestException('A fully received purchase order cannot be cancelled');
    const received = po.lines.reduce((s, l) => s + l.quantityReceived, 0);
    if (received > 0) throw new BadRequestException(`Cannot cancel — ${received} unit${received === 1 ? '' : 's'} already received against this PO`);

    // Cancelling the order also voids the goods receipt still waiting on it.
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          updatedById: actorId ?? null,
          statusEvents: { create: { status: 'cancelled', note: reason?.trim() || 'Cancelled', createdById: actorId ?? null } },
        },
      });
      await this.receipts.cancelPendingForPo(tx, id, actorId);
    });
    return this.get(id);
  }

  // --- Unlock: reopen a submitted PO for editing -------------------------------
  //
  // Admins unlock directly; everyone else raises a request an admin decides on.
  // Only a `submitted` PO is unlockable — once anything is received, stock has
  // moved and the order must be corrected through receiving, not by editing.

  /** Shared guard so the direct and approve-a-request paths can't diverge. */
  private async assertUnlockable(id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...ACTIVE },
      include: { lines: { select: { quantityReceived: true } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'draft') throw new BadRequestException('This purchase order is already a draft');
    if (po.status !== 'submitted') {
      throw new BadRequestException(`A ${po.status.replace('_', ' ')} purchase order cannot be unlocked`);
    }
    const received = po.lines.reduce((sum, l) => sum + l.quantityReceived, 0);
    if (received > 0) throw new BadRequestException(`Cannot unlock — ${received} unit${received === 1 ? '' : 's'} already received`);
    return po;
  }

  /** Reopen a submitted PO. `note` is recorded in the status history. */
  async unlock(id: string, actorId: string, note?: string | null) {
    await this.assertUnlockable(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'draft',
          submittedAt: null,
          updatedById: actorId,
          statusEvents: { create: { status: 'draft', note: note?.trim() || 'Unlocked for editing', createdById: actorId } },
        },
      });
      // The pending receipt raised at submit must be voided, or it would stay
      // postable against an order that is being edited. Re-submitting mints a new one.
      await this.receipts.cancelPendingForPo(tx, id, actorId);
      // Any other request still open for this PO is moot now.
      await tx.purchaseOrderUnlockRequest.updateMany({
        where: { purchaseOrderId: id, status: 'pending' },
        data: { status: 'granted', decidedById: actorId, decidedAt: new Date() },
      });
    });
    return this.get(id);
  }

  /**
   * Amend an order that has already been (partly) received. Admin-only.
   *
   * Posted receipts are never rewritten, so this only moves the *ordered* quantities and
   * adds lines. What that buys, per case:
   *  - ordering more: the outstanding balance grows and a fresh receipt covers the delta;
   *  - ordering less: allowed down to what has already arrived, no further;
   *  - new items: a new line, picked up by the same fresh receipt;
   *  - fewer than already arrived: refused — those goods physically exist, so they leave
   *    through a return to the vendor, not by editing the order that brought them in.
   */
  async amend(id: string, dto: AmendPurchaseOrderDto, actorId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...ACTIVE },
      include: { lines: { include: { product: { select: { mainSku: true } } }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'cancelled') throw new BadRequestException('A cancelled purchase order cannot be amended');
    if (po.status === 'draft') throw new BadRequestException('This order is a draft — edit it directly');

    const existing = new Map(po.lines.map((l) => [l.id, l]));
    const keptIds = new Set(dto.lines.filter((l) => l.purchaseOrderLineId).map((l) => l.purchaseOrderLineId!));

    // Refuse the whole amendment before touching anything, listing every problem at once.
    const belowReceived: string[] = [];
    const droppedWithStock: string[] = [];
    for (const line of dto.lines) {
      if (!line.purchaseOrderLineId) continue;
      const cur = existing.get(line.purchaseOrderLineId);
      if (!cur) throw new BadRequestException('A line on this amendment no longer exists on the order');
      if (line.quantityOrdered < cur.quantityReceived) {
        belowReceived.push(`${cur.product?.mainSku ?? 'line'} (received ${cur.quantityReceived}, asked for ${line.quantityOrdered})`);
      }
    }
    for (const l of po.lines) {
      if (!keptIds.has(l.id) && l.quantityReceived > 0) {
        droppedWithStock.push(`${l.product?.mainSku ?? 'line'} (${l.quantityReceived} received)`);
      }
    }
    if (belowReceived.length) {
      throw new BadRequestException(
        `Cannot order fewer than already received: ${belowReceived.join(', ')}. Raise a return to the vendor for the surplus instead.`,
      );
    }
    if (droppedWithStock.length) {
      throw new BadRequestException(
        `Cannot remove a line that has been received: ${droppedWithStock.join(', ')}. Return the goods to the vendor first.`,
      );
    }

    const vatTreatment = po.vatTreatment ?? 'standard';
    const newLines = dto.lines.filter((l) => !l.purchaseOrderLineId);
    const vatByProduct = newLines.length
      ? await this.resolveLineVat(newLines.map((l) => ({ productId: l.productId, quantityOrdered: l.quantityOrdered, unitCost: l.unitCost })), vatTreatment)
      : new Map();

    await this.prisma.$transaction(async (tx) => {
      // Lines the amendment leaves out and which never received anything can go.
      const removable = po.lines.filter((l) => !keptIds.has(l.id) && l.quantityReceived === 0).map((l) => l.id);
      if (removable.length) await tx.purchaseOrderLine.deleteMany({ where: { id: { in: removable } } });

      for (const line of dto.lines) {
        if (line.purchaseOrderLineId) {
          const cur = existing.get(line.purchaseOrderLineId)!;
          const net = line.unitCost * line.quantityOrdered;
          await tx.purchaseOrderLine.update({
            where: { id: line.purchaseOrderLineId },
            data: {
              quantityOrdered: line.quantityOrdered,
              unitCost: new Prisma.Decimal(line.unitCost),
              vatAmount: new Prisma.Decimal(round(net * (Number(cur.vatRatePct ?? 0) / 100), 2)),
              notes: line.notes?.trim() || null,
            },
          });
        } else {
          const vat = vatByProduct.get(line.productId) ?? { vatClassId: null, ratePct: 0 };
          const net = line.unitCost * line.quantityOrdered;
          await tx.purchaseOrderLine.create({
            data: {
              purchaseOrderId: id,
              productId: line.productId,
              quantityOrdered: line.quantityOrdered,
              unitCost: new Prisma.Decimal(line.unitCost),
              ...(vat.vatClassId ? { vatClassId: vat.vatClassId } : {}),
              vatRatePct: vat.ratePct,
              vatAmount: new Prisma.Decimal(round(net * (vat.ratePct / 100), 2)),
              notes: line.notes?.trim() || null,
              sortOrder: po.lines.length + dto.lines.indexOf(line),
            },
          });
        }
      }

      // Restate the status from the amended lines and record why it moved.
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
      const outstanding = lines.reduce((s, l) => s + Math.max(0, l.quantityOrdered - l.quantityReceived), 0);
      const anyReceived = lines.some((l) => l.quantityReceived > 0);
      const next = outstanding === 0 ? 'received' : anyReceived ? 'partially_received' : 'submitted';

      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: next,
          receivedAt: next === 'received' ? po.receivedAt ?? new Date() : null,
          updatedById: actorId,
          statusEvents: {
            create: { status: next, note: dto.note?.trim() || 'Amended by admin', createdById: actorId },
          },
        },
      });

      // Anything newly outstanding needs a receipt to arrive against. cancelPending first
      // so a stale pending receipt cannot coexist with a fresh one for the same goods.
      if (outstanding > 0) {
        await this.receipts.cancelPendingForPo(tx, id, actorId);
        await this.receipts.createPendingForPo(tx, id, { actorId });
      }
    });

    return this.get(id);
  }

  /** Non-admin path: ask an admin to unlock. Deduped per PO. */
  async requestUnlock(id: string, userId: string, reason?: string | null) {
    await this.assertUnlockable(id);
    const existing = await this.prisma.purchaseOrderUnlockRequest.findFirst({
      where: { purchaseOrderId: id, status: 'pending' },
    });
    if (existing) return { ok: true, alreadyRequested: true };
    await this.prisma.purchaseOrderUnlockRequest.create({
      data: { purchaseOrderId: id, requestedById: userId, reason: reason?.trim() || null },
    });
    return { ok: true, alreadyRequested: false };
  }

  /** Pending requests for the admin queue. */
  async listUnlockRequests() {
    const reqs = await this.prisma.purchaseOrderUnlockRequest.findMany({
      where: { status: 'pending' },
      include: { purchaseOrder: { select: { id: true, poNumber: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const userIds = [...new Set(reqs.map((r) => r.requestedById).filter(Boolean) as string[])];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
      : [];
    const byId = new Map(users.map((u) => [u.id, u.fullName]));
    return reqs.map((r) => ({
      id: r.id,
      purchaseOrderId: r.purchaseOrderId,
      poNumber: r.purchaseOrder.poNumber,
      status: r.purchaseOrder.status,
      reason: r.reason,
      requestedBy: r.requestedById ? byId.get(r.requestedById) ?? '—' : '—',
      createdAt: r.createdAt,
    }));
  }

  /** Admin decision. Granting performs the unlock itself. */
  async decideUnlock(requestId: string, grant: boolean, adminId: string, note?: string | null) {
    const req = await this.prisma.purchaseOrderUnlockRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Unlock request not found');
    if (req.status !== 'pending') throw new BadRequestException('This request has already been decided');

    if (!grant) {
      await this.prisma.purchaseOrderUnlockRequest.update({
        where: { id: requestId },
        data: { status: 'denied', decidedById: adminId, decidedAt: new Date(), decisionNote: note?.trim() || null },
      });
      return { ok: true, granted: false };
    }
    // unlock() closes the pending request as part of its transaction.
    await this.unlock(req.purchaseOrderId, adminId, note?.trim() || 'Unlocked — request approved');
    return { ok: true, granted: true };
  }

  /**
   * Build the branded PDF for a purchase order. All presentation lives in
   * purchase-order-template.ts — this only gathers the data it needs.
   */
  async renderPdf(id: string): Promise<{ filename: string; pdf: Buffer }> {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...ACTIVE },
      include: {
        vendor: true,
        company: { include: { vatRegistrations: { where: { deletedAt: null }, select: { vatNumber: true } } } },
        destinationWarehouse: { select: { name: true } },
        lines: { include: { product: { select: { mainSku: true, title: true } }, vatClass: { select: { name: true } } }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    const html = renderPurchaseOrderHtml({
      poNumber: po.poNumber,
      status: po.status,
      currency: po.currency,
      createdAt: po.createdAt,
      submittedAt: po.submittedAt,
      expectedDeliveryDate: po.expectedDeliveryDate,
      deliverToName: po.destinationWarehouse?.name ?? null,
      notes: po.notes,
      vatTreatment: po.vatTreatment,
      company: {
        officialName: po.company.officialName,
        registrationNumber: po.company.registrationNumber,
        vatNumbers: po.company.vatRegistrations.map((v) => v.vatNumber),
        addressLine1: po.company.addressLine1,
        addressLine2: po.company.addressLine2,
        addressCity: po.company.addressCity,
        addressPostalCode: po.company.addressPostalCode,
        addressCountry: po.company.addressCountry,
        email: po.company.email,
        phone: po.company.phoneLandline ?? po.company.phoneMobile,
      },
      vendor: {
        name: po.vendor.name,
        vatNumber: po.vendor.vatNumber,
        addressLine1: po.vendor.addressLine1,
        addressCity: po.vendor.addressCity,
        addressCountry: po.vendor.addressCountry,
        email: po.vendor.email,
        phone: po.vendor.phone,
      },
      lines: po.lines.map((l) => ({
        sku: l.product?.mainSku ?? '—',
        productName: l.product?.title ?? '',
        quantityOrdered: l.quantityOrdered,
        unitCost: Number(l.unitCost),
        vatRatePct: l.vatRatePct ?? 0,
        vatAmount: Number(l.vatAmount ?? 0),
      })),
    });

    return { filename: `${po.poNumber}.pdf`, pdf: await this.pdf.htmlToPdf(html) };
  }

  /** Soft-delete a draft. Submitted or received POs are kept for the audit trail. */
  async remove(id: string, actorId?: string) {
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, ...ACTIVE }, select: { id: true, status: true } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== 'draft') throw new BadRequestException('Only a draft can be deleted; cancel the purchase order instead');
    await this.prisma.purchaseOrder.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId ?? null } });
    return { deleted: true };
  }

  // ---------------------------------------------------------------- helpers

  private readonly fullInclude = {
    vendor: true,
    company: true,
    destinationWarehouse: { select: { id: true, name: true } },
    lines: { include: { product: { select: { id: true, mainSku: true, title: true } }, vatClass: { select: { id: true, name: true } } }, orderBy: { sortOrder: 'asc' as const } },
    statusEvents: { orderBy: { createdAt: 'asc' as const } },
  } satisfies Prisma.PurchaseOrderInclude;

  /**
   * Resolve each line's VAT. A 'standard' order charges the product's own VAT class
   * rate; reverse-charge (EU B2B) and outside-scope (non-EU) orders are 0% but still
   * store a snapshot so the document and totals are explicit rather than absent.
   */
  private async resolveLineVat(lines: PurchaseOrderLineInput[], vatTreatment: string) {
    const chargesVat = vatTreatment === 'standard';
    if (!chargesVat) {
      return new Map(lines.map((l) => [l.productId, { vatClassId: null as string | null, ratePct: 0 }]));
    }
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, mainSku: true, vatClass: { select: { id: true, ratePct: true } } },
    });
    const out = new Map<string, { vatClassId: string | null; ratePct: number }>();
    for (const p of products) {
      // No class means we cannot know the rate — refuse rather than silently charging 0%.
      if (!p.vatClass) {
        throw new BadRequestException(`${p.mainSku} has no VAT class. Set one on the product, or mark the vendor as reverse charge / outside scope.`);
      }
      out.set(p.id, { vatClassId: p.vatClass.id, ratePct: Number(p.vatClass.ratePct) });
    }
    return out;
  }

  private async assertRefs(dto: CreatePurchaseOrderDto) {
    const [company, vendor] = await Promise.all([
      this.prisma.company.findFirst({ where: { id: dto.companyId, deletedAt: null }, select: { id: true } }),
      this.prisma.vendor.findFirst({ where: { id: dto.vendorId, deletedAt: null }, select: { id: true } }),
    ]);
    if (!company) throw new NotFoundException('Issuing company not found');
    if (!vendor) throw new NotFoundException('Vendor not found');

    if (dto.destinationWarehouseId) {
      const wh = await this.prisma.warehouse.findFirst({ where: { id: dto.destinationWarehouseId, deletedAt: null, isActive: true }, select: { id: true } });
      if (!wh) throw new BadRequestException('Destination warehouse not found or inactive');
    }

    const productIds = [...new Set(dto.lines.map((l) => l.productId))];
    const found = await this.prisma.product.count({ where: { id: { in: productIds }, deletedAt: null } });
    if (found !== productIds.length) throw new BadRequestException('One or more line products no longer exist');
  }

  private serialize(po: any) {
    const lines = (po.lines ?? []).map((l: any) => ({
      id: l.id,
      productId: l.productId,
      sku: l.product?.mainSku ?? null,
      productName: l.product?.title ?? null,
      quantityOrdered: l.quantityOrdered,
      quantityReceived: l.quantityReceived,
      unitCost: Number(l.unitCost),
      lineTotal: Number(l.unitCost) * l.quantityOrdered,
      vatClassId: l.vatClassId ?? null,
      vatClassName: l.vatClass?.name ?? null,
      vatRatePct: l.vatRatePct ?? 0,
      vatAmount: Number(l.vatAmount ?? 0),
      notes: l.notes,
    }));
    const totals = lineTotals(po.lines ?? []);
    return {
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      currency: po.currency,
      company: po.company
        ? {
            id: po.company.id,
            officialName: po.company.officialName,
            registrationNumber: po.company.registrationNumber ?? null,
            addressLine1: po.company.addressLine1 ?? null,
            addressLine2: po.company.addressLine2 ?? null,
            addressCity: po.company.addressCity ?? null,
            addressPostalCode: po.company.addressPostalCode ?? null,
            addressCountry: po.company.addressCountry ?? null,
          }
        : null,
      vendor: po.vendor
        ? {
            id: po.vendor.id,
            name: po.vendor.name,
            vatNumber: po.vendor.vatNumber ?? null,
            email: po.vendor.email ?? null,
            phone: po.vendor.phone ?? null,
            addressCity: po.vendor.addressCity ?? null,
            addressCountry: po.vendor.addressCountry ?? null,
          }
        : null,
      destinationWarehouse: po.destinationWarehouse ?? null,
      expectedDeliveryDate: po.expectedDeliveryDate,
      vatTreatment: po.vatTreatment ?? 'standard',
      fxRate: po.fxRate == null ? null : Number(po.fxRate),
      amountPaidEur: po.amountPaidEur == null ? null : Number(po.amountPaidEur),
      // The rate costing will actually use: the settled one when the payment is known,
      // otherwise the working estimate. Null means "no rate yet" for a non-EUR order.
      effectiveFxRate: effectiveRate(po.currency, po.fxRate, po.amountPaidEur, totals.net),
      shippingCost: po.shippingCost == null ? null : Number(po.shippingCost),
      shippingCurrency: po.shippingCurrency ?? 'EUR',
      shippingAllocation: po.shippingAllocation ?? 'weight',
      customsDuty: po.customsDuty == null ? null : Number(po.customsDuty),
      customsDutyCurrency: po.customsDutyCurrency ?? 'EUR',
      customsDutyAllocation: po.customsDutyAllocation ?? 'value',
      importHandling: po.importHandling == null ? null : Number(po.importHandling),
      importHandlingCurrency: po.importHandlingCurrency ?? 'EUR',
      importHandlingAllocation: po.importHandlingAllocation ?? 'value',
      importVat: po.importVat == null ? null : Number(po.importVat),
      importVatCurrency: po.importVatCurrency ?? 'EUR',
      notes: po.notes,
      submittedAt: po.submittedAt,
      cancelledAt: po.cancelledAt,
      receivedAt: po.receivedAt,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
      lines,
      totalQuantity: totals.quantity,
      totalReceived: totals.received,
      total: totals.total,
      totalNet: totals.net,
      totalVat: totals.vat,
      totalGross: totals.gross,
      statusHistory: (po.statusEvents ?? []).map((e: any) => ({ status: e.status, note: e.note, at: e.createdAt })),
    };
  }
}

function lineData(
  l: PurchaseOrderLineInput,
  i: number,
  vat: { vatClassId: string | null; ratePct: number },
): Prisma.PurchaseOrderLineCreateWithoutPurchaseOrderInput {
  const net = l.unitCost * l.quantityOrdered;
  return {
    product: { connect: { id: l.productId } },
    quantityOrdered: l.quantityOrdered,
    unitCost: new Prisma.Decimal(l.unitCost),
    ...(vat.vatClassId ? { vatClass: { connect: { id: vat.vatClassId } } } : {}),
    vatRatePct: vat.ratePct,
    vatAmount: new Prisma.Decimal(round(net * (vat.ratePct / 100), 2)),
    notes: l.notes?.trim() || null,
    sortOrder: i,
  };
}

const round = (v: number, dp: number) => Number(v.toFixed(dp));

/**
 * Rate to convert one unit of the order currency into EUR.
 *
 * A settled payment is the truth — dividing what we actually paid by what we ordered
 * gives the rate we really got, fees and all. Falling back to the working estimate,
 * which is stored the other way round (order currency per 1 EUR), hence the inverse.
 */
function effectiveRate(
  currency: string,
  fxRate: Prisma.Decimal | null,
  amountPaidEur: Prisma.Decimal | null,
  goodsNet: number,
): number | null {
  if (currency === 'EUR') return 1;
  if (amountPaidEur != null && goodsNet > 0) return round(Number(amountPaidEur) / goodsNet, 8);
  const rate = fxRate == null ? null : Number(fxRate);
  return rate && rate > 0 ? round(1 / rate, 8) : null;
}

function lineTotals(
  lines: { quantityOrdered: number; quantityReceived: number; unitCost: Prisma.Decimal | number; vatAmount?: Prisma.Decimal | number }[],
) {
  let quantity = 0;
  let received = 0;
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    quantity += l.quantityOrdered;
    received += l.quantityReceived;
    net += Number(l.unitCost) * l.quantityOrdered;
    vat += Number(l.vatAmount ?? 0);
  }
  const netR = round(net, 2);
  const vatR = round(vat, 2);
  // `total` stays the NET total so existing list columns keep their meaning; the
  // VAT-inclusive figure is exposed separately as `gross`.
  return { quantity, received, total: netR, net: netR, vat: vatR, gross: round(netR + vatR, 2) };
}

/**
 * Next PO number for the current year: PO-YYYY-NNNNN, zero-padded to 5.
 * Derived from the highest existing suffix for the year (robust to gaps from
 * deletions; soft-deleted rows keep their number reserved via the unique index).
 * Must run inside the same transaction as the insert.
 */
async function nextPoNumber(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = `PO-${new Date().getUTCFullYear()}-`;
  const latest = await tx.purchaseOrder.findFirst({
    where: { poNumber: { startsWith: prefix } },
    orderBy: { poNumber: 'desc' },
    select: { poNumber: true },
  });
  const lastSeq = latest ? Number(latest.poNumber.slice(prefix.length)) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

function endOfDay(iso: string): Date {
  const d = new Date(iso);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

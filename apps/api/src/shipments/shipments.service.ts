import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto, UpdateShipmentDto } from './dto/shipment.dto';

export interface ShipmentQuery {
  q?: string;
  companyId?: string;
  salesChannelId?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}

const txContext = {
  select: {
    id: true, transactionRef: true, date: true, fulfilmentStatus: true,
    salesChannel: { select: { id: true, name: true } },
    company: { select: { id: true, officialName: true } },
    destinationCountry: { select: { id: true, name: true } },
  },
} satisfies Prisma.SalesTransactionDefaultArgs;

const include = {
  transaction: txContext,
  shippingService: { select: { id: true, name: true } },
} satisfies Prisma.ShipmentInclude;

@Injectable()
export class ShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(s: any) {
    return {
      id: s.id,
      transactionId: s.transactionId,
      transactionRef: s.transaction?.transactionRef ?? null,
      transactionDate: s.transaction?.date ?? null,
      salesChannel: s.transaction?.salesChannel ?? null,
      company: s.transaction?.company ?? null,
      destinationCountry: s.transaction?.destinationCountry ?? null,
      fulfilmentStatus: s.transaction?.fulfilmentStatus ?? null,
      type: s.type,
      shipmentDate: s.shipmentDate,
      shippingServiceId: s.shippingServiceId,
      shippingService: s.shippingService ?? null,
      trackingNumber: s.trackingNumber,
      shippingCostEur: s.shippingCostEur,
      costBorneBy: s.costBorneBy,
      dutyImportEur: s.dutyImportEur,
      comments: s.comments,
      createdAt: s.createdAt,
    };
  }

  /** Recorded shipments log (across all transactions). */
  async list(query: ShipmentQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const where: Prisma.ShipmentWhereInput = {
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.q || query.companyId || query.salesChannelId
        ? {
            transaction: {
              deletedAt: null,
              ...(query.companyId ? { companyId: query.companyId } : {}),
              ...(query.salesChannelId ? { salesChannelId: query.salesChannelId } : {}),
              ...(query.q
                ? {
                    OR: [
                      { transactionRef: { contains: query.q, mode: 'insensitive' } },
                      { items: { some: { deletedAt: null, sku: { contains: query.q, mode: 'insensitive' } } } },
                    ],
                  }
                : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.shipment.count({ where }),
      this.prisma.shipment.findMany({ where, include, orderBy: { shipmentDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items: rows.map((r) => this.serialize(r)), total, page, pageSize };
  }

  /** Fulfilment worklist: transactions still awaiting an outbound shipment. */
  async pending(query: ShipmentQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const where: Prisma.SalesTransactionWhereInput = {
      deletedAt: null,
      // Pending = no outbound shipment registered in the platform (the single point of
      // truth for "shipped"). Cancelled orders don't need fulfilment.
      shipments: { none: { deletedAt: null, type: 'outbound' } },
      resolution: { not: 'cancelled' },
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.salesChannelId ? { salesChannelId: query.salesChannelId } : {}),
      ...(query.q
        ? {
            OR: [
              { transactionRef: { contains: query.q, mode: 'insensitive' } },
              { items: { some: { deletedAt: null, sku: { contains: query.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesTransaction.count({ where }),
      this.prisma.salesTransaction.findMany({
        where,
        orderBy: { date: 'asc' }, // oldest first — longest outstanding at the top
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, transactionRef: true, date: true, shippingServiceId: true,
          salesChannel: { select: { id: true, name: true } },
          company: { select: { id: true, officialName: true } },
          destinationCountry: { select: { id: true, name: true } },
          shippingService: { select: { id: true, name: true } },
          items: { where: { deletedAt: null }, select: { sku: true, quantity: true } },
          shipments: { where: { deletedAt: null }, select: { id: true, type: true } },
        },
      }),
    ]);
    const items = rows.map((t) => ({
      id: t.id,
      transactionRef: t.transactionRef,
      date: t.date,
      salesChannel: t.salesChannel,
      company: t.company,
      destinationCountry: t.destinationCountry,
      defaultShippingService: t.shippingService,
      skus: t.items.map((i) => i.sku),
      itemCount: t.items.length,
      quantity: t.items.reduce((s, i) => s + (i.quantity ?? 0), 0),
      shipmentCount: t.shipments.length,
    }));
    return { items, total, page, pageSize };
  }

  /** All shipments recorded against one transaction (for the summary/edit views). */
  async forTransaction(transactionId: string) {
    const rows = await this.prisma.shipment.findMany({
      where: { transactionId, deletedAt: null }, include, orderBy: { shipmentDate: 'asc' },
    });
    return rows.map((r) => this.serialize(r));
  }

  async create(dto: CreateShipmentDto, actorId?: string) {
    const tx = await this.prisma.salesTransaction.findFirst({ where: { id: dto.transactionId, deletedAt: null }, select: { id: true } });
    if (!tx) throw new NotFoundException('Sales transaction not found');
    const s = await this.prisma.shipment.create({
      data: {
        transactionId: dto.transactionId,
        type: dto.type ?? 'outbound',
        shipmentDate: new Date(dto.shipmentDate),
        shippingServiceId: dto.shippingServiceId ?? null,
        trackingNumber: dto.trackingNumber ?? null,
        shippingCostEur: dto.shippingCostEur ?? null,
        costBorneBy: dto.costBorneBy ?? 'company',
        dutyImportEur: dto.dutyImportEur ?? null,
        comments: dto.comments ?? null,
        createdById: actorId,
      },
    });
    // Mark the transaction shipped unless the operator says more shipments are coming.
    if ((dto.type ?? 'outbound') === 'outbound' && dto.markShipped !== false) {
      await this.prisma.salesTransaction.update({ where: { id: dto.transactionId }, data: { fulfilmentStatus: 'shipped' } });
    }
    return this.get(s.id);
  }

  async update(id: string, dto: UpdateShipmentDto) {
    const existing = await this.prisma.shipment.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Shipment not found');
    await this.prisma.shipment.update({
      where: { id },
      data: {
        type: dto.type,
        shipmentDate: dto.shipmentDate ? new Date(dto.shipmentDate) : undefined,
        shippingServiceId: dto.shippingServiceId,
        trackingNumber: dto.trackingNumber,
        shippingCostEur: dto.shippingCostEur,
        costBorneBy: dto.costBorneBy,
        dutyImportEur: dto.dutyImportEur,
        comments: dto.comments,
      },
    });
    return this.get(id);
  }

  async get(id: string) {
    const s = await this.prisma.shipment.findFirst({ where: { id, deletedAt: null }, include });
    if (!s) throw new NotFoundException('Shipment not found');
    return this.serialize(s);
  }

  async remove(id: string) {
    const existing = await this.prisma.shipment.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Shipment not found');
    await this.prisma.shipment.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  async setFulfilment(transactionId: string, status: 'pending' | 'shipped' | 'cancelled') {
    const tx = await this.prisma.salesTransaction.findFirst({ where: { id: transactionId, deletedAt: null }, select: { id: true } });
    if (!tx) throw new NotFoundException('Sales transaction not found');
    await this.prisma.salesTransaction.update({ where: { id: transactionId }, data: { fulfilmentStatus: status } });
    return { ok: true, status };
  }

  // --- Export / import -----------------------------------------------------
  private txScopeWhere(query: ShipmentQuery): Prisma.SalesTransactionWhereInput {
    return {
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.salesChannelId ? { salesChannelId: query.salesChannelId } : {}),
      ...(query.q
        ? { OR: [
            { transactionRef: { contains: query.q, mode: 'insensitive' } },
            { items: { some: { deletedAt: null, sku: { contains: query.q, mode: 'insensitive' } } } },
          ] }
        : {}),
    };
  }

  /** Rows for the xlsx export. scope='recorded' → the shipments log; scope='pending' →
   *  a fill-in template of transactions awaiting an outbound shipment. */
  async exportRows(query: ShipmentQuery, scope: 'recorded' | 'pending') {
    const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '');
    if (scope === 'pending') {
      const rows = await this.prisma.salesTransaction.findMany({
        where: {
          deletedAt: null,
          shipments: { none: { deletedAt: null, type: 'outbound' } },
          resolution: { not: 'cancelled' },
          ...this.txScopeWhere(query),
        },
        orderBy: { date: 'asc' },
        select: {
          transactionRef: true,
          salesChannel: { select: { name: true } },
          destinationCountry: { select: { name: true } },
          shippingService: { select: { name: true } },
          items: { where: { deletedAt: null }, select: { sku: true } },
        },
      });
      return rows.map((t) => ({
        transactionRef: t.transactionRef,
        salesChannel: t.salesChannel?.name ?? '',
        destination: t.destinationCountry?.name ?? '',
        skus: t.items.map((i) => i.sku).join('; '),
        type: 'outbound',
        shipmentDate: '',
        shippingService: t.shippingService?.name ?? '',
        trackingNumber: '',
        shippingCostEur: '',
        costBorneBy: 'company',
        dutyImportEur: '',
        comments: '',
        markShipped: 'yes',
      }));
    }
    const rows = await this.prisma.shipment.findMany({
      where: { deletedAt: null, ...(query.type ? { type: query.type } : {}), transaction: { deletedAt: null, ...this.txScopeWhere(query) } },
      include,
      orderBy: { shipmentDate: 'desc' },
    });
    return rows.map((s) => ({
      transactionRef: s.transaction?.transactionRef ?? '',
      salesChannel: s.transaction?.salesChannel?.name ?? '',
      destination: s.transaction?.destinationCountry?.name ?? '',
      skus: '',
      type: s.type,
      shipmentDate: iso(s.shipmentDate),
      shippingService: s.shippingService?.name ?? '',
      trackingNumber: s.trackingNumber ?? '',
      shippingCostEur: s.shippingCostEur ?? '',
      costBorneBy: s.costBorneBy,
      dutyImportEur: s.dutyImportEur ?? '',
      comments: s.comments ?? '',
      markShipped: '',
    }));
  }

  private normNum(v: string): number | null {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  /** Parse an import date cell → Date, or null if empty. Handles ISO strings and stray
   *  Excel serial numbers (e.g. "46028"). Returns undefined for a non-empty, unparseable value. */
  private parseImportDate(v: string): Date | null | undefined {
    const s = v.trim();
    if (!s) return null;
    // Excel serial date (serial 25569 = 1970-01-01). Plausible range ~1954–2146.
    if (/^\d+(\.\d+)?$/.test(s)) {
      const serial = Number(s);
      if (serial > 20000 && serial < 90000) {
        const d = new Date(Math.round((serial - 25569) * 86400000));
        return isNaN(d.getTime()) ? undefined : d;
      }
      return undefined;
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return undefined;
    const y = d.getUTCFullYear();
    return y >= 1990 && y <= 2100 ? d : undefined;
  }

  /** Validate import rows: resolve each Transaction ID + shipping service, flag problems. */
  async importValidate(rows: Record<string, string>[]) {
    const services = await this.prisma.shippingService.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
    const svcByName = new Map(services.map((s) => [s.name.toLowerCase(), s.id]));
    const out: Array<{
      index: number; transactionRef: string; status: 'new' | 'error';
      transactionId: string | null; shippingServiceId: string | null;
      issues: { field: string; message: string; severity: 'error' | 'warning' }[];
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? {};
      const get = (k: string) => (row[k] == null ? '' : String(row[k]).trim());
      const issues: { field: string; message: string; severity: 'error' | 'warning' }[] = [];
      const ref = get('transactionRef');
      if (!ref) issues.push({ field: 'transactionRef', message: 'Transaction ID is required', severity: 'error' });

      const type = (get('type') || 'outbound').toLowerCase();
      if (type !== 'outbound' && type !== 'inbound') issues.push({ field: 'type', message: `Type must be "outbound" or "inbound" (got "${get('type')}")`, severity: 'error' });
      const borne = (get('costBorneBy') || 'company').toLowerCase();
      if (borne !== 'company' && borne !== 'customer') issues.push({ field: 'costBorneBy', message: `Cost borne by should be "company" or "customer"`, severity: 'warning' });
      for (const [k, label] of [['shippingCostEur', 'Shipping cost'], ['dutyImportEur', 'Duty/import']] as [string, string][]) {
        const v = get(k);
        if (v !== '' && !Number.isFinite(Number(v))) issues.push({ field: k, message: `${label} must be a number (got "${v}")`, severity: 'error' });
      }
      const dateVal = get('shipmentDate');
      if (dateVal && this.parseImportDate(dateVal) === undefined) {
        issues.push({ field: 'shipmentDate', message: `Ship date isn't a valid date (got "${dateVal}") — use YYYY-MM-DD`, severity: 'error' });
      }

      let shippingServiceId: string | null = null;
      const svcName = get('shippingService');
      if (svcName) {
        shippingServiceId = svcByName.get(svcName.toLowerCase()) ?? null;
        if (!shippingServiceId) issues.push({ field: 'shippingService', message: `Unknown shipping service "${svcName}" — will be left blank`, severity: 'warning' });
      }

      let transactionId: string | null = null;
      if (ref) {
        const matches = await this.prisma.salesTransaction.findMany({
          where: { deletedAt: null, transactionRef: { equals: ref, mode: 'insensitive' } },
          select: { id: true },
        });
        if (matches.length === 0) issues.push({ field: 'transactionRef', message: `No sales transaction found with ID "${ref}"`, severity: 'error' });
        else if (matches.length > 1) issues.push({ field: 'transactionRef', message: `${matches.length} transactions match "${ref}" — can't tell which`, severity: 'error' });
        else transactionId = matches[0].id;
      }

      const hasError = issues.some((x) => x.severity === 'error');
      out.push({ index: i, transactionRef: ref, status: hasError ? 'error' : 'new', transactionId, shippingServiceId, issues });
    }
    return { rows: out };
  }

  /** Commit validated import rows — create a shipment per row (reuses create(), so the
   *  transaction is marked shipped for outbound rows unless markShipped=no). */
  async importCommit(items: { row: Record<string, string>; transactionId: string; shippingServiceId?: string | null }[], actorId?: string) {
    let created = 0;
    const errors: { transactionRef: string; message: string }[] = [];
    for (const item of items) {
      const get = (k: string) => (item.row[k] == null ? '' : String(item.row[k]).trim());
      const ref = get('transactionRef');
      try {
        if (!item.transactionId) throw new Error('No matching sales transaction');
        const type = (get('type') || 'outbound').toLowerCase() as 'outbound' | 'inbound';
        const markRaw = get('markShipped').toLowerCase();
        const markShipped = !(markRaw === 'no' || markRaw === 'false' || markRaw === 'n');
        const parsedDate = this.parseImportDate(get('shipmentDate'));
        if (parsedDate === undefined) throw new Error(`Invalid ship date "${get('shipmentDate')}"`);
        await this.create({
          transactionId: item.transactionId,
          type,
          shipmentDate: (parsedDate ?? new Date()).toISOString(),
          shippingServiceId: item.shippingServiceId ?? null,
          trackingNumber: get('trackingNumber') || null,
          shippingCostEur: this.normNum(get('shippingCostEur')),
          costBorneBy: ((get('costBorneBy') || 'company').toLowerCase()) as 'company' | 'customer',
          dutyImportEur: this.normNum(get('dutyImportEur')),
          comments: get('comments') || null,
          markShipped,
        }, actorId);
        created++;
      } catch (e: any) {
        errors.push({ transactionRef: ref, message: e?.message ?? 'Failed' });
      }
    }
    return { created, errors };
  }
}

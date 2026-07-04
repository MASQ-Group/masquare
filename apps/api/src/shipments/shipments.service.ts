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
      fulfilmentStatus: 'pending',
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
}

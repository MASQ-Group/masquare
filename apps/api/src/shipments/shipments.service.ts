import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCombinedShipmentDto, CreateShipmentBatchDto, CreateShipmentDto, UpdateShipmentDto } from './dto/shipment.dto';

export interface ShipmentQuery {
  q?: string;
  companyId?: string;
  /** Enforced company isolation (scoped via the shipment's sales transaction). */
  companyIds?: string[];
  salesChannelId?: string;
  type?: string;
  /** Pending list only: 'local' = our own delivery/pickup, 'channel' = marketplace. */
  channelKind?: 'local' | 'channel';
  /** Date order: pending sorts on the order date, the log on the shipment date. */
  sortDir?: 'asc' | 'desc';
  /**
   * Include settled FBA shipments in the log.
   *
   * They are a separate model with no sales transaction behind them — stock moving to Amazon, not
   * an order going to a customer — but once confirmed they are as much a recorded shipment as any
   * other, and this is where the operator expects to find them.
   */
  includeFba?: boolean;
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
      groupId: s.groupId ?? null,
      createdAt: s.createdAt,
    };
  }

  /** Recorded shipments log (across all transactions). */
  async list(query: ShipmentQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const where: Prisma.ShipmentWhereInput = {
      deletedAt: null,
      ...(query.type && query.type !== 'fba' ? { type: query.type } : {}),
      ...(query.q || query.companyIds || query.companyId || query.salesChannelId
        ? {
            transaction: {
              deletedAt: null,
              ...(query.companyIds ? { companyId: { in: query.companyIds } } : query.companyId ? { companyId: query.companyId } : {}),
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
    const asc = query.sortDir === 'asc';

    // Filtering by type picks a side: 'fba' shows only settled FBA shipments, and 'outbound' or
    // 'inbound' are properties of an order shipment that an FBA row does not have.
    if (query.includeFba && query.type === 'fba') {
      const upTo = page * pageSize;
      const fba = await this.fbaLog(query, upTo);
      return { items: fba.items.slice((page - 1) * pageSize, upTo), total: fba.total, page, pageSize };
    }
    if (query.type && query.type !== 'fba') query = { ...query, includeFba: false };

    if (!query.includeFba) {
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.shipment.count({ where }),
        this.prisma.shipment.findMany({ where, include, orderBy: [{ shipmentDate: asc ? 'asc' : 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { items: rows.map((r) => this.serialize(r)), total, page, pageSize };
    }

    // Two tables, one date-ordered page. To fill page N of the merged order, each source can
    // contribute at most the rows up to the end of that page — so take that many from each and
    // merge, rather than trying to express the union in SQL and losing Prisma's relation filters.
    const upTo = page * pageSize;
    const [ownTotal, ownRows, fba] = await Promise.all([
      this.prisma.shipment.count({ where }),
      this.prisma.shipment.findMany({ where, include, orderBy: [{ shipmentDate: asc ? 'asc' : 'desc' }, { createdAt: 'desc' }], take: upTo }),
      this.fbaLog(query, upTo),
    ]);
    const at = (r: any) => new Date(r.shipmentDate ?? r.createdAt).getTime();
    const merged = [...ownRows.map((r) => this.serialize(r)), ...fba.items]
      .sort((a, b) => (asc ? at(a) - at(b) : at(b) - at(a)));
    return {
      items: merged.slice((page - 1) * pageSize, upTo),
      total: ownTotal + fba.total,
      page,
      pageSize,
    };
  }

  /**
   * Settled FBA shipments, shaped like an ordinary shipment row.
   *
   * They have no sales transaction, so the transaction-shaped fields carry what the operator would
   * look for instead: the FBA reference in place of the order reference, and the actual shipping
   * cost as the cost. `type: 'fba'` marks them so the caller never treats one as an order shipment.
   */
  private async fbaLog(query: ShipmentQuery, limit: number) {
    const and: any[] = [
      { deletedAt: null },
      // Confirmed is the whole point: an unconfirmed FBA shipment is still on the worklist, and its
      // cost is an estimate. Only a settled one belongs in the log.
      { status: 'confirmed' },
      { actualCostEur: { not: null } },
    ];
    if (query.companyIds) and.push({ companyId: { in: query.companyIds } });
    else if (query.companyId) and.push({ companyId: query.companyId });
    if (query.salesChannelId) and.push({ salesChannelId: query.salesChannelId });
    const q = query.q?.trim();
    if (q) {
      and.push({
        OR: [
          { fbaShipmentRef: { contains: q, mode: 'insensitive' } },
          { items: { some: { deletedAt: null, sku: { contains: q, mode: 'insensitive' } } } },
          { boxes: { some: { trackingNumber: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    const where = { AND: and };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fbaShipment.count({ where }),
      this.prisma.fbaShipment.findMany({
        where,
        orderBy: [{ date: query.sortDir === 'asc' ? 'asc' : 'desc' }, { createdAt: 'desc' }],
        take: limit,
        include: {
          salesChannel: { select: { id: true, name: true } },
          company: { select: { id: true, officialName: true } },
          destinationCountry: { select: { id: true, name: true } },
          shippingService: { select: { id: true, name: true } },
          boxes: { select: { trackingNumber: true } },
        },
      }),
    ]);
    const items = rows.map((r: any) => {
      // One shipment can go in several boxes, each with its own tracking number.
      const tracking = (r.boxes ?? []).map((b: any) => b.trackingNumber).filter(Boolean);
      return {
        id: r.id,
        transactionId: null,
        transactionRef: r.fbaShipmentRef ?? null,
        transactionDate: null,
        salesChannel: r.salesChannel ?? null,
        company: r.company ?? null,
        destinationCountry: r.destinationCountry ?? null,
        fulfilmentStatus: null,
        type: 'fba',
        shipmentDate: r.date,
        shippingServiceId: r.shippingServiceId ?? null,
        shippingService: r.shippingService ?? null,
        trackingNumber: tracking.length ? tracking.join(', ') : null,
        shippingCostEur: r.actualCostEur != null ? Number(r.actualCostEur) : null,
        // We ship stock to Amazon, so this is always ours — there is no customer to bear it.
        costBorneBy: 'company',
        dutyImportEur: null,
        comments: r.comments ?? null,
        groupId: null,
        createdAt: r.createdAt,
      };
    });
    return { total, items };
  }

  /** Fulfilment worklist: transactions still awaiting an outbound shipment. */
  async pending(query: ShipmentQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const where: Prisma.SalesTransactionWhereInput = {
      deletedAt: null,
      // Pending = not yet marked fully shipped. An order can go out in several shipments, so
      // recording one does NOT complete it — it stays here (as 'partial') until the operator
      // ticks "fully shipped", which is what lets you come back and add the next one.
      // Cancelled orders need no fulfilment; FBA is fulfilled by the channel.
      fulfilmentStatus: { notIn: ['shipped', 'cancelled'] },
      resolution: { not: 'cancelled' },
      fulfilmentType: { not: 'FBA' },
      ...(query.companyIds ? { companyId: { in: query.companyIds } } : query.companyId ? { companyId: query.companyId } : {}),
      ...(query.salesChannelId ? { salesChannelId: query.salesChannelId } : {}),
      // Local = our own delivery/pickup (channel.kind 'local'); channel = everything else.
      ...(query.channelKind === 'local' ? { salesChannel: { is: { kind: 'local' } } } : {}),
      ...(query.channelKind === 'channel' ? { salesChannel: { isNot: { kind: 'local' } } } : {}),
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
        // Order date. Defaults to oldest first — longest outstanding at the top.
        orderBy: { date: query.sortDir === 'desc' ? 'desc' : 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, transactionRef: true, date: true, shippingServiceId: true, deliveryMethod: true, exchangeRate: true,
          salesChannel: { select: { id: true, name: true, kind: true, nativeCountry: { select: { isoCode: true } } } },
          company: { select: { id: true, officialName: true } },
          destinationCountry: { select: { id: true, name: true } },
          shippingService: { select: { id: true, name: true } },
          items: { where: { deletedAt: null }, select: { sku: true, quantity: true, shippingAmount: true } },
          shipments: { where: { deletedAt: null }, select: { id: true, type: true } },
        },
      }),
    ]);
    const items = rows.map((t) => ({
      id: t.id,
      transactionRef: t.transactionRef,
      date: t.date,
      salesChannel: t.salesChannel ? { id: t.salesChannel.id, name: t.salesChannel.name, nativeCountryIso: t.salesChannel.nativeCountry?.isoCode ?? null } : null,
      // Local sales need no carrier/tracking/weight — the UI offers a one-click fulfil instead.
      isLocal: t.salesChannel?.kind === 'local',
      deliveryMethod: t.deliveryMethod ?? null,
      company: t.company,
      destinationCountry: t.destinationCountry,
      defaultShippingService: t.shippingService,
      skus: t.items.map((i) => i.sku),
      itemCount: t.items.length,
      quantity: t.items.reduce((s, i) => s + Number(i.quantity ?? 0), 0),
      // Shipping the customer was charged on this order, in EUR — the default weight when
      // splitting a combined shipment's cost across its orders.
      shippingEur: Number((t.items.reduce((s, i) => s + (i.shippingAmount ?? 0), 0) * (t.exchangeRate ?? 1)).toFixed(2)),
      shipmentCount: t.shipments.length,
      // Outbound shipments already recorded. > 0 means partially shipped — the next one is
      // an "Add shipment", not a first "Record shipment".
      outboundCount: t.shipments.filter((s) => s.type === 'outbound').length,
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
    const type = dto.type ?? 'outbound';
    const tracking = dto.trackingNumber?.trim() || null;
    // Block a duplicate parcel on manual entry: the same order can't have two shipments of
    // the same type with the same tracking number (that would double-count shipping cost in
    // the profit calc). A genuine extra parcel carries a different tracking number.
    if (tracking) {
      const existing = await this.prisma.shipment.findFirst({
        where: { transactionId: dto.transactionId, type, trackingNumber: tracking, deletedAt: null },
        select: { id: true },
      });
      if (existing) throw new ConflictException(`A ${type} shipment with tracking number ${tracking} is already recorded for this order.`);
    }
    const s = await this.prisma.shipment.create({
      data: {
        transactionId: dto.transactionId,
        type,
        shipmentDate: new Date(dto.shipmentDate),
        shippingServiceId: dto.shippingServiceId ?? null,
        trackingNumber: tracking,
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

  /** Record several parcels that all went out on the same day — one date and one duty charge,
   *  but a separate carrier / tracking number / cost per parcel. Each becomes its own shipment
   *  row, so the cost total and the shipments log work exactly as for a single parcel. */
  async createBatch(dto: CreateShipmentBatchDto, actorId?: string) {
    const tx = await this.prisma.salesTransaction.findFirst({ where: { id: dto.transactionId, deletedAt: null }, select: { id: true } });
    if (!tx) throw new NotFoundException('Sales transaction not found');
    const parcels = dto.parcels?.length ? dto.parcels : [{}];
    const type = dto.type ?? 'outbound';

    await this.prisma.$transaction(async (t) => {
      for (let i = 0; i < parcels.length; i++) {
        const p = parcels[i];
        await t.shipment.create({
          data: {
            transactionId: dto.transactionId,
            type,
            shipmentDate: new Date(dto.shipmentDate),
            shippingServiceId: p.shippingServiceId ?? null,
            trackingNumber: p.trackingNumber ?? null,
            shippingCostEur: p.shippingCostEur ?? null,
            costBorneBy: dto.costBorneBy ?? 'company',
            // Duty is charged once for the consignment — put it on the first parcel only so
            // it isn't counted once per parcel.
            dutyImportEur: i === 0 ? dto.dutyImportEur ?? null : null,
            comments: dto.comments ?? null,
            createdById: actorId,
          },
        });
      }
      if (type === 'outbound' && dto.markShipped !== false) {
        await t.salesTransaction.update({ where: { id: dto.transactionId }, data: { fulfilmentStatus: 'shipped' } });
      }
    });
    return { ok: true, created: parcels.length };
  }

  /** Ship several orders together as one physical parcel. Writes one outbound shipment row per
   *  order — all sharing a fresh groupId — and splits the single real shipping cost across them
   *  (by an explicit split if given, else proportionally to each order's own shipping charge,
   *  equal when none charged shipping). Reusing per-order rows keeps the log, per-transaction
   *  profit and cancel behaviour identical to a normal shipment. */
  async combine(dto: CreateCombinedShipmentDto, actorId?: string) {
    const ids = [...new Set(dto.transactionIds)];
    if (ids.length < 2) throw new BadRequestException('Combine needs at least two different orders');

    const txs = await this.prisma.salesTransaction.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, transactionRef: true, exchangeRate: true, items: { where: { deletedAt: null }, select: { shippingAmount: true } } },
    });
    if (txs.length !== ids.length) throw new NotFoundException('One or more sales transactions were not found');

    const round2 = (n: number) => Number(n.toFixed(2));
    const total = dto.totalShippingCostEur ?? 0;

    // Resolve each order's allocated cost.
    let alloc = new Map<string, number>();
    if (dto.allocations?.length) {
      for (const a of dto.allocations) {
        if (!ids.includes(a.transactionId)) throw new BadRequestException('An allocation refers to an order not in this shipment');
        alloc.set(a.transactionId, round2(a.shippingCostEur ?? 0));
      }
      for (const id of ids) if (!alloc.has(id)) alloc.set(id, 0);
    } else {
      // Weight by each order's own shipping charge (EUR); equal split when none charged.
      const weight = new Map(txs.map((t) => [t.id, t.items.reduce((s, i) => s + (i.shippingAmount ?? 0), 0) * (t.exchangeRate ?? 1)]));
      const sum = [...weight.values()].reduce((s, w) => s + w, 0);
      let running = 0;
      ids.forEach((id, i) => {
        const share = i === ids.length - 1
          ? round2(total - running) // last row absorbs the rounding residue so the split is exact
          : round2(sum > 0 ? total * ((weight.get(id) ?? 0) / sum) : total / ids.length);
        running += share;
        alloc.set(id, share);
      });
    }

    const groupId = randomUUID();
    const type = 'outbound';
    await this.prisma.$transaction(async (t) => {
      let first = true;
      for (const id of ids) {
        await t.shipment.create({
          data: {
            transactionId: id,
            type,
            groupId,
            shipmentDate: new Date(dto.shipmentDate),
            shippingServiceId: dto.shippingServiceId ?? null,
            trackingNumber: dto.trackingNumber ?? null,
            shippingCostEur: alloc.get(id) ?? 0,
            costBorneBy: dto.costBorneBy ?? 'company',
            // Duty is charged once for the whole consignment — record it on the first order only.
            dutyImportEur: first ? dto.dutyImportEur ?? null : null,
            comments: dto.comments ?? null,
            createdById: actorId,
          },
        });
        if (dto.markShipped !== false) {
          await t.salesTransaction.update({ where: { id }, data: { fulfilmentStatus: 'shipped' } });
        }
        first = false;
      }
    });

    return {
      ok: true,
      created: ids.length,
      groupId,
      allocations: txs.map((t) => ({ transactionId: t.id, transactionRef: t.transactionRef, shippingCostEur: alloc.get(t.id) ?? 0 })),
    };
  }

  /** Cancel a recorded shipment. Removing an outbound one un-does the fulfilment: the order
   *  returns to the pending worklist (as 'partial' if other parcels remain, 'pending' if none
   *  do), so it can be shipped again. Inbound/returns don't affect fulfilment. */
  async remove(id: string) {
    const existing = await this.prisma.shipment.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, type: true, transactionId: true },
    });
    if (!existing) throw new NotFoundException('Shipment not found');
    await this.prisma.shipment.update({ where: { id }, data: { deletedAt: new Date() } });
    if (existing.type === 'outbound') {
      await this.prisma.salesTransaction.update({
        where: { id: existing.transactionId },
        data: { fulfilmentStatus: 'pending' },
      });
    }
    return { ok: true };
  }

  async setFulfilment(transactionId: string, status: 'pending' | 'shipped' | 'cancelled') {
    const tx = await this.prisma.salesTransaction.findFirst({ where: { id: transactionId, deletedAt: null }, select: { id: true } });
    if (!tx) throw new NotFoundException('Sales transaction not found');
    await this.prisma.salesTransaction.update({ where: { id: transactionId }, data: { fulfilmentStatus: status } });
    return { ok: true, status };
  }

  /** Fulfil a local sale in one step: no carrier, tracking, weight or zone to enter. Records a
   *  minimal outbound shipment (a marker with no cost of its own — the delivery cost lives on
   *  the transaction), which is what makes it "shipped" everywhere (the app's single source of
   *  truth is an outbound shipment record). Idempotent. */
  async fulfilLocal(transactionId: string, actorId?: string) {
    const tx = await this.prisma.salesTransaction.findFirst({
      where: { id: transactionId, deletedAt: null },
      select: {
        id: true, deliveryMethod: true,
        salesChannel: { select: { kind: true } },
        shipments: { where: { deletedAt: null, type: 'outbound' }, select: { id: true } },
      },
    });
    if (!tx) throw new NotFoundException('Sales transaction not found');
    if (tx.salesChannel?.kind !== 'local') {
      throw new BadRequestException('One-click fulfil is only for local sales — record a shipment for channel orders.');
    }
    if (tx.shipments.length > 0) return { ok: true, alreadyFulfilled: true };

    await this.prisma.shipment.create({
      data: {
        transactionId,
        type: 'outbound',
        shipmentDate: new Date(),
        costBorneBy: 'company',
        comments: tx.deliveryMethod === 'pickup' ? 'Local sale — picked up' : 'Local sale — delivered',
        createdById: actorId,
      },
    });
    await this.prisma.salesTransaction.update({ where: { id: transactionId }, data: { fulfilmentStatus: 'shipped' } });
    return { ok: true };
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
    const fmt = await this.dateFormat();
    if (scope === 'pending') {
      const rows = await this.prisma.salesTransaction.findMany({
        where: {
          deletedAt: null,
          // Same rule as the pending list: not yet marked fully shipped.
          fulfilmentStatus: { notIn: ['shipped', 'cancelled'] },
          resolution: { not: 'cancelled' },
          fulfilmentType: { not: 'FBA' }, // FBA is channel-fulfilled — never pending for us
          ...(query.channelKind === 'local' ? { salesChannel: { is: { kind: 'local' } } } : {}),
          ...(query.channelKind === 'channel' ? { salesChannel: { isNot: { kind: 'local' } } } : {}),
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
      shipmentDate: this.formatDateOut(s.shipmentDate, fmt),
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

  /** The platform's configured date format (Global Settings → General). */
  private async dateFormat(): Promise<'ddmmyyyy' | 'mmddyyyy' | 'yyyymmdd'> {
    const s = await this.prisma.platformSettings.findFirst({ select: { dateFormat: true } });
    return (s?.dateFormat as any) ?? 'ddmmyyyy';
  }

  private saneOrUndef(d: Date): Date | undefined {
    if (isNaN(d.getTime())) return undefined;
    const y = d.getUTCFullYear();
    return y >= 1990 && y <= 2100 ? d : undefined;
  }

  /** Parse an import date cell → Date, or null if empty. Handles Excel serial numbers,
   *  ISO strings, and day/month/year text read in the platform's configured format.
   *  Returns undefined for a non-empty, unparseable value. */
  private parseImportDate(v: string, fmt: 'ddmmyyyy' | 'mmddyyyy' | 'yyyymmdd'): Date | null | undefined {
    const s = v.trim();
    if (!s) return null;
    // Excel serial date (serial 25569 = 1970-01-01). Plausible range ~1954–2146.
    if (/^\d+(\.\d+)?$/.test(s)) {
      const serial = Number(s);
      if (serial > 20000 && serial < 90000) return this.saneOrUndef(new Date(Math.round((serial - 25569) * 86400000)));
      return undefined;
    }
    // ISO YYYY-MM-DD (how the sheet parser normalises real date cells).
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
    if (iso) return this.saneOrUndef(new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])));
    // day/month/year text, split on / . or -, read per the configured format.
    const parts = s.split(/[/.\-]/).map((p) => p.trim());
    if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
      let dd: number, mm: number, yyyy: number;
      if (fmt === 'yyyymmdd') [yyyy, mm, dd] = parts.map(Number);
      else if (fmt === 'mmddyyyy') [mm, dd, yyyy] = parts.map(Number);
      else [dd, mm, yyyy] = parts.map(Number);
      if (yyyy < 100) yyyy += 2000;
      const d = new Date(Date.UTC(yyyy, mm - 1, dd));
      if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return undefined;
      return this.saneOrUndef(d);
    }
    return this.saneOrUndef(new Date(s));
  }

  private formatDateOut(d: Date | null | undefined, fmt: 'ddmmyyyy' | 'mmddyyyy' | 'yyyymmdd'): string {
    if (!d) return '';
    const dt = new Date(d);
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = dt.getUTCFullYear();
    if (fmt === 'yyyymmdd') return `${yyyy}-${mm}-${dd}`;
    if (fmt === 'mmddyyyy') return `${mm}/${dd}/${yyyy}`;
    return `${dd}/${mm}/${yyyy}`;
  }

  /** Validate import rows: resolve each Transaction ID + shipping service, flag problems.
   *  A row with no Ship date is treated as "not shipped yet" and skipped (left unchanged). */
  async importValidate(rows: Record<string, string>[]) {
    const fmt = await this.dateFormat();
    const services = await this.prisma.shippingService.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
    const svcByName = new Map(services.map((s) => [s.name.toLowerCase(), s.id]));
    const out: Array<{
      index: number; transactionRef: string; status: 'new' | 'skip' | 'error';
      transactionId: string | null; shippingServiceId: string | null;
      issues: { field: string; message: string; severity: 'error' | 'warning' }[];
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? {};
      const get = (k: string) => (row[k] == null ? '' : String(row[k]).trim());
      const issues: { field: string; message: string; severity: 'error' | 'warning' }[] = [];
      const ref = get('transactionRef');

      // No Ship date → the shipment hasn't happened yet. Skip the row: don't record
      // anything and leave the order unchanged (still pending). This is how you keep a
      // not-yet-shipped order in the sheet without it being marked shipped.
      if (!get('shipmentDate')) {
        out.push({ index: i, transactionRef: ref, status: 'skip', transactionId: null, shippingServiceId: null,
          issues: [{ field: 'shipmentDate', message: 'No ship date — treated as not shipped yet; this row is left unchanged', severity: 'warning' }] });
        continue;
      }

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
      if (this.parseImportDate(dateVal, fmt) === undefined) {
        const example = fmt === 'yyyymmdd' ? 'YYYY-MM-DD' : fmt === 'mmddyyyy' ? 'MM/DD/YYYY' : 'DD/MM/YYYY';
        issues.push({ field: 'shipmentDate', message: `Ship date isn't a valid date (got "${dateVal}") — use ${example}`, severity: 'error' });
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
    const fmt = await this.dateFormat();
    let created = 0;
    let skipped = 0;
    const errors: { transactionRef: string; message: string }[] = [];
    for (const item of items) {
      const get = (k: string) => (item.row[k] == null ? '' : String(item.row[k]).trim());
      const ref = get('transactionRef');
      try {
        const parsedDate = this.parseImportDate(get('shipmentDate'), fmt);
        // No ship date → not shipped yet: leave the order unchanged.
        if (parsedDate == null) { skipped++; continue; }
        if (!item.transactionId) throw new Error('No matching sales transaction');
        const type = (get('type') || 'outbound').toLowerCase() as 'outbound' | 'inbound';
        const markRaw = get('markShipped').toLowerCase();
        const markShipped = !(markRaw === 'no' || markRaw === 'false' || markRaw === 'n');
        const tracking = get('trackingNumber') || null;
        // Idempotency guard: if this exact parcel is already recorded for the order — matched
        // by tracking number, or by ship date when there is no tracking — skip it. Without this
        // a re-run of the import, or a gateway-timeout (502) that the user retries, records a
        // second shipment for every order. A genuine extra parcel has a different tracking
        // number and still goes through.
        const already = await this.prisma.shipment.findFirst({
          where: {
            transactionId: item.transactionId, type, deletedAt: null,
            ...(tracking ? { trackingNumber: tracking } : { trackingNumber: null, shipmentDate: parsedDate }),
          },
          select: { id: true },
        });
        if (already) { skipped++; continue; }
        await this.create({
          transactionId: item.transactionId,
          type,
          shipmentDate: parsedDate.toISOString(),
          shippingServiceId: item.shippingServiceId ?? null,
          trackingNumber: tracking,
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
    return { created, skipped, errors };
  }

  /** One-shot cleanup for the historic duplicate-shipment bug (re-run/retried imports before
   *  importCommit was made idempotent). Groups active outbound shipments of the same order that
   *  share a tracking number, keeps the earliest of each group, and — when apply=true —
   *  soft-deletes the rest (reversible; nothing is hard-deleted). Dry-run by default. Scoped to
   *  the caller's visible companies. Only tracking-identified parcels are touched, so genuine
   *  multi-parcel shipments (distinct tracking) and untracked local sales are never removed. */
  async dedupe(companyIds: string[], apply: boolean) {
    const rows = await this.prisma.shipment.findMany({
      where: {
        type: 'outbound',
        deletedAt: null,
        trackingNumber: { not: null },
        transaction: { deletedAt: null, ...(companyIds?.length ? { companyId: { in: companyIds } } : {}) },
      },
      select: {
        id: true, transactionId: true, trackingNumber: true, createdAt: true,
        transaction: { select: { transactionRef: true } },
      },
      orderBy: { createdAt: 'asc' }, // earliest first, so the keeper is [0] in each group
    });

    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const track = (r.trackingNumber ?? '').trim().toLowerCase();
      if (!track) continue; // only dedupe parcels identified by a tracking number
      const key = `${r.transactionId}|${track}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    const toDelete: { id: string; transactionRef: string; trackingNumber: string | null }[] = [];
    let duplicateGroups = 0;
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      duplicateGroups++;
      for (const dup of g.slice(1)) {
        toDelete.push({ id: dup.id, transactionRef: dup.transaction.transactionRef, trackingNumber: dup.trackingNumber });
      }
    }

    if (apply && toDelete.length) {
      await this.prisma.shipment.updateMany({
        where: { id: { in: toDelete.map((d) => d.id) } },
        data: { deletedAt: new Date() },
      });
    }

    return {
      applied: apply,
      ordersAffected: duplicateGroups,
      removed: apply ? toDelete.length : 0,
      wouldRemove: apply ? 0 : toDelete.length,
      sample: toDelete.slice(0, 25),
    };
  }
}

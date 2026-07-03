import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalesTransactionDto, UpdateSalesTransactionDto } from './dto/sales-transaction.dto';

export interface TxQuery {
  q?: string;
  companyId?: string;
  salesChannelId?: string;
  page?: number;
  pageSize?: number;
}

const include = {
  salesChannel: { select: { id: true, name: true } },
  destinationCountry: { select: { id: true, name: true, isoCode: true } },
  items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.SalesTransactionInclude;

const n = (v: number | null | undefined) => Number(v ?? 0);

@Injectable()
export class SalesTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(t: any) {
    const items = t.items ?? [];
    const totals = items.reduce(
      (acc: any, it: any) => ({
        quantity: acc.quantity + (it.quantity ?? 0),
        netSales: acc.netSales + n(it.netSalesAmount),
        vat: acc.vat + n(it.vatAmount),
        shipping: acc.shipping + n(it.shippingAmount),
        shippingVat: acc.shippingVat + n(it.shippingAmountVat),
        fee: acc.fee + n(it.salesChannelSalesFeeAmount),
      }),
      { quantity: 0, netSales: 0, vat: 0, shipping: 0, shippingVat: 0, fee: 0 },
    );
    return {
      id: t.id,
      date: t.date,
      transactionRef: t.transactionRef,
      salesChannelId: t.salesChannelId,
      salesChannel: t.salesChannel ?? null,
      destinationCountryId: t.destinationCountryId,
      destinationCountry: t.destinationCountry ?? null,
      companyId: t.companyId,
      currency: t.currency,
      feeCurrency: t.feeCurrency,
      items: items.map((it: any) => ({
        id: it.id,
        productId: it.productId,
        sku: it.sku,
        quantity: it.quantity,
        netSalesAmount: it.netSalesAmount,
        vatAmount: it.vatAmount,
        shippingAmount: it.shippingAmount,
        shippingAmountVat: it.shippingAmountVat,
        salesChannelSalesFeeAmount: it.salesChannelSalesFeeAmount,
      })),
      itemCount: items.length,
      totals,
    };
  }

  async list(query: TxQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const where: Prisma.SalesTransactionWhereInput = {
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
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesTransaction.count({ where }),
      this.prisma.salesTransaction.findMany({ where, include, orderBy: { date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items: rows.map((r) => this.serialize(r)), total, page, pageSize };
  }

  async get(id: string) {
    const t = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null }, include });
    if (!t) throw new NotFoundException('Sales transaction not found');
    return this.serialize(t);
  }

  /** Snapshot the currencies from the sales channel at registration time. */
  private async currenciesFor(salesChannelId?: string | null) {
    if (!salesChannelId) return { currency: null, feeCurrency: null };
    const c = await this.prisma.salesChannel.findUnique({ where: { id: salesChannelId } });
    if (!c) return { currency: null, feeCurrency: null };
    return {
      currency: c.nativeCurrency ?? null,
      feeCurrency: c.feeChargedInNativeCurrency ? c.nativeCurrency ?? null : c.feeCurrency ?? null,
    };
  }

  async create(dto: CreateSalesTransactionDto, actorId?: string) {
    const { currency, feeCurrency } = await this.currenciesFor(dto.salesChannelId);
    const t = await this.prisma.salesTransaction.create({
      data: {
        date: new Date(dto.date),
        transactionRef: dto.transactionRef,
        salesChannelId: dto.salesChannelId ?? null,
        destinationCountryId: dto.destinationCountryId ?? null,
        companyId: dto.companyId ?? null,
        currency,
        feeCurrency,
        createdById: actorId,
        updatedById: actorId,
        items: { create: dto.items.map((i) => ({ ...i, productId: i.productId ?? null })) },
      },
      include,
    });
    return this.serialize(t);
  }

  async update(id: string, dto: UpdateSalesTransactionDto, actorId?: string) {
    await this.get(id);
    const { currency, feeCurrency } = await this.currenciesFor(dto.salesChannelId);
    const t = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.salesTransactionItem.deleteMany({ where: { transactionId: id } });
        await tx.salesTransactionItem.createMany({
          data: dto.items.map((i) => ({ ...i, transactionId: id, productId: i.productId ?? null })),
        });
      }
      return tx.salesTransaction.update({
        where: { id },
        data: {
          date: dto.date ? new Date(dto.date) : undefined,
          transactionRef: dto.transactionRef,
          salesChannelId: dto.salesChannelId,
          destinationCountryId: dto.destinationCountryId,
          currency,
          feeCurrency,
          updatedById: actorId,
        },
        include,
      });
    });
    return this.serialize(t);
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.salesTransaction.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

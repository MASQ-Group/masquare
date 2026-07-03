import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/current-user.decorator';
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
  destinationCountry: { select: { id: true, name: true, isoCode: true, vatRate: true, defaultShippingServiceId: true } },
  shippingService: { select: { id: true, name: true, calcMethod: true } },
  items: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: { product: { select: { packageWeightKg: true, packageLengthCm: true, packageWidthCm: true, packageHeightCm: true } } },
  },
  unlockRequests: { where: { status: 'pending' }, orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.SalesTransactionInclude;

const n = (v: any) => Number(v ?? 0);
const round = (v: number, d: number) => Number(v.toFixed(d));

@Injectable()
export class SalesTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(t: any, serviceMap: Map<string, any>) {
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

    // --- Calculated fields ---
    // Sales Fee % = total fee / total (net + vat + shipping + shipping vat).
    const feeBase = items.reduce((s: number, it: any) => s + n(it.netSalesAmount) + n(it.vatAmount) + n(it.shippingAmount) + n(it.shippingAmountVat), 0);
    const salesFeePct = feeBase > 0 ? round((totals.fee / feeBase) * 100, 2) : null;

    // Destination country VAT % (from Global Settings → Countries).
    const destinationCountryVatPct = t.destinationCountry ? Number(t.destinationCountry.vatRate) : null;

    // Overall package weight: sum of per-SKU weight × quantity, by the service's cost basis.
    const method: string | null = t.shippingService?.calcMethod ?? null;
    let overallPackageWeight: number | null = null;
    if (method) {
      let w = 0;
      let any = false;
      for (const it of items) {
        const p = it.product;
        if (!p) continue;
        let unit: number | null = null;
        if (method === 'actual_weight') {
          unit = p.packageWeightKg != null ? Number(p.packageWeightKg) : null;
        } else if (p.packageLengthCm != null && p.packageWidthCm != null && p.packageHeightCm != null) {
          unit = (Number(p.packageLengthCm) * Number(p.packageWidthCm) * Number(p.packageHeightCm)) / 5000;
        }
        if (unit != null) { w += unit * (it.quantity ?? 1); any = true; }
      }
      overallPackageWeight = any ? round(w, 3) : null;
    }

    // Estimated shipping cost: zone of the service the destination belongs to → weight range → charge.
    let estimatedShippingCost: number | null = null;
    const svc = t.shippingServiceId ? serviceMap.get(t.shippingServiceId) : null;
    if (svc && t.destinationCountryId && overallPackageWeight != null) {
      const zone = (svc.zones ?? []).find((z: any) => (z.countries ?? []).some((c: any) => c.countryId === t.destinationCountryId));
      const rate = zone?.rates?.find((r: any) => overallPackageWeight! >= Number(r.fromWeightKg) && overallPackageWeight! <= Number(r.toWeightKg));
      if (rate) estimatedShippingCost = Number(rate.chargeEur);
    }

    return {
      id: t.id,
      date: t.date,
      transactionRef: t.transactionRef,
      salesChannelId: t.salesChannelId,
      salesChannel: t.salesChannel ?? null,
      destinationCountryId: t.destinationCountryId,
      destinationCountry: t.destinationCountry ? { id: t.destinationCountry.id, name: t.destinationCountry.name, isoCode: t.destinationCountry.isoCode } : null,
      shippingServiceId: t.shippingServiceId,
      shippingService: t.shippingService ? { id: t.shippingService.id, name: t.shippingService.name } : null,
      companyId: t.companyId,
      currency: t.currency,
      feeCurrency: t.feeCurrency,
      exchangeRate: t.exchangeRate,
      status: t.status,
      unlockedForEdit: t.unlockedForEdit,
      hasPendingUnlock: (t.unlockRequests ?? []).length > 0,
      salesFeePct,
      destinationCountryVatPct,
      overallPackageWeight,
      estimatedShippingCost,
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
    const serviceMap = await this.buildServiceMap();
    return { items: rows.map((r) => this.serialize(r, serviceMap)), total, page, pageSize };
  }

  async get(id: string) {
    const t = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null }, include });
    if (!t) throw new NotFoundException('Sales transaction not found');
    const serviceMap = await this.buildServiceMap();
    return this.serialize(t, serviceMap);
  }

  /** Shipping services with zones (countries + rates) for shipping-cost estimation. */
  private async buildServiceMap() {
    const services = await this.prisma.shippingService.findMany({
      where: { deletedAt: null },
      include: { zones: { where: { deletedAt: null }, include: { countries: true, rates: { where: { deletedAt: null } } } } },
    });
    return new Map<string, any>(services.map((s) => [s.id, s]));
  }

  private async resolveShippingService(explicit: string | null | undefined, countryId: string | null) {
    if (explicit !== undefined) return explicit;
    if (!countryId) return null;
    const c = await this.prisma.country.findUnique({ where: { id: countryId }, select: { defaultShippingServiceId: true } });
    return c?.defaultShippingServiceId ?? null;
  }

  /** channel currency -> EUR at the transaction date, from the free Frankfurter (ECB) API. */
  private async fetchExchangeRate(currency: string | null, date: string): Promise<number | null> {
    if (!currency) return null;
    if (currency.toUpperCase() === 'EUR') return 1;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const d = date.slice(0, 10);
      const endpoint = d > today ? 'latest' : d;
      const res = await fetch(`https://api.frankfurter.app/${endpoint}?from=${currency.toUpperCase()}&to=EUR`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const json: any = await res.json();
      const rate = json?.rates?.EUR;
      return typeof rate === 'number' ? round(rate, 6) : null;
    } catch {
      return null;
    }
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
    const shippingServiceId = await this.resolveShippingService(dto.shippingServiceId, dto.destinationCountryId ?? null);
    const exchangeRate = await this.fetchExchangeRate(currency, dto.date);
    const t = await this.prisma.salesTransaction.create({
      data: {
        date: new Date(dto.date),
        transactionRef: dto.transactionRef,
        salesChannelId: dto.salesChannelId ?? null,
        destinationCountryId: dto.destinationCountryId ?? null,
        shippingServiceId,
        companyId: dto.companyId ?? null,
        currency,
        feeCurrency,
        exchangeRate,
        status: dto.status ?? 'draft',
        unlockedForEdit: false,
        createdById: actorId,
        updatedById: actorId,
        items: { create: dto.items.map((i) => ({ ...i, productId: i.productId ?? null })) },
      },
    });
    return this.get(t.id);
  }

  /** A submitted transaction is locked: only admins edit it, unless it's been unlocked. */
  private assertCanEdit(existing: { status: string; unlockedForEdit: boolean }, user: AuthUser) {
    const editable = user.isAdmin || existing.status === 'draft' || existing.unlockedForEdit;
    if (!editable) {
      throw new ForbiddenException('This transaction is submitted and locked. Request an unlock from an admin.');
    }
  }

  async update(id: string, dto: UpdateSalesTransactionDto, user: AuthUser) {
    const existing = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Sales transaction not found');
    this.assertCanEdit(existing, user);

    const channelId = dto.salesChannelId === undefined ? existing.salesChannelId : dto.salesChannelId;
    const { currency, feeCurrency } = await this.currenciesFor(channelId);
    const nextStatus = dto.status ?? existing.status;
    // Submitting re-locks it (unless the actor is an admin, who always retains access).
    const unlockedForEdit = nextStatus === 'submitted' ? false : existing.unlockedForEdit;
    const exchangeRate = await this.fetchExchangeRate(currency, dto.date ?? existing.date.toISOString());

    await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.salesTransactionItem.deleteMany({ where: { transactionId: id } });
        await tx.salesTransactionItem.createMany({
          data: dto.items.map((i) => ({ ...i, transactionId: id, productId: i.productId ?? null })),
        });
      }
      await tx.salesTransaction.update({
        where: { id },
        data: {
          date: dto.date ? new Date(dto.date) : undefined,
          transactionRef: dto.transactionRef,
          salesChannelId: dto.salesChannelId,
          destinationCountryId: dto.destinationCountryId,
          shippingServiceId: dto.shippingServiceId,
          currency,
          feeCurrency,
          exchangeRate,
          status: nextStatus,
          unlockedForEdit,
          updatedById: user.sub,
        },
      });
    });
    return this.get(id);
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Sales transaction not found');
    this.assertCanEdit(existing, user);
    await this.prisma.salesTransaction.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  // --- Unlock requests -----------------------------------------------------
  async requestUnlock(id: string, userId: string) {
    const t = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw new NotFoundException('Sales transaction not found');
    if (t.status !== 'submitted' || t.unlockedForEdit) {
      throw new BadRequestException('This transaction is not locked.');
    }
    const existing = await this.prisma.salesTransactionUnlockRequest.findFirst({ where: { transactionId: id, status: 'pending' } });
    if (existing) return { ok: true, alreadyRequested: true };
    await this.prisma.salesTransactionUnlockRequest.create({ data: { transactionId: id, requestedById: userId } });
    return { ok: true };
  }

  async listUnlockRequests() {
    const reqs = await this.prisma.salesTransactionUnlockRequest.findMany({
      where: { status: 'pending' },
      include: { transaction: { select: { id: true, transactionRef: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const userIds = [...new Set(reqs.map((r) => r.requestedById).filter(Boolean) as string[])];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u.fullName]));
    return reqs.map((r) => ({
      id: r.id,
      transactionId: r.transactionId,
      transactionRef: r.transaction.transactionRef,
      requestedBy: r.requestedById ? byId.get(r.requestedById) ?? '—' : '—',
      createdAt: r.createdAt,
    }));
  }

  async decideUnlock(requestId: string, grant: boolean, adminId: string) {
    const req = await this.prisma.salesTransactionUnlockRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Unlock request not found');
    await this.prisma.$transaction([
      this.prisma.salesTransactionUnlockRequest.update({
        where: { id: requestId },
        data: { status: grant ? 'granted' : 'denied', decidedById: adminId, decidedAt: new Date() },
      }),
      ...(grant
        ? [this.prisma.salesTransaction.update({ where: { id: req.transactionId }, data: { unlockedForEdit: true } })]
        : []),
    ]);
    return { ok: true };
  }
}

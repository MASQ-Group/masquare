import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/current-user.decorator';
import { CreateSalesTransactionDto, UpdateSalesTransactionDto } from './dto/sales-transaction.dto';

export interface TxQuery {
  q?: string;
  companyId?: string;
  salesChannelId?: string;
  status?: string;
  profitTierId?: string;
  sortBy?: 'date' | 'profit' | 'profitPct';
  sortDir?: 'asc' | 'desc';
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
    include: { product: { select: { title: true, packageWeightKg: true, productWeightKg: true, packageLengthCm: true, packageWidthCm: true, packageHeightCm: true, purchaseCostAmount: true, purchaseCostCurrency: true } } },
  },
  unlockRequests: { where: { status: 'pending' }, orderBy: { createdAt: 'desc' as const } },
  shipments: {
    where: { deletedAt: null },
    orderBy: { shipmentDate: 'asc' as const },
    include: { shippingService: { select: { id: true, name: true } } },
  },
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

    // Destination VAT % — the (editable) stored value, falling back to the country rate.
    const destinationCountryVatPct = t.destinationVatPct ?? (t.destinationCountry ? Number(t.destinationCountry.vatRate) : null);

    // Overall package weight: sum of per-SKU weight × quantity, by the service's cost basis.
    const method: string | null = t.shippingService?.calcMethod ?? null;
    let overallPackageWeight: number | null = null;
    if (method) {
      let w = 0;
      let any = false;
      for (const it of items) {
        const p = it.product;
        if (!p) continue;
        // Actual package weight (fall back to product weight if the package weight is unset).
        const actual = p.packageWeightKg != null ? Number(p.packageWeightKg) : p.productWeightKg != null ? Number(p.productWeightKg) : null;
        // Volumetric weight = (L × W × H) / 5000.
        const vol = p.packageLengthCm != null && p.packageWidthCm != null && p.packageHeightCm != null
          ? (Number(p.packageLengthCm) * Number(p.packageWidthCm) * Number(p.packageHeightCm)) / 5000
          : null;
        let unit: number | null;
        if (method === 'actual_weight') {
          unit = actual;
        } else {
          // Volumetric services charge on the greater of volumetric and actual weight.
          unit = vol != null && actual != null ? Math.max(vol, actual) : vol ?? actual;
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

    // --- Actual shipment costs (operations records these; they override the estimate) ---
    // Actual shipping cost = company-borne outbound shipments (in EUR). Duty and any
    // company-borne inbound (return) shipping are added as extra costs.
    const shipments = t.shipments ?? [];
    const hasOutbound = shipments.some((s: any) => s.type === 'outbound');
    const actualShippingCost = hasOutbound
      ? round(shipments.filter((s: any) => s.type === 'outbound' && s.costBorneBy === 'company').reduce((sum: number, s: any) => sum + n(s.shippingCostEur), 0), 2)
      : null;
    const returnShippingCost = round(shipments.filter((s: any) => s.type === 'inbound' && s.costBorneBy === 'company').reduce((sum: number, s: any) => sum + n(s.shippingCostEur), 0), 2);
    const dutyImportCost = round(shipments.reduce((sum: number, s: any) => sum + n(s.dutyImportEur), 0), 2);
    // The shipping cost used in the profit calc: actual (when a shipment exists) else estimated.
    const shippingCostSource: 'actual' | 'estimated' = actualShippingCost != null ? 'actual' : 'estimated';
    const effectiveShippingCost = actualShippingCost != null ? actualShippingCost : estimatedShippingCost;

    // --- Order resolution (returns / cancellations / refunds) ---
    const resolution: string = t.resolution ?? 'none';
    const fxRate = t.exchangeRate;
    const feeFx = t.feeExchangeRate ?? t.exchangeRate;
    // Refund reverses our revenue (net + shipping portion, exc VAT), in native currency.
    const refundEur = t.refundAmount != null && fxRate != null ? round(n(t.refundAmount) * fxRate, 2) : 0;
    // Cancelled before anything shipped → goods never left: no COGS, no shipping.
    const cancelledPreShip = resolution === 'cancelled' && !hasOutbound;
    // COGS is reversed when goods never left, or came back resellable (restock).
    const cogsReversed = cancelledPreShip || (resolution !== 'none' && !!t.restockItems);
    const shippingApplies = !cancelledPreShip;

    // Profit (€): (net + shipping in EUR) − refund − (product cost + effective shipping +
    // return shipping we bear + duty + sales fee in EUR), adjusted for the resolution.
    let profit: number | null = null;
    if (fxRate != null) {
      let revenue = 0;
      let cost = 0;
      for (const it of items) {
        revenue += (n(it.netSalesAmount) + n(it.shippingAmount)) * fxRate;
        if (!cogsReversed) {
          const unitCost = it.product?.purchaseCostAmount != null ? Number(it.product.purchaseCostAmount) : 0;
          cost += unitCost * (it.quantity ?? 1);
        }
        if (!t.feeRefunded) cost += n(it.salesChannelSalesFeeAmount) * (feeFx ?? fxRate);
      }
      revenue -= refundEur;
      if (shippingApplies) cost += effectiveShippingCost ?? 0;
      cost += returnShippingCost + dutyImportCost; // real spends regardless of resolution
      profit = round(revenue - cost, 2);
    }

    // Profit (%): profit € / total transaction amount in € (net + VAT + shipping + shipping VAT).
    const totalEur = fxRate != null ? feeBase * fxRate : null;
    const profitPct = profit != null && totalEur != null && totalEur > 0 ? round((profit / totalEur) * 100, 2) : null;

    // EUR revenue/fee figures for analytics (revenue is gross of refunds; profit is net).
    const revenueExVatEur = fxRate != null ? round((totals.netSales + totals.shipping) * fxRate, 2) : null;
    const revenueIncVatEur = fxRate != null ? round(feeBase * fxRate, 2) : null;
    const feesEur = fxRate != null ? round(totals.fee * (feeFx ?? fxRate) * (t.feeRefunded ? 0 : 1), 2) : null;

    // Per-item (SKU) economics: transaction-level shipping/duty/refund are allocated to
    // items by revenue share so per-SKU figures sum back to the transaction totals.
    const totalRevExVatNative = items.reduce((s: number, it: any) => s + n(it.netSalesAmount) + n(it.shippingAmount), 0);
    const sharedCostEur = (shippingApplies ? effectiveShippingCost ?? 0 : 0) + returnShippingCost + dutyImportCost;
    const itemEcon = items.map((it: any) => {
      const revNative = n(it.netSalesAmount) + n(it.shippingAmount);
      const w = totalRevExVatNative > 0 ? revNative / totalRevExVatNative : items.length ? 1 / items.length : 0;
      const revExVatEur = fxRate != null ? round(revNative * fxRate, 2) : null;
      const revIncVatEur = fxRate != null ? round((n(it.netSalesAmount) + n(it.vatAmount) + n(it.shippingAmount) + n(it.shippingAmountVat)) * fxRate, 2) : null;
      const fEur = fxRate != null ? round((t.feeRefunded ? 0 : n(it.salesChannelSalesFeeAmount)) * (feeFx ?? fxRate), 2) : null;
      const unitCost = it.product?.purchaseCostAmount != null ? Number(it.product.purchaseCostAmount) : 0;
      const cEur = cogsReversed ? 0 : round(unitCost * (it.quantity ?? 1), 2);
      const pEur = fxRate != null ? round((revExVatEur ?? 0) - refundEur * w - cEur - (fEur ?? 0) - sharedCostEur * w, 2) : null;
      return { revExVatEur, revIncVatEur, fEur, cEur, pEur };
    });

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
      feeExchangeRate: t.feeExchangeRate,
      status: t.status,
      unlockedForEdit: t.unlockedForEdit,
      hasPendingUnlock: (t.unlockRequests ?? []).length > 0,
      salesFeePct,
      destinationCountryVatPct,
      vatOverridden: t.vatOverridden,
      overallPackageWeight,
      estimatedShippingCost,
      actualShippingCost,
      shippingCostSource,
      returnShippingCost,
      dutyImportCost,
      fulfilmentStatus: t.fulfilmentStatus,
      resolution,
      refundAmount: t.refundAmount,
      refundEur,
      restockItems: t.restockItems,
      feeRefunded: t.feeRefunded,
      resolutionNotes: t.resolutionNotes,
      shipped: hasOutbound, // has a recorded outbound shipment
      shipments: shipments.map((s: any) => ({
        id: s.id,
        type: s.type,
        shipmentDate: s.shipmentDate,
        shippingService: s.shippingService ?? null,
        trackingNumber: s.trackingNumber,
        shippingCostEur: s.shippingCostEur,
        costBorneBy: s.costBorneBy,
        dutyImportEur: s.dutyImportEur,
        comments: s.comments,
      })),
      profit,
      profitPct,
      revenueExVatEur,
      revenueIncVatEur,
      feesEur,
      items: items.map((it: any, idx: number) => ({
        id: it.id,
        productId: it.productId,
        productTitle: it.product?.title ?? null,
        sku: it.sku,
        quantity: it.quantity,
        netSalesAmount: it.netSalesAmount,
        vatAmount: it.vatAmount,
        shippingAmount: it.shippingAmount,
        shippingAmountVat: it.shippingAmountVat,
        salesChannelSalesFeeAmount: it.salesChannelSalesFeeAmount,
        revenueExVatEur: itemEcon[idx].revExVatEur,
        revenueIncVatEur: itemEcon[idx].revIncVatEur,
        feesEur: itemEcon[idx].fEur,
        cogsEur: itemEcon[idx].cEur,
        profitEur: itemEcon[idx].pEur,
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
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { transactionRef: { contains: query.q, mode: 'insensitive' } },
              { items: { some: { deletedAt: null, sku: { contains: query.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const dir = query.sortDir === 'asc' ? 1 : -1;
    const sortBy = query.sortBy === 'profit' || query.sortBy === 'profitPct' ? query.sortBy : 'date';

    // Profit / profit % are computed fields, so sorting or filtering by them happens
    // in memory over the whole filtered set before paginating.
    if (sortBy !== 'date' || query.profitTierId) {
      const rows = await this.prisma.salesTransaction.findMany({ where, include, orderBy: { date: query.sortDir === 'asc' ? 'asc' : 'desc' } });
      const serviceMap = await this.buildServiceMap();
      let all = rows.map((r) => this.serialize(r, serviceMap));
      if (query.profitTierId) {
        const tier = await this.prisma.profitTier.findUnique({ where: { id: query.profitTierId } });
        if (tier) {
          all = all.filter((t: any) => t.profitPct != null && t.profitPct >= Number(tier.fromPct) && t.profitPct <= Number(tier.toPct));
        }
      }
      if (sortBy !== 'date') {
        all.sort((a: any, b: any) => {
          const av = a[sortBy]; const bv = b[sortBy];
          if (av == null && bv == null) return 0;
          if (av == null) return 1; // nulls last regardless of direction
          if (bv == null) return -1;
          return (av - bv) * dir;
        });
      }
      return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesTransaction.count({ where }),
      this.prisma.salesTransaction.findMany({ where, include, orderBy: { date: dir === 1 ? 'asc' : 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
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

  /** All serialized transactions in a date range (for analytics/reporting). */
  async allInRange(from: Date, to: Date, companyId?: string) {
    const rows = await this.prisma.salesTransaction.findMany({
      where: { deletedAt: null, date: { gte: from, lte: to }, ...(companyId ? { companyId } : {}) },
      include,
      orderBy: { date: 'asc' },
    });
    const serviceMap = await this.buildServiceMap();
    return rows.map((r) => this.serialize(r, serviceMap));
  }

  /** Shipping services with zones (countries + rates) for shipping-cost estimation. */
  private async buildServiceMap() {
    const services = await this.prisma.shippingService.findMany({
      where: { deletedAt: null },
      include: { zones: { where: { deletedAt: null }, include: { countries: true, rates: { where: { deletedAt: null } } } } },
    });
    return new Map<string, any>(services.map((s) => [s.id, s]));
  }

  private async countryVatRate(countryId: string | null): Promise<number | null> {
    if (!countryId) return null;
    const c = await this.prisma.country.findUnique({ where: { id: countryId }, select: { vatRate: true } });
    return c ? Number(c.vatRate) : null;
  }

  private async resolveShippingService(explicit: string | null | undefined, countryId: string | null) {
    if (explicit) return explicit; // an explicit service was chosen
    // Otherwise fall back to the destination country's default shipping service.
    if (!countryId) return null;
    const c = await this.prisma.country.findUnique({ where: { id: countryId }, select: { defaultShippingServiceId: true } });
    return c?.defaultShippingServiceId ?? null;
  }

  // USD-pegged currencies the ECB (Frankfurter) doesn't publish — derived via USD.
  private static readonly USD_PEG: Record<string, number> = { AED: 3.6725, SAR: 3.75 };

  /** Raw currency -> EUR from the free Frankfurter (ECB) API for a given date. */
  private async frankfurterRate(currency: string, date: string): Promise<number | null> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const d = date.slice(0, 10);
      const endpoint = d > today ? 'latest' : d;
      const res = await fetch(`https://api.frankfurter.app/${endpoint}?from=${currency}&to=EUR`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const json: any = await res.json();
      const rate = json?.rates?.EUR;
      return typeof rate === 'number' ? rate : null;
    } catch {
      return null;
    }
  }

  /** channel currency -> EUR at the transaction date. ECB currencies come from
   *  Frankfurter directly; USD-pegged ones (AED, SAR) are derived from USD. */
  private async fetchExchangeRate(currency: string | null, date: string): Promise<number | null> {
    if (!currency) return null;
    const cur = currency.toUpperCase();
    if (cur === 'EUR') return 1;
    const peg = SalesTransactionsService.USD_PEG[cur];
    if (peg) {
      const usdEur = await this.frankfurterRate('USD', date);
      return usdEur != null ? round(usdEur / peg, 6) : null;
    }
    const rate = await this.frankfurterRate(cur, date);
    return rate != null ? round(rate, 6) : null;
  }

  /** Sales channel row plus its native/fee currencies (snapshotted on the transaction). */
  private async channelInfo(salesChannelId?: string | null) {
    const channel = salesChannelId ? await this.prisma.salesChannel.findUnique({ where: { id: salesChannelId } }) : null;
    const currency = channel?.nativeCurrency ?? null;
    const feeCurrency = channel ? (channel.feeChargedInNativeCurrency ? channel.nativeCurrency ?? null : channel.feeCurrency ?? null) : null;
    return { channel, currency, feeCurrency };
  }

  /** Marketplace VAT threshold rule (e.g. UK £135): the applicable VAT % or null if off. */
  private channelVatPct(channel: any, overallValue: number): number | null {
    if (!channel?.vatThresholdEnabled || channel.vatThresholdAmount == null) return null;
    return overallValue <= Number(channel.vatThresholdAmount)
      ? channel.vatBelowThresholdPct ?? null
      : channel.vatAboveThresholdPct ?? null;
  }

  /** Destination VAT %: user override → channel threshold rule → country rate. */
  private async resolveDestinationVat(
    dto: { vatOverridden?: boolean; destinationVatPct?: number | null },
    channel: any,
    overallValue: number,
    destCountryId: string | null,
  ): Promise<{ pct: number | null; overridden: boolean }> {
    if (dto.vatOverridden && dto.destinationVatPct != null) return { pct: dto.destinationVatPct, overridden: true };
    const ruleVat = this.channelVatPct(channel, overallValue);
    if (ruleVat != null) return { pct: ruleVat, overridden: false };
    return { pct: await this.countryVatRate(destCountryId), overridden: false };
  }

  async create(dto: CreateSalesTransactionDto, actorId?: string) {
    const { channel, currency, feeCurrency } = await this.channelInfo(dto.salesChannelId);
    const shippingServiceId = await this.resolveShippingService(dto.shippingServiceId, dto.destinationCountryId ?? null);
    const exchangeRate = await this.fetchExchangeRate(currency, dto.date);
    const feeExchangeRate = feeCurrency && feeCurrency !== currency ? await this.fetchExchangeRate(feeCurrency, dto.date) : exchangeRate;
    const overall = (dto.items ?? []).reduce((s, i) => s + n(i.netSalesAmount) + n(i.vatAmount) + n(i.shippingAmount) + n(i.shippingAmountVat), 0);
    const { pct: destinationVatPct, overridden: vatOverridden } = await this.resolveDestinationVat(dto, channel, overall, dto.destinationCountryId ?? null);
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
        feeExchangeRate,
        destinationVatPct,
        vatOverridden,
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
    const existing = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null }, include: { items: { where: { deletedAt: null } } } });
    if (!existing) throw new NotFoundException('Sales transaction not found');
    this.assertCanEdit(existing, user);

    const channelId = dto.salesChannelId === undefined ? existing.salesChannelId : dto.salesChannelId;
    const { channel, currency, feeCurrency } = await this.channelInfo(channelId);
    const nextStatus = dto.status ?? existing.status;
    // Submitting re-locks it (unless the actor is an admin, who always retains access).
    const unlockedForEdit = nextStatus === 'submitted' ? false : existing.unlockedForEdit;
    const txDate = dto.date ?? existing.date.toISOString();
    const exchangeRate = await this.fetchExchangeRate(currency, txDate);
    const feeExchangeRate = feeCurrency && feeCurrency !== currency ? await this.fetchExchangeRate(feeCurrency, txDate) : exchangeRate;
    const destCountryId = dto.destinationCountryId === undefined ? existing.destinationCountryId : dto.destinationCountryId;
    const resolvedServiceId = await this.resolveShippingService(dto.shippingServiceId, destCountryId);
    const overall = (dto.items ?? existing.items).reduce((s: number, i: any) => s + n(i.netSalesAmount) + n(i.vatAmount) + n(i.shippingAmount) + n(i.shippingAmountVat), 0);
    const { pct: destinationVatPct, overridden: vatOverridden } = await this.resolveDestinationVat(dto, channel, overall, destCountryId);

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
          shippingServiceId: resolvedServiceId,
          currency,
          feeCurrency,
          exchangeRate,
          feeExchangeRate,
          destinationVatPct,
          vatOverridden,
          status: nextStatus,
          unlockedForEdit,
          updatedById: user.sub,
        },
      });
    });
    return this.get(id);
  }

  /** Apply an order resolution (return / cancellation / refund). Cancelling also
   *  moves the transaction out of the fulfilment worklist. */
  async resolve(id: string, dto: { resolution: string; refundAmount?: number | null; restockItems?: boolean; feeRefunded?: boolean; resolutionNotes?: string | null }, user: AuthUser) {
    const existing = await this.prisma.salesTransaction.findFirst({ where: { id, deletedAt: null }, select: { id: true, status: true, unlockedForEdit: true, fulfilmentStatus: true } });
    if (!existing) throw new NotFoundException('Sales transaction not found');
    this.assertCanEdit(existing, user);
    const clearing = dto.resolution === 'none';
    await this.prisma.salesTransaction.update({
      where: { id },
      data: {
        resolution: dto.resolution,
        refundAmount: clearing ? null : dto.refundAmount ?? null,
        restockItems: clearing ? false : !!dto.restockItems,
        feeRefunded: clearing ? false : !!dto.feeRefunded,
        resolutionNotes: clearing ? null : dto.resolutionNotes ?? null,
        resolvedAt: clearing ? null : new Date(),
        // Cancelling removes it from the pending worklist; clearing a cancel restores pending.
        ...(dto.resolution === 'cancelled' ? { fulfilmentStatus: 'cancelled' } : {}),
        ...(clearing && existing.fulfilmentStatus === 'cancelled' ? { fulfilmentStatus: 'pending' } : {}),
        updatedById: user.sub,
      },
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

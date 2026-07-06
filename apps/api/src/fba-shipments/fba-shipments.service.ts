import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateFbaShipmentDto, EstimateFbaShipmentDto, FbaShipmentLineDto, UpdateFbaShipmentDto,
} from './dto/fba-shipment.dto';

const VOLUMETRIC_DIVISOR = 5000; // (L×W×H cm) / 5000 = volumetric kg — matches sales-transactions.
const round = (v: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON) * f) / f;
};
const n = (v: any): number | null => (v == null ? null : Number(v));

export interface EstimateLine {
  sku: string;
  productId: string | null;
  title: string | null;
  quantity: number;
  unitWeightKg: number | null; // per-unit basis weight (actual or volumetric per the service)
  lineWeightKg: number | null; // unitWeightKg × quantity
  weightMissing: boolean;
  allocatedCostEur: number | null;
}

export interface EstimateResult {
  calcMethod: string | null;
  salesChannelId: string | null;
  destinationCountryId: string | null;
  destinationCountry: { id: string; name: string; isoCode: string } | null;
  shippingServiceId: string | null;
  shippingZoneId: string | null;
  shippingZoneName: string | null;
  packagingPct: number;
  basisWeightKg: number | null;      // Σ line basis weight, before packaging
  chargeableWeightKg: number | null; // weight used to pick the rate band
  estimatedCostEur: number | null;
  items: EstimateLine[];
  warnings: string[];
}

@Injectable()
export class FbaShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  // --- SKU resolution -------------------------------------------------------
  /** Resolve each line's SKU to a live product (by main SKU or alias, case-insensitive). */
  private async resolveProducts(lines: FbaShipmentLineDto[]) {
    const byId = new Map<string, any>();
    for (const line of lines) {
      const sku = (line.sku ?? '').trim();
      if (!sku && !line.productId) continue;
      let product = null as any;
      if (line.productId) {
        product = await this.prisma.product.findFirst({ where: { id: line.productId, deletedAt: null } });
      }
      if (!product && sku) {
        product = await this.prisma.product.findFirst({
          where: {
            deletedAt: null,
            OR: [
              { mainSku: { equals: sku, mode: 'insensitive' } },
              { aliases: { some: { deletedAt: null, skuValue: { equals: sku, mode: 'insensitive' } } } },
            ],
          },
        });
      }
      byId.set(sku.toLowerCase() || line.productId!, product);
    }
    return byId;
  }

  private unitWeight(product: any, method: string | null): number | null {
    if (!product) return null;
    const actual = product.packageWeightKg != null ? Number(product.packageWeightKg)
      : product.productWeightKg != null ? Number(product.productWeightKg) : null;
    if (method === 'volumetric_weight') {
      const vol = product.packageLengthCm != null && product.packageWidthCm != null && product.packageHeightCm != null
        ? (Number(product.packageLengthCm) * Number(product.packageWidthCm) * Number(product.packageHeightCm)) / VOLUMETRIC_DIVISOR
        : null;
      return vol != null && actual != null ? Math.max(vol, actual) : vol ?? actual;
    }
    return actual;
  }

  // --- Estimate engine (shared by preview + persist) ------------------------
  private async computeEstimate(input: EstimateFbaShipmentDto): Promise<EstimateResult> {
    const warnings: string[] = [];
    const packagingPct = input.packagingPct != null && input.packagingPct >= 0 ? input.packagingPct : 0;

    // Sales channel → native country (the destination).
    const channel = input.salesChannelId
      ? await this.prisma.salesChannel.findFirst({
          where: { id: input.salesChannelId, deletedAt: null },
          include: { nativeCountry: true },
        })
      : null;
    const destinationCountry = channel?.nativeCountry ?? null;
    const destinationCountryId = destinationCountry?.id ?? null;

    // Shipping service with zones (countries + rates) and its calc method.
    const service = input.shippingServiceId
      ? await this.prisma.shippingService.findFirst({
          where: { id: input.shippingServiceId, deletedAt: null },
          include: {
            zones: { where: { deletedAt: null }, include: { countries: true, rates: { where: { deletedAt: null } } } },
          },
        })
      : null;
    const calcMethod = service?.calcMethod ?? null;

    // Resolve products and build per-line basis weights.
    const productMap = await this.resolveProducts(input.items ?? []);
    const items: EstimateLine[] = [];
    let basisWeight = 0;
    let anyWeight = false;
    for (const line of input.items ?? []) {
      const key = (line.sku ?? '').trim().toLowerCase() || line.productId || '';
      const product = productMap.get(key) ?? null;
      const qty = line.quantity ?? 1;
      const unit = this.unitWeight(product, calcMethod);
      const lineWeight = unit != null ? round(unit * qty, 3) : null;
      if (unit != null) { basisWeight += unit * qty; anyWeight = true; }
      items.push({
        sku: line.sku,
        productId: product?.id ?? null,
        title: product?.title ?? null,
        quantity: qty,
        unitWeightKg: unit != null ? round(unit, 3) : null,
        lineWeightKg: lineWeight,
        weightMissing: product == null || unit == null,
        allocatedCostEur: null,
      });
    }
    const basisWeightKg = anyWeight ? round(basisWeight, 3) : null;

    // Packaging uplift applies to actual-weight services only (volumetric already
    // reflects box size). Round nothing here — the rate band picks the "upper" range.
    const chargeableWeightKg = basisWeightKg == null ? null
      : calcMethod === 'actual_weight' ? round(basisWeightKg * (1 + packagingPct / 100), 3)
      : basisWeightKg;

    // Zone: the service zone whose countries include the destination.
    let shippingZoneId: string | null = null;
    let shippingZoneName: string | null = null;
    let estimatedCostEur: number | null = null;
    if (service && destinationCountryId) {
      const zone = (service.zones ?? []).find((z: any) => (z.countries ?? []).some((c: any) => c.countryId === destinationCountryId));
      if (zone) {
        shippingZoneId = zone.id;
        shippingZoneName = zone.name;
        const rates = (zone.rates ?? []).slice().sort((a: any, b: any) => Number(a.fromWeightKg) - Number(b.fromWeightKg));
        if (rates.length && chargeableWeightKg != null) {
          const w = chargeableWeightKg;
          // Closest upper band: the lightest band whose upper bound covers the weight;
          // clamp under the lightest / over the heaviest so a cost is always found.
          const covering = rates.find((r: any) => w <= Number(r.toWeightKg));
          const chosen = covering ?? rates[rates.length - 1];
          estimatedCostEur = Number(chosen.chargeEur);
        } else if (!rates.length) {
          warnings.push('The destination zone has no weight-band rates configured.');
        }
      } else {
        warnings.push('The destination country is not mapped to a zone for this shipping service.');
      }
    }
    if (!service) warnings.push('Select a shipping service to estimate the cost.');
    if (!destinationCountryId && input.salesChannelId) warnings.push('The selected sales channel has no native country set.');
    if (items.some((i) => i.weightMissing)) warnings.push('Some SKUs have no matching product or missing weight/dimensions — they are excluded from the weight.');

    // Allocate the effective cost across lines by their weight×qty share.
    this.allocate(items, basisWeightKg, estimatedCostEur);

    return {
      calcMethod,
      salesChannelId: input.salesChannelId ?? null,
      destinationCountryId,
      destinationCountry: destinationCountry ? { id: destinationCountry.id, name: destinationCountry.name, isoCode: destinationCountry.isoCode } : null,
      shippingServiceId: input.shippingServiceId ?? null,
      shippingZoneId,
      shippingZoneName,
      packagingPct,
      basisWeightKg,
      chargeableWeightKg,
      estimatedCostEur,
      items,
      warnings,
    };
  }

  /** Distribute `cost` across lines proportional to lineWeight (weight × qty). Mutates items. */
  private allocate(items: EstimateLine[], totalWeight: number | null, cost: number | null) {
    if (cost == null || !totalWeight || totalWeight <= 0) {
      for (const it of items) it.allocatedCostEur = null;
      return;
    }
    for (const it of items) {
      const w = it.lineWeightKg ?? 0;
      it.allocatedCostEur = round((w / totalWeight) * cost, 4);
    }
  }

  // --- Public: preview -------------------------------------------------------
  estimate(input: EstimateFbaShipmentDto) {
    return this.computeEstimate(input);
  }

  // --- Serialize a persisted shipment ---------------------------------------
  private serialize(s: any) {
    return {
      id: s.id,
      date: s.date,
      salesChannelId: s.salesChannelId,
      salesChannel: s.salesChannel ? { id: s.salesChannel.id, name: s.salesChannel.name } : null,
      destinationCountryId: s.destinationCountryId,
      destinationCountry: s.destinationCountry ? { id: s.destinationCountry.id, name: s.destinationCountry.name, isoCode: s.destinationCountry.isoCode } : null,
      fbaShipmentRef: s.fbaShipmentRef,
      shippingServiceId: s.shippingServiceId,
      shippingService: s.shippingService ? { id: s.shippingService.id, name: s.shippingService.name, calcMethod: s.shippingService.calcMethod } : null,
      shippingZoneId: s.shippingZoneId,
      shippingZone: s.shippingZone ? { id: s.shippingZone.id, name: s.shippingZone.name } : null,
      calcMethod: s.calcMethod,
      packagingPct: n(s.packagingPct),
      basisWeightKg: n(s.basisWeightKg),
      chargeableWeightKg: n(s.chargeableWeightKg),
      estimatedCostEur: n(s.estimatedCostEur),
      actualCostEur: n(s.actualCostEur),
      effectiveCostEur: s.actualCostEur != null ? n(s.actualCostEur) : n(s.estimatedCostEur),
      costSource: s.actualCostEur != null ? 'actual' : 'estimated',
      status: s.status,
      comments: s.comments,
      itemCount: (s.items ?? []).length,
      quantity: (s.items ?? []).reduce((sum: number, it: any) => sum + (it.quantity ?? 0), 0),
      items: (s.items ?? []).map((it: any) => ({
        id: it.id,
        productId: it.productId,
        sku: it.sku,
        title: it.title ?? it.product?.title ?? null,
        quantity: it.quantity,
        unitWeightKg: n(it.unitWeightKg),
        lineWeightKg: it.unitWeightKg != null ? round(Number(it.unitWeightKg) * (it.quantity ?? 1), 3) : null,
        allocatedCostEur: n(it.allocatedCostEur),
      })),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  private readonly include = {
    salesChannel: { select: { id: true, name: true } },
    destinationCountry: { select: { id: true, name: true, isoCode: true } },
    shippingService: { select: { id: true, name: true, calcMethod: true } },
    shippingZone: { select: { id: true, name: true } },
    items: { where: { deletedAt: null }, include: { product: { select: { id: true, title: true } } } },
  };

  // --- CRUD ------------------------------------------------------------------
  async list(query: { q?: string; salesChannelId?: string; status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const and: any[] = [{ deletedAt: null }];
    if (query.salesChannelId) and.push({ salesChannelId: query.salesChannelId });
    if (query.status) and.push({ status: query.status });
    const q = query.q?.trim();
    if (q) {
      and.push({
        OR: [
          { fbaShipmentRef: { contains: q, mode: 'insensitive' } },
          { items: { some: { sku: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    const where = { AND: and };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fbaShipment.count({ where }),
      this.prisma.fbaShipment.findMany({ where, include: this.include, orderBy: { date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items: rows.map((r) => this.serialize(r)), total, page, pageSize };
  }

  async get(id: string) {
    const s = await this.prisma.fbaShipment.findFirst({ where: { id, deletedAt: null }, include: this.include });
    if (!s) throw new NotFoundException('FBA shipment not found');
    return this.serialize(s);
  }

  private itemsCreateData(est: EstimateResult) {
    return est.items.map((it) => ({
      productId: it.productId,
      sku: it.sku,
      title: it.title,
      quantity: it.quantity,
      unitWeightKg: it.unitWeightKg,
      allocatedCostEur: it.allocatedCostEur,
    }));
  }

  async create(dto: CreateFbaShipmentDto, actorId?: string) {
    const est = await this.computeEstimate(dto);
    const created = await this.prisma.fbaShipment.create({
      data: {
        date: dto.date ? new Date(dto.date) : new Date(),
        salesChannelId: dto.salesChannelId ?? null,
        destinationCountryId: est.destinationCountryId,
        fbaShipmentRef: dto.fbaShipmentRef?.trim() || null,
        shippingServiceId: dto.shippingServiceId ?? null,
        shippingZoneId: est.shippingZoneId,
        calcMethod: est.calcMethod,
        packagingPct: est.packagingPct,
        basisWeightKg: est.basisWeightKg,
        chargeableWeightKg: est.chargeableWeightKg,
        estimatedCostEur: est.estimatedCostEur,
        status: dto.status ?? 'draft',
        comments: dto.comments?.trim() || null,
        createdById: actorId,
        updatedById: actorId,
        items: { create: this.itemsCreateData(est) },
      },
      include: this.include,
    });
    return this.serialize(created);
  }

  async update(id: string, dto: UpdateFbaShipmentDto, actorId?: string) {
    await this.get(id);
    const est = await this.computeEstimate(dto);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.fbaShipmentItem.deleteMany({ where: { shipmentId: id } });
      return tx.fbaShipment.update({
        where: { id },
        data: {
          date: dto.date ? new Date(dto.date) : undefined,
          salesChannelId: dto.salesChannelId ?? null,
          destinationCountryId: est.destinationCountryId,
          fbaShipmentRef: dto.fbaShipmentRef?.trim() || null,
          shippingServiceId: dto.shippingServiceId ?? null,
          shippingZoneId: est.shippingZoneId,
          calcMethod: est.calcMethod,
          packagingPct: est.packagingPct,
          basisWeightKg: est.basisWeightKg,
          chargeableWeightKg: est.chargeableWeightKg,
          estimatedCostEur: est.estimatedCostEur,
          status: dto.status ?? undefined,
          comments: dto.comments?.trim() || null,
          updatedById: actorId,
          items: { create: this.itemsCreateData(est) },
        },
        include: this.include,
      });
    });
    return this.serialize(updated);
  }

  async setStatus(id: string, status: 'draft' | 'confirmed', actorId?: string) {
    await this.get(id);
    const s = await this.prisma.fbaShipment.update({ where: { id }, data: { status, updatedById: actorId }, include: this.include });
    return this.serialize(s);
  }

  /** Register the actual shipping cost; re-allocate each line by its weight share. */
  async setActualCost(id: string, actualCostEur: number, actorId?: string) {
    const existing = await this.prisma.fbaShipment.findFirst({ where: { id, deletedAt: null }, include: this.include });
    if (!existing) throw new NotFoundException('FBA shipment not found');
    const totalWeight = (existing.items ?? []).reduce(
      (sum: number, it: any) => sum + (it.unitWeightKg != null ? Number(it.unitWeightKg) * (it.quantity ?? 1) : 0), 0);
    const s = await this.prisma.$transaction(async (tx) => {
      for (const it of existing.items ?? []) {
        const lineW = it.unitWeightKg != null ? Number(it.unitWeightKg) * (it.quantity ?? 1) : 0;
        const alloc = totalWeight > 0 ? round((lineW / totalWeight) * actualCostEur, 4) : null;
        await tx.fbaShipmentItem.update({ where: { id: it.id }, data: { allocatedCostEur: alloc } });
      }
      return tx.fbaShipment.update({ where: { id }, data: { actualCostEur, updatedById: actorId }, include: this.include });
    });
    return this.serialize(s);
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.fbaShipment.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  // --- Per-SKU average inbound cost (feeds FBA order profit later) -----------
  /** Average allocated inbound cost per unit for a product on a sales channel,
   *  across all CONFIRMED shipments. Uses actual cost when registered, else estimate. */
  async averageForProduct(productId: string, salesChannelId?: string) {
    const items = await this.prisma.fbaShipmentItem.findMany({
      where: {
        deletedAt: null,
        productId,
        shipment: { deletedAt: null, status: 'confirmed', ...(salesChannelId ? { salesChannelId } : {}) },
      },
      include: { shipment: { select: { estimatedCostEur: true, actualCostEur: true } } },
    });
    let totalCost = 0;
    let totalQty = 0;
    for (const it of items) {
      const qty = it.quantity ?? 0;
      totalQty += qty;
      // allocatedCostEur already reflects actual-vs-estimate (re-allocated on setActualCost).
      totalCost += it.allocatedCostEur != null ? Number(it.allocatedCostEur) : 0;
    }
    return {
      productId,
      salesChannelId: salesChannelId ?? null,
      shipmentCount: new Set(items.map((i) => i.shipmentId)).size,
      totalQuantity: totalQty,
      totalAllocatedCostEur: round(totalCost, 4),
      averageCostPerUnitEur: totalQty > 0 ? round(totalCost / totalQty, 4) : null,
    };
  }
}

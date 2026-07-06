import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateFbaShipmentDto, EstimateFbaShipmentDto, FbaShipmentBoxDto, UpdateFbaShipmentDto,
} from './dto/fba-shipment.dto';

const VOLUMETRIC_DIVISOR = 5000; // (L×W×H cm) / 5000 = volumetric kg — matches sales-transactions.
const round = (v: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON) * f) / f;
};
const n = (v: any): number | null => (v == null ? null : Number(v));
const num = (v: any): number | null => {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

export interface EstimateLine {
  sku: string;
  productId: string | null;
  title: string | null;
  quantity: number;
  unitWeightKg: number | null;  // per-unit allocation basis (actual or volumetric per the service)
  lineWeightKg: number | null;  // unitWeightKg × quantity
  weightMissing: boolean;
  allocatedCostEur: number | null;         // total for the line
  allocatedCostPerUnitEur: number | null;  // per individual product = allocated / quantity
}

export interface EstimateBox {
  label: string | null;
  emptyWeightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  trackingNumber: string | null;
  volumetricWeightKg: number | null; // box L×W×H / 5000
  items: EstimateLine[];
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
  productWeightKg: number | null;        // Σ product weight × qty (physical)
  emptyBoxesWeightKg: number | null;     // Σ box empty weights
  boxesVolumetricWeightKg: number | null; // Σ box volumetric weights
  chargeableWeightKg: number | null;     // weight used to pick the rate band
  estimatedCostEur: number | null;
  boxes: EstimateBox[];
  allocation: EstimateLine[];            // aggregated per product (for Tab 3)
  warnings: string[];
}

@Injectable()
export class FbaShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve each line's SKU to a live product (by main SKU or alias, case-insensitive). */
  private async resolveProducts(boxes: FbaShipmentBoxDto[]) {
    const map = new Map<string, any>();
    const keyFor = (line: { sku?: string; productId?: string | null }) =>
      (line.sku ?? '').trim().toLowerCase() || line.productId || '';
    const seen = new Set<string>();
    for (const box of boxes ?? []) {
      for (const line of box.items ?? []) {
        const key = keyFor(line);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const sku = (line.sku ?? '').trim();
        let product = null as any;
        if (line.productId) product = await this.prisma.product.findFirst({ where: { id: line.productId, deletedAt: null } });
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
        map.set(key, product);
      }
    }
    return map;
  }

  private productActualWeight(p: any): number | null {
    if (!p) return null;
    return p.packageWeightKg != null ? Number(p.packageWeightKg) : p.productWeightKg != null ? Number(p.productWeightKg) : null;
  }

  /** Per-unit allocation basis: actual weight, or volumetric (product dims) for volumetric services. */
  private allocationUnit(p: any, method: string | null): number | null {
    const actual = this.productActualWeight(p);
    if (method === 'volumetric_weight') {
      const vol = p?.packageLengthCm != null && p?.packageWidthCm != null && p?.packageHeightCm != null
        ? (Number(p.packageLengthCm) * Number(p.packageWidthCm) * Number(p.packageHeightCm)) / VOLUMETRIC_DIVISOR
        : null;
      return vol != null && actual != null ? Math.max(vol, actual) : vol ?? actual;
    }
    return actual;
  }

  private boxVolumetric(box: FbaShipmentBoxDto): number | null {
    const l = num(box.lengthCm), w = num(box.widthCm), h = num(box.heightCm);
    return l != null && w != null && h != null ? (l * w * h) / VOLUMETRIC_DIVISOR : null;
  }

  // --- Estimate engine (shared by preview + persist) ------------------------
  private async computeEstimate(input: EstimateFbaShipmentDto): Promise<EstimateResult> {
    const warnings: string[] = [];
    const packagingPct = input.packagingPct != null && input.packagingPct >= 0 ? input.packagingPct : 0;

    const channel = input.salesChannelId
      ? await this.prisma.salesChannel.findFirst({ where: { id: input.salesChannelId, deletedAt: null }, include: { nativeCountry: true } })
      : null;
    const destinationCountry = channel?.nativeCountry ?? null;
    const destinationCountryId = destinationCountry?.id ?? null;

    const service = input.shippingServiceId
      ? await this.prisma.shippingService.findFirst({
          where: { id: input.shippingServiceId, deletedAt: null },
          include: { zones: { where: { deletedAt: null }, include: { countries: true, rates: { where: { deletedAt: null } } } } },
        })
      : null;
    const calcMethod = service?.calcMethod ?? null;

    const productMap = await this.resolveProducts(input.boxes ?? []);

    let productWeight = 0;      // Σ product actual weight × qty (physical)
    let emptyBoxesWeight = 0;
    let boxesVolumetric = 0;
    let anyProductWeight = false;
    let anyMissing = false;

    const boxes: EstimateBox[] = (input.boxes ?? []).map((box, bi) => {
      const emptyW = num(box.emptyWeightKg);
      if (emptyW != null) emptyBoxesWeight += emptyW;
      const boxVol = this.boxVolumetric(box);
      if (boxVol != null) boxesVolumetric += boxVol;

      const items: EstimateLine[] = (box.items ?? []).map((line) => {
        const key = (line.sku ?? '').trim().toLowerCase() || line.productId || '';
        const product = productMap.get(key) ?? null;
        const qty = line.quantity ?? 1;
        const actualUnit = this.productActualWeight(product);
        if (actualUnit != null) { productWeight += actualUnit * qty; anyProductWeight = true; }
        const basisUnit = this.allocationUnit(product, calcMethod);
        const missing = product == null || basisUnit == null;
        if (missing) anyMissing = true;
        return {
          sku: line.sku,
          productId: product?.id ?? null,
          title: product?.title ?? null,
          quantity: qty,
          unitWeightKg: basisUnit != null ? round(basisUnit, 3) : null,
          lineWeightKg: basisUnit != null ? round(basisUnit * qty, 3) : null,
          weightMissing: missing,
          allocatedCostEur: null,
          allocatedCostPerUnitEur: null,
        };
      });

      return {
        label: box.label ?? `Box ${bi + 1}`,
        emptyWeightKg: emptyW,
        lengthCm: num(box.lengthCm),
        widthCm: num(box.widthCm),
        heightCm: num(box.heightCm),
        trackingNumber: box.trackingNumber?.trim() || null,
        volumetricWeightKg: boxVol != null ? round(boxVol, 3) : null,
        items,
      };
    });

    const productWeightKg = anyProductWeight ? round(productWeight, 3) : null;
    const emptyBoxesWeightKg = round(emptyBoxesWeight, 3);
    const boxesVolumetricWeightKg = round(boxesVolumetric, 3);

    // Chargeable weight per the service's cost basis:
    // - actual: product weight (+ packaging uplift) + empty box weights
    // - volumetric: greater of the boxes' volumetric weight and the actual total (products + boxes)
    let chargeableWeightKg: number | null = null;
    if (calcMethod === 'actual_weight') {
      if (productWeightKg != null || emptyBoxesWeight > 0) {
        chargeableWeightKg = round((productWeightKg ?? 0) * (1 + packagingPct / 100) + emptyBoxesWeight, 3);
      }
    } else if (calcMethod === 'volumetric_weight') {
      const actualTotal = (productWeightKg ?? 0) + emptyBoxesWeight;
      const chargeable = Math.max(boxesVolumetric, actualTotal);
      if (chargeable > 0) chargeableWeightKg = round(chargeable, 3);
    }

    // Zone → rate band → charge.
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
    if (anyMissing) warnings.push('Some SKUs have no matching product or missing weight/dimensions — they are excluded from the weight.');
    if (calcMethod === 'volumetric_weight' && boxesVolumetric <= 0) warnings.push('No box dimensions entered — volumetric weight cannot be computed.');

    // Allocate the effective cost across all lines by their weight×qty share.
    const allLines = boxes.flatMap((b) => b.items);
    this.allocate(allLines, estimatedCostEur);

    // Aggregate per product for the allocation view (Tab 3).
    const allocation = this.aggregate(allLines);

    return {
      calcMethod,
      salesChannelId: input.salesChannelId ?? null,
      destinationCountryId,
      destinationCountry: destinationCountry ? { id: destinationCountry.id, name: destinationCountry.name, isoCode: destinationCountry.isoCode } : null,
      shippingServiceId: input.shippingServiceId ?? null,
      shippingZoneId,
      shippingZoneName,
      packagingPct,
      productWeightKg,
      emptyBoxesWeightKg,
      boxesVolumetricWeightKg,
      chargeableWeightKg,
      estimatedCostEur,
      boxes,
      allocation,
      warnings,
    };
  }

  /** Distribute `cost` across lines proportional to lineWeight (weight × qty). Mutates lines. */
  private allocate(lines: EstimateLine[], cost: number | null) {
    const total = lines.reduce((s, l) => s + (l.lineWeightKg ?? 0), 0);
    for (const l of lines) {
      if (cost == null || total <= 0) { l.allocatedCostEur = null; l.allocatedCostPerUnitEur = null; continue; }
      const alloc = round(((l.lineWeightKg ?? 0) / total) * cost, 4);
      l.allocatedCostEur = alloc;
      l.allocatedCostPerUnitEur = l.quantity > 0 ? round(alloc / l.quantity, 4) : null;
    }
  }

  /** Combine lines with the same product/SKU across boxes into one allocation row. */
  private aggregate(lines: EstimateLine[]): EstimateLine[] {
    const byKey = new Map<string, EstimateLine>();
    for (const l of lines) {
      const key = l.productId ?? l.sku.toLowerCase();
      const cur = byKey.get(key);
      if (!cur) {
        byKey.set(key, { ...l });
      } else {
        cur.quantity += l.quantity;
        cur.lineWeightKg = round((cur.lineWeightKg ?? 0) + (l.lineWeightKg ?? 0), 3);
        cur.allocatedCostEur = cur.allocatedCostEur != null || l.allocatedCostEur != null
          ? round((cur.allocatedCostEur ?? 0) + (l.allocatedCostEur ?? 0), 4) : null;
        cur.weightMissing = cur.weightMissing || l.weightMissing;
      }
    }
    for (const l of byKey.values()) {
      l.allocatedCostPerUnitEur = l.allocatedCostEur != null && l.quantity > 0 ? round(l.allocatedCostEur / l.quantity, 4) : null;
    }
    return [...byKey.values()];
  }

  estimate(input: EstimateFbaShipmentDto) {
    return this.computeEstimate(input);
  }

  // --- Serialize a persisted shipment ---------------------------------------
  private serializeItem(it: any) {
    const alloc = n(it.allocatedCostEur);
    return {
      id: it.id,
      boxId: it.boxId,
      productId: it.productId,
      sku: it.sku,
      title: it.title ?? it.product?.title ?? null,
      quantity: it.quantity,
      unitWeightKg: n(it.unitWeightKg),
      lineWeightKg: it.unitWeightKg != null ? round(Number(it.unitWeightKg) * (it.quantity ?? 1), 3) : null,
      allocatedCostEur: alloc,
      allocatedCostPerUnitEur: alloc != null && it.quantity > 0 ? round(alloc / it.quantity, 4) : null,
    };
  }

  private serialize(s: any) {
    const boxes = (s.boxes ?? []).map((b: any) => ({
      id: b.id,
      label: b.label,
      emptyWeightKg: n(b.emptyWeightKg),
      lengthCm: n(b.lengthCm),
      widthCm: n(b.widthCm),
      heightCm: n(b.heightCm),
      trackingNumber: b.trackingNumber,
      volumetricWeightKg: b.lengthCm != null && b.widthCm != null && b.heightCm != null
        ? round((Number(b.lengthCm) * Number(b.widthCm) * Number(b.heightCm)) / VOLUMETRIC_DIVISOR, 3) : null,
      items: (b.items ?? []).map((it: any) => this.serializeItem(it)),
    }));
    const allItems = (s.items ?? []).map((it: any) => this.serializeItem(it));
    return {
      id: s.id,
      date: s.date,
      salesChannelId: s.salesChannelId,
      salesChannel: s.salesChannel ? { id: s.salesChannel.id, name: s.salesChannel.name } : null,
      destinationCountryId: s.destinationCountryId,
      destinationCountry: s.destinationCountry ? { id: s.destinationCountry.id, name: s.destinationCountry.name, isoCode: s.destinationCountry.isoCode } : null,
      fbaShipmentRef: s.fbaShipmentRef,
      shippingServiceId: s.shippingServiceId,
      shippingService: s.shippingService ? { id: s.shippingService.id, name: s.shippingService.name, calcMethod: s.shippingService.calcMethod, trackingUrlTemplate: s.shippingService.trackingUrlTemplate ?? null } : null,
      shippingZoneId: s.shippingZoneId,
      shippingZone: s.shippingZone ? { id: s.shippingZone.id, name: s.shippingZone.name } : null,
      calcMethod: s.calcMethod,
      packagingPct: n(s.packagingPct),
      productWeightKg: n(s.basisWeightKg),
      emptyBoxesWeightKg: n(s.emptyBoxesWeightKg),
      chargeableWeightKg: n(s.chargeableWeightKg),
      estimatedCostEur: n(s.estimatedCostEur),
      actualCostEur: n(s.actualCostEur),
      effectiveCostEur: s.actualCostEur != null ? n(s.actualCostEur) : n(s.estimatedCostEur),
      costSource: s.actualCostEur != null ? 'actual' : 'estimated',
      status: s.status,
      comments: s.comments,
      boxCount: boxes.length,
      itemCount: allItems.length,
      quantity: allItems.reduce((sum: number, it: any) => sum + (it.quantity ?? 0), 0),
      boxes,
      allocation: this.aggregate(allItems as any),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  private readonly include = {
    salesChannel: { select: { id: true, name: true } },
    destinationCountry: { select: { id: true, name: true, isoCode: true } },
    shippingService: { select: { id: true, name: true, calcMethod: true, trackingUrlTemplate: true } },
    shippingZone: { select: { id: true, name: true } },
    boxes: {
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' as const },
      include: { items: { where: { deletedAt: null }, include: { product: { select: { id: true, title: true } } } } },
    },
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
          { boxes: { some: { trackingNumber: { contains: q, mode: 'insensitive' } } } },
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

  /** Nested Prisma create for boxes + their items, carrying the shipment id onto items. */
  private boxesCreateData(est: EstimateResult, shipmentId: string) {
    return est.boxes.map((box, bi) => ({
      shipmentId,
      label: box.label,
      emptyWeightKg: box.emptyWeightKg,
      lengthCm: box.lengthCm,
      widthCm: box.widthCm,
      heightCm: box.heightCm,
      trackingNumber: box.trackingNumber,
      sortOrder: bi,
      items: {
        create: box.items.map((it) => ({
          shipmentId,
          productId: it.productId,
          sku: it.sku,
          title: it.title,
          quantity: it.quantity,
          unitWeightKg: it.unitWeightKg,
          allocatedCostEur: it.allocatedCostEur,
        })),
      },
    }));
  }

  private headerData(dto: CreateFbaShipmentDto | UpdateFbaShipmentDto, est: EstimateResult) {
    return {
      salesChannelId: dto.salesChannelId ?? null,
      destinationCountryId: est.destinationCountryId,
      fbaShipmentRef: dto.fbaShipmentRef?.trim() || null,
      shippingServiceId: dto.shippingServiceId ?? null,
      shippingZoneId: est.shippingZoneId,
      calcMethod: est.calcMethod,
      packagingPct: est.packagingPct,
      basisWeightKg: est.productWeightKg,
      emptyBoxesWeightKg: est.emptyBoxesWeightKg,
      chargeableWeightKg: est.chargeableWeightKg,
      estimatedCostEur: est.estimatedCostEur,
      comments: dto.comments?.trim() || null,
    };
  }

  async create(dto: CreateFbaShipmentDto, actorId?: string) {
    const est = await this.computeEstimate(dto);
    const created = await this.prisma.$transaction(async (tx) => {
      const shipment = await tx.fbaShipment.create({
        data: {
          date: dto.date ? new Date(dto.date) : new Date(),
          ...this.headerData(dto, est),
          status: dto.status ?? 'draft',
          createdById: actorId,
          updatedById: actorId,
        },
      });
      for (const box of this.boxesCreateData(est, shipment.id)) {
        await tx.fbaShipmentBox.create({ data: box });
      }
      return shipment.id;
    });
    return this.get(created);
  }

  async update(id: string, dto: UpdateFbaShipmentDto, actorId?: string) {
    await this.get(id);
    const est = await this.computeEstimate(dto);
    await this.prisma.$transaction(async (tx) => {
      await tx.fbaShipmentItem.deleteMany({ where: { shipmentId: id } });
      await tx.fbaShipmentBox.deleteMany({ where: { shipmentId: id } });
      await tx.fbaShipment.update({
        where: { id },
        data: {
          date: dto.date ? new Date(dto.date) : undefined,
          ...this.headerData(dto, est),
          status: dto.status ?? undefined,
          updatedById: actorId,
        },
      });
      for (const box of this.boxesCreateData(est, id)) {
        await tx.fbaShipmentBox.create({ data: box });
      }
    });
    return this.get(id);
  }

  async setStatus(id: string, status: 'draft' | 'confirmed', actorId?: string) {
    await this.get(id);
    await this.prisma.fbaShipment.update({ where: { id }, data: { status, updatedById: actorId } });
    return this.get(id);
  }

  /** Register the actual shipping cost; re-allocate each line by its weight share. */
  async setActualCost(id: string, actualCostEur: number, actorId?: string) {
    const existing = await this.prisma.fbaShipment.findFirst({ where: { id, deletedAt: null }, include: { items: { where: { deletedAt: null } } } });
    if (!existing) throw new NotFoundException('FBA shipment not found');
    const totalWeight = (existing.items ?? []).reduce(
      (sum: number, it: any) => sum + (it.unitWeightKg != null ? Number(it.unitWeightKg) * (it.quantity ?? 1) : 0), 0);
    await this.prisma.$transaction(async (tx) => {
      for (const it of existing.items ?? []) {
        const lineW = it.unitWeightKg != null ? Number(it.unitWeightKg) * (it.quantity ?? 1) : 0;
        const alloc = totalWeight > 0 ? round((lineW / totalWeight) * actualCostEur, 4) : null;
        await tx.fbaShipmentItem.update({ where: { id: it.id }, data: { allocatedCostEur: alloc } });
      }
      await tx.fbaShipment.update({ where: { id }, data: { actualCostEur, updatedById: actorId } });
    });
    return this.get(id);
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
    });
    let totalCost = 0;
    let totalQty = 0;
    for (const it of items) {
      totalQty += it.quantity ?? 0;
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

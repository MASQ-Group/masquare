import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateFbaShipmentDto, EstimateFbaShipmentDto, FbaShipmentBoxDto, UpdateFbaShipmentDto,
} from './dto/fba-shipment.dto';
import type { ProgressSink } from '../jobs/jobs.service';

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
  private readonly logger = new Logger(FbaShipmentsService.name);

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
  async list(query: { q?: string; salesChannelId?: string; status?: string; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number; companyIds?: string[] }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const and: any[] = [{ deletedAt: null }];
    // Company isolation: only shipments owned by a company the user may see.
    if (query.companyIds) and.push({ companyId: { in: query.companyIds } });
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
      this.prisma.fbaShipment.findMany({ where, include: this.include, orderBy: [{ date: query.sortDir === 'asc' ? 'asc' : 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items: rows.map((r) => this.serialize(r)), total, page, pageSize };
  }

  async get(id: string, companyIds?: string[]) {
    const s = await this.prisma.fbaShipment.findFirst({ where: { id, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) }, include: this.include });
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

  async create(dto: CreateFbaShipmentDto, actorId?: string, companyId?: string) {
    const est = await this.computeEstimate(dto);
    const created = await this.prisma.$transaction(async (tx) => {
      const shipment = await tx.fbaShipment.create({
        data: {
          date: dto.date ? new Date(dto.date) : new Date(),
          companyId,
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

  async update(id: string, dto: UpdateFbaShipmentDto, actorId?: string, isAdmin = false, companyIds?: string[]) {
    const before = await this.get(id, companyIds);
    // A confirmed shipment is locked to non-admins (registering the actual cost is separate).
    if (before.status === 'confirmed' && !isAdmin) {
      throw new ForbiddenException('Confirmed FBA shipments can only be edited by an admin.');
    }
    const est = await this.computeEstimate(dto);
    // If an actual cost was already registered, keep allocating the lines to it (by their
    // new weight shares) rather than reverting to the fresh estimate. actualCostEur itself
    // is left untouched below (headerData doesn't include it).
    if (before.actualCostEur != null) {
      const lines = est.boxes.flatMap((b) => b.items);
      this.allocate(lines, before.actualCostEur);
      est.allocation = this.aggregate(lines);
    }
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

  /**
   * Re-resolve a shipment's SKUs against the catalogue as it stands now, and redo the maths.
   *
   * A line's product, title, unit weight and allocated cost are frozen when the shipment is saved.
   * An imported SKU that matched nothing is stored with productId null and no weight — it shows as
   * "unlinked", carries no allocated cost, and contributes nothing to the weight the cost was shared
   * out over. Creating the product afterwards changed none of that, and there was no way to ask for
   * it to be looked at again.
   *
   * Rebuilds the estimate input from what is stored and runs the SAME computeEstimate the save path
   * uses, so a recalculated shipment cannot differ from one imported today with the catalogue in its
   * current state.
   *
   * Dry run unless `confirm`. An actual cost, once registered, is preserved and re-shared over the
   * new weights rather than reverting to a fresh estimate — the money that was really spent does not
   * change because our catalogue improved.
   */
  async recalculate(
    id: string,
    opts: { confirm?: boolean } = {},
    companyIds?: string[],
    actorId?: string,
    isAdmin = false,
  ) {
    const before = await this.get(id, companyIds);
    if (before.status === 'confirmed' && !isAdmin) {
      throw new ForbiddenException('Confirmed FBA shipments can only be recalculated by an admin.');
    }

    // Rebuild the input from stored state. productId is deliberately NOT carried over: a line that
    // resolved to nothing must get a fresh look, and one that resolved before will resolve again.
    const rows = await this.prisma.fbaShipmentBox.findMany({
      where: { shipmentId: id },
      orderBy: { sortOrder: 'asc' },
      include: { items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    });
    const dto: any = {
      date: before.date,
      salesChannelId: before.salesChannelId ?? null,
      fbaShipmentRef: before.fbaShipmentRef ?? null,
      shippingServiceId: before.shippingServiceId ?? null,
      packagingPct: Number(before.packagingPct ?? 0),
      comments: before.comments ?? null,
      boxes: rows.map((b) => ({
        label: b.label,
        emptyWeightKg: b.emptyWeightKg != null ? Number(b.emptyWeightKg) : null,
        lengthCm: b.lengthCm != null ? Number(b.lengthCm) : null,
        widthCm: b.widthCm != null ? Number(b.widthCm) : null,
        heightCm: b.heightCm != null ? Number(b.heightCm) : null,
        trackingNumber: b.trackingNumber,
        items: b.items.map((it) => ({ sku: it.sku, quantity: it.quantity })),
      })),
    };

    const est = await this.computeEstimate(dto);
    if (before.actualCostEur != null) {
      const lines = est.boxes.flatMap((b) => b.items);
      this.allocate(lines, Number(before.actualCostEur));
      est.allocation = this.aggregate(lines);
    }

    const wasUnlinked = rows.flatMap((b) => b.items).filter((it) => it.productId == null).length;
    const stillUnlinked = est.boxes.flatMap((b) => b.items).filter((l) => l.productId == null);
    const nowLinked = wasUnlinked - stillUnlinked.length;

    const summary = {
      wasUnlinked,
      nowLinked,
      stillUnlinked: stillUnlinked.length,
      stillUnlinkedSkus: [...new Set(stillUnlinked.map((l) => l.sku))].slice(0, 50),
      // Weight and cost move when previously-weightless lines start counting, so both are reported:
      // a recalculation that changes the chargeable weight has changed the shipment, not just a label.
      chargeableWeightKg: { before: Number(before.chargeableWeightKg ?? 0), after: est.chargeableWeightKg },
      estimatedCostEur: { before: Number(before.estimatedCostEur ?? 0), after: est.estimatedCostEur },
      costSource: before.actualCostEur != null ? 'actual (preserved)' : 'estimated',
      warnings: est.warnings,
    };

    if (!opts.confirm) return { dryRun: true, shipmentId: id, ...summary };

    await this.prisma.$transaction(async (tx) => {
      await tx.fbaShipmentItem.deleteMany({ where: { shipmentId: id } });
      await tx.fbaShipmentBox.deleteMany({ where: { shipmentId: id } });
      await tx.fbaShipment.update({
        where: { id },
        data: { ...this.headerData(dto, est), updatedById: actorId },
      });
      for (const box of this.boxesCreateData(est, id)) {
        await tx.fbaShipmentBox.create({ data: box });
      }
    });
    this.logger.log(`FBA shipment ${id} recalculated: ${nowLinked} line(s) linked, ${stillUnlinked.length} still unmatched.`);
    return { dryRun: false, shipmentId: id, ...summary, shipment: await this.get(id) };
  }

  /**
   * Recalculate every shipment that still has an unlinked line.
   *
   * After a catalogue clean-up the question is never "recalculate this one" but "which of these are
   * now fixable" — and finding them by hand across a page of shipments is how some get missed.
   */
  async recalculateAll(opts: { confirm?: boolean } = {}, companyIds?: string[], actorId?: string, isAdmin = false, ctx?: ProgressSink) {
    const candidates = await this.prisma.fbaShipment.findMany({
      where: {
        deletedAt: null,
        ...(companyIds ? { companyId: { in: companyIds } } : {}),
        items: { some: { productId: null, deletedAt: null } },
      },
      select: { id: true, fbaShipmentRef: true },
      orderBy: { date: 'desc' },
    });
    ctx?.setTotal(candidates.length);

    const results: any[] = [];
    for (const s of candidates) {
      ctx?.note(s.fbaShipmentRef ?? s.id);
      try {
        const r = await this.recalculate(s.id, opts, companyIds, actorId, isAdmin);
        results.push({ shipmentId: s.id, ref: s.fbaShipmentRef, nowLinked: r.nowLinked, stillUnlinked: r.stillUnlinked });
        ctx?.tick(true);
      } catch (e: any) {
        results.push({ shipmentId: s.id, ref: s.fbaShipmentRef, error: (e?.message ?? 'failed').slice(0, 200) });
        ctx?.tick(false);
      }
    }
    return {
      dryRun: !opts.confirm,
      shipmentsWithUnlinkedLines: candidates.length,
      linked: results.reduce((n, r) => n + (r.nowLinked ?? 0), 0),
      stillUnlinked: results.reduce((n, r) => n + (r.stillUnlinked ?? 0), 0),
      results,
    };
  }

  async setStatus(id: string, status: 'draft' | 'confirmed', actorId?: string, companyIds?: string[]) {
    await this.get(id, companyIds);
    await this.prisma.fbaShipment.update({ where: { id }, data: { status, updatedById: actorId } });
    return this.get(id);
  }

  /** Register the actual shipping cost; re-allocate each line by its weight share. */
  async setActualCost(id: string, actualCostEur: number, actorId?: string, companyIds?: string[]) {
    const existing = await this.prisma.fbaShipment.findFirst({ where: { id, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) }, include: { items: { where: { deletedAt: null } } } });
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

  async remove(id: string, companyIds?: string[]) {
    await this.get(id, companyIds);
    await this.prisma.fbaShipment.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  // --- Per-SKU average inbound cost (feeds FBA order profit later) -----------
  /** Average allocated inbound cost per unit for a product on a sales channel, across all
   *  FBA shipments (draft + confirmed). Uses actual cost when registered, else estimate. */
  async averageForProduct(productId: string, salesChannelId?: string) {
    const items = await this.prisma.fbaShipmentItem.findMany({
      where: {
        deletedAt: null,
        productId,
        shipment: { deletedAt: null, ...(salesChannelId ? { salesChannelId } : {}) },
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

  /** Allocated inbound cost per SKU per sales channel, aggregated across all FBA shipments
   *  (draft + confirmed) — the same figure that feeds FBA order profit. Searchable by SKU,
   *  filterable by sales channel. */
  async skuAllocatedCosts(query: { q?: string; salesChannelId?: string }) {
    const where: any = { deletedAt: null, shipment: { deletedAt: null } };
    if (query.salesChannelId) where.shipment.salesChannelId = query.salesChannelId;
    if (query.q?.trim()) where.sku = { contains: query.q.trim(), mode: 'insensitive' };
    const items = await this.prisma.fbaShipmentItem.findMany({
      where,
      select: {
        sku: true, quantity: true, allocatedCostEur: true,
        product: { select: { id: true, title: true } },
        shipment: { select: { id: true, salesChannelId: true, salesChannel: { select: { name: true } } } },
      },
    });
    const agg = new Map<string, {
      sku: string; productId: string | null; title: string | null;
      salesChannelId: string | null; salesChannelName: string | null;
      totalQuantity: number; totalAllocatedCostEur: number; shipmentIds: Set<string>;
    }>();
    for (const it of items) {
      const channelId = it.shipment?.salesChannelId ?? '';
      const key = `${it.sku.trim().toLowerCase()}::${channelId}`;
      let g = agg.get(key);
      if (!g) {
        g = { sku: it.sku, productId: it.product?.id ?? null, title: it.product?.title ?? null,
          salesChannelId: channelId || null, salesChannelName: it.shipment?.salesChannel?.name ?? null,
          totalQuantity: 0, totalAllocatedCostEur: 0, shipmentIds: new Set() };
        agg.set(key, g);
      }
      g.totalQuantity += it.quantity ?? 0;
      g.totalAllocatedCostEur += it.allocatedCostEur != null ? Number(it.allocatedCostEur) : 0;
      if (it.shipment?.id) g.shipmentIds.add(it.shipment.id);
    }
    return [...agg.values()]
      .map((g) => ({
        sku: g.sku, productId: g.productId, title: g.title,
        salesChannelId: g.salesChannelId, salesChannelName: g.salesChannelName,
        totalQuantity: g.totalQuantity,
        totalAllocatedCostEur: round(g.totalAllocatedCostEur, 2),
        averageCostPerUnitEur: g.totalQuantity > 0 ? round(g.totalAllocatedCostEur / g.totalQuantity, 4) : null,
        shipmentCount: g.shipmentIds.size,
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku) || (a.salesChannelName ?? '').localeCompare(b.salesChannelName ?? ''));
  }

  /** Parse an imported date cell: Excel serial number, ISO YYYY-MM-DD, or DD/MM/YYYY. */
  private parseImportDate(v: string): Date | null {
    const s = (v ?? '').trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) { // Excel serial (days since 1899-12-30)
      const serial = Number(s);
      if (serial > 59 && serial < 100000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000); return isNaN(d.getTime()) ? null : d; }
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
    const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/); // DD/MM/YYYY (global format)
    if (m) {
      const yr = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
      const d = new Date(Date.UTC(yr, Number(m[2]) - 1, Number(m[1])));
      return isNaN(d.getTime()) ? null : d;
    }
    const any = new Date(s);
    return isNaN(any.getTime()) ? null : any;
  }

  /** Import FBA shipments from flat rows (one row per SKU line). Rows sharing a
   *  `fbaShipmentId` form one shipment; within it, rows sharing a `box` form a box.
   *  Shipment/box-level fields are taken from the first row of each group. Imported as
   *  drafts; reuses create() so the estimate + per-SKU allocation run automatically. */
  async importShipments(rows: Record<string, string>[], actorId?: string, companyId?: string) {
    const channels = await this.prisma.salesChannel.findMany({ where: { deletedAt: null, ...(companyId ? { companyId } : {}) }, select: { id: true, name: true } });
    const chByName = new Map(channels.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const services = await this.prisma.shippingService.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
    const svcByName = new Map(services.map((s) => [s.name.trim().toLowerCase(), s.id]));
    const get = (r: Record<string, string>, k: string) => (r[k] == null ? '' : String(r[k]).trim());

    // Group rows into shipments (by FBA Shipment ID), preserving first-seen order.
    const groups = new Map<string, Record<string, string>[]>();
    for (const r of rows) {
      const key = get(r, 'fbaShipmentId');
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    let created = 0;
    const errors: { fbaRef: string; message: string }[] = [];
    for (const [fbaId, grp] of groups) {
      try {
        const first = grp[0];
        const channelName = get(first, 'salesChannel');
        const salesChannelId = chByName.get(channelName.toLowerCase());
        if (!salesChannelId) throw new Error(`Unknown sales channel "${channelName}"`);
        const svcName = get(first, 'shippingService');
        const shippingServiceId = svcName ? (svcByName.get(svcName.toLowerCase()) ?? null) : null;
        const date = this.parseImportDate(get(first, 'date'));
        if (!date) throw new Error(`Invalid or missing date "${get(first, 'date')}"`);
        const pkg = Number(get(first, 'packagingPct'));
        const packagingPct = Number.isFinite(pkg) && get(first, 'packagingPct') !== '' ? pkg : undefined;

        // Group each shipment's rows into boxes.
        const boxOrder: string[] = [];
        const boxMap = new Map<string, any>();
        for (const r of grp) {
          const boxKey = get(r, 'box') || 'Box 1';
          if (!boxMap.has(boxKey)) {
            boxOrder.push(boxKey);
            boxMap.set(boxKey, {
              label: boxKey,
              emptyWeightKg: num(get(r, 'boxEmptyWeightKg')),
              lengthCm: num(get(r, 'boxLengthCm')),
              widthCm: num(get(r, 'boxWidthCm')),
              heightCm: num(get(r, 'boxHeightCm')),
              trackingNumber: get(r, 'boxTracking') || null,
              items: [] as { sku: string; quantity: number }[],
            });
          }
          const sku = get(r, 'sku');
          if (!sku) continue;
          const quantity = Math.max(1, Math.floor(Number(get(r, 'quantity')) || 1));
          boxMap.get(boxKey).items.push({ sku, quantity });
        }
        const boxes = boxOrder.map((k) => boxMap.get(k)).filter((b) => b.items.length > 0);
        if (!boxes.length) throw new Error('No SKU lines');

        await this.create({ date: date.toISOString(), salesChannelId, fbaShipmentRef: fbaId, shippingServiceId, packagingPct, boxes, status: 'draft' } as any, actorId, companyId);
        created++;
      } catch (e: any) {
        errors.push({ fbaRef: fbaId, message: (e?.message ?? String(e)).slice(0, 200) });
      }
    }
    return { created, shipments: groups.size, errors };
  }
}

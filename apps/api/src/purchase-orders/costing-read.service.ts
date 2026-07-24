import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CostingService } from './costing.service';

const ACTIVE = { deletedAt: null };

@Injectable()
export class CostingReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
  ) {}

  /** The ledger for one product — every event that moved its average, newest first. */
  async history(productId: string, limit = 100) {
    const rows = await this.prisma.productCostEvent.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
    });
    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      reference: r.reference,
      refType: r.refType,
      refId: r.refId,
      qtyDelta: r.qtyDelta,
      unitCostEur: Number(r.unitCostEur),
      landedAddOnEur: Number(r.landedAddOnEur),
      /** The goods-only portion, so landed vs invoice price is readable at a glance. */
      goodsUnitEur: Number(r.unitCostEur) - Number(r.landedAddOnEur),
      qtyBefore: r.qtyBefore,
      avgBeforeEur: r.avgBeforeEur == null ? null : Number(r.avgBeforeEur),
      qtyAfter: r.qtyAfter,
      avgAfterEur: Number(r.avgAfterEur),
      notes: r.notes,
      createdAt: r.createdAt,
    }));
  }

  /**
   * The unit cost the product was last actually PURCHASED at — the most recent line on a
   * submitted (or further-along) purchase order. Draft POs are ignored: nothing was
   * committed on them. Ordered by when the PO was submitted, so "last" means last agreed
   * with a vendor, not last edited. Returns { found: false } when the product has never
   * been on a submitted PO.
   */
  async lastPurchaseCost(productId: string) {
    const line = await this.prisma.purchaseOrderLine.findFirst({
      where: {
        productId,
        purchaseOrder: {
          ...ACTIVE,
          status: { in: ['submitted', 'partially_received', 'received'] },
        },
      },
      orderBy: { purchaseOrder: { submittedAt: 'desc' } },
      select: {
        unitCost: true,
        purchaseOrder: { select: { id: true, poNumber: true, currency: true, submittedAt: true } },
      },
    });
    if (!line) return { found: false as const };
    return {
      found: true as const,
      unitCost: Number(line.unitCost),
      currency: line.purchaseOrder.currency,
      poNumber: line.purchaseOrder.poNumber,
      poId: line.purchaseOrder.id,
      submittedAt: line.purchaseOrder.submittedAt,
    };
  }

  /** Products carrying stock value but no average cost — the gaps worth filling. */
  async uncosted(limit = 200) {
    const rows = await this.prisma.product.findMany({
      where: { ...ACTIVE, averageCostEur: null },
      select: { id: true, mainSku: true, title: true, purchaseCostAmount: true, purchaseCostCurrency: true },
      orderBy: { mainSku: 'asc' },
      take: Math.min(1000, Math.max(1, limit)),
    });
    return rows.map((p) => ({
      id: p.id,
      sku: p.mainSku,
      title: p.title,
      purchaseCostAmount: p.purchaseCostAmount == null ? null : Number(p.purchaseCostAmount),
      purchaseCostCurrency: p.purchaseCostCurrency,
      /** Seeding needs a figure to seed from; without one the product must be received first. */
      seedable: p.purchaseCostAmount != null,
    }));
  }

  /**
   * Give never-costed products an opening average from their catalogue purchase cost.
   *
   * Only touches products whose average is still null, so it can be re-run safely and
   * can never overwrite a value that receiving has since established. Opening events are
   * recorded at zero quantity: they set the starting cost without inventing stock.
   */
  async seedOpening(productIds: string[] | undefined, dryRun: boolean, actorId?: string) {
    const products = await this.prisma.product.findMany({
      where: {
        ...ACTIVE,
        averageCostEur: null,
        purchaseCostAmount: { not: null },
        ...(productIds?.length ? { id: { in: productIds } } : {}),
      },
      select: { id: true, mainSku: true, purchaseCostAmount: true, purchaseCostCurrency: true },
    });

    // Only EUR costs can be seeded verbatim; a foreign cost would need a rate and the
    // opening figure is not worth guessing at.
    const eligible = products.filter((p) => (p.purchaseCostCurrency ?? 'EUR') === 'EUR');
    const skippedCurrency = products.length - eligible.length;

    if (dryRun) {
      return {
        dryRun: true,
        wouldSeed: eligible.length,
        skippedNonEurCost: skippedCurrency,
        sample: eligible.slice(0, 10).map((p) => ({ sku: p.mainSku, costEur: Number(p.purchaseCostAmount) })),
      };
    }

    let seeded = 0;
    // Chunked so one long transaction doesn't hold locks across the whole catalogue.
    const CHUNK = 100;
    for (let i = 0; i < eligible.length; i += CHUNK) {
      const batch = eligible.slice(i, i + CHUNK);
      await this.prisma.$transaction(async (tx) => {
        for (const p of batch) {
          await this.costing.applyMovement(tx, {
            productId: p.id,
            qtyDelta: 0,
            unitCostEur: Number(p.purchaseCostAmount),
            reason: 'opening',
            reference: 'Opening cost from catalogue',
            notes: 'Seeded from the product purchase cost',
            actorId,
          });
          seeded++;
        }
      });
    }
    return { dryRun: false, seeded, skippedNonEurCost: skippedCurrency };
  }
}

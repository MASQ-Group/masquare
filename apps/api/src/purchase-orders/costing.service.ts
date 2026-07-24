import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const round2 = (v: number) => Number(v.toFixed(2));
const round4 = (v: number) => Number(v.toFixed(4));
/** The platform's volumetric divisor, matching the shipping estimate. */
const VOLUMETRIC_DIVISOR = 5000;

export type AllocationMethod = 'weight' | 'volumetric' | 'quantity' | 'value';

/** One received line, with everything the allocation needs to weigh it. */
export interface CostableLine {
  productId: string;
  sku: string;
  quantity: number;
  /** Goods cost for the whole line, already in EUR. */
  lineNetEur: number;
  packageWeightKg: number | null;
  productWeightKg: number | null;
  packageLengthCm: number | null;
  packageWidthCm: number | null;
  packageHeightCm: number | null;
}

/** An ancillary cost to spread over the lines. Import VAT never appears here. */
export interface AllocatableCost {
  label: string;
  amountEur: number;
  method: AllocationMethod;
}

export interface AllocationResult {
  /** productId -> total ancillary EUR allocated to that line. */
  byLine: number[];
  total: number;
}

@Injectable()
export class CostingService {
  // ---------------------------------------------------------------- allocation

  /** The quantity a method weighs a line by. Null when the line lacks the data. */
  private basis(line: CostableLine, method: AllocationMethod): number | null {
    switch (method) {
      case 'quantity':
        return line.quantity;
      case 'value':
        return line.lineNetEur;
      case 'weight': {
        const unit =
          line.packageWeightKg != null
            ? Number(line.packageWeightKg)
            : line.productWeightKg != null
              ? Number(line.productWeightKg)
              : null;
        return unit == null ? null : unit * line.quantity;
      }
      case 'volumetric': {
        if (line.packageLengthCm == null || line.packageWidthCm == null || line.packageHeightCm == null) return null;
        const vol =
          (Number(line.packageLengthCm) * Number(line.packageWidthCm) * Number(line.packageHeightCm)) /
          VOLUMETRIC_DIVISOR;
        return vol * line.quantity;
      }
    }
  }

  /**
   * Names the lines that cannot be weighed by the methods in play.
   *
   * Called before anything is written: a missing weight would otherwise silently
   * contribute zero and quietly push that line's share of the freight onto everything
   * else, understating one product's cost and overstating the rest.
   */
  missingBasis(lines: CostableLine[], costs: AllocatableCost[]): { method: AllocationMethod; skus: string[] }[] {
    const methods = [...new Set(costs.filter((c) => c.amountEur > 0).map((c) => c.method))];
    const out: { method: AllocationMethod; skus: string[] }[] = [];
    for (const method of methods) {
      if (method === 'quantity' || method === 'value') continue; // always derivable
      const skus = lines.filter((l) => this.basis(l, method) == null).map((l) => l.sku);
      if (skus.length) out.push({ method, skus });
    }
    return out;
  }

  /**
   * Spread one cost across the lines in proportion to the chosen basis.
   *
   * Uses largest-remainder: shares are floored to the cent and the leftover cents are
   * handed to the lines with the biggest fractional parts, so the allocation sums to
   * the original amount exactly rather than drifting by a cent per line.
   */
  allocate(lines: CostableLine[], cost: AllocatableCost): number[] {
    const n = lines.length;
    if (!n || cost.amountEur <= 0) return new Array(n).fill(0);

    const bases = lines.map((l) => this.basis(l, cost.method) ?? 0);
    const total = bases.reduce((s, b) => s + b, 0);
    // Nothing to weigh by (e.g. a zero-value order): fall back to an even split so the
    // money still lands somewhere rather than vanishing.
    const weights = total > 0 ? bases.map((b) => b / total) : new Array(n).fill(1 / n);

    const cents = Math.round(cost.amountEur * 100);
    const exact = weights.map((w) => w * cents);
    const floored = exact.map((v) => Math.floor(v));
    let remainder = cents - floored.reduce((s, v) => s + v, 0);

    const order = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; k < order.length && remainder > 0; k++, remainder--) floored[order[k].i] += 1;

    return floored.map((c) => c / 100);
  }

  /** Every ancillary cost allocated and summed per line. */
  allocateAll(lines: CostableLine[], costs: AllocatableCost[]): AllocationResult {
    const byLine = new Array(lines.length).fill(0);
    let total = 0;
    for (const cost of costs) {
      if (cost.amountEur <= 0) continue;
      const share = this.allocate(lines, cost);
      share.forEach((v, i) => (byLine[i] = round2(byLine[i] + v)));
      total = round2(total + cost.amountEur);
    }
    return { byLine, total };
  }

  // ---------------------------------------------------------------- average cost

  /**
   * Apply one costed movement to a product's average and write the ledger row.
   *
   * Moving weighted average: the new average is the blend of what is already on hand
   * with what has just arrived. Two cases need care —
   *  - nothing on hand (or a negative balance): there is nothing to blend, so the
   *    incoming cost simply becomes the average;
   *  - stock leaving (a return): it leaves at the *current* average, which by definition
   *    leaves the average unchanged for the units that remain. Removing at the original
   *    purchase price instead would shift the cost of goods nobody touched.
   *
   * Runs on the caller's transaction so costing commits with the movement that caused it.
   */
  async applyMovement(
    tx: Prisma.TransactionClient,
    args: {
      productId: string;
      sku?: string;
      qtyDelta: number;
      /** Landed cost per unit for an inbound movement. Ignored when qtyDelta < 0. */
      unitCostEur?: number;
      landedAddOnEur?: number;
      reason: 'opening' | 'goods_receipt' | 'vendor_return' | 'adjustment';
      refType?: string;
      refId?: string;
      reference?: string;
      notes?: string;
      actorId?: string;
    },
  ) {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: args.productId },
      select: { averageCostEur: true, averageCostQty: true },
    });

    const qtyBefore = product.averageCostQty ?? 0;
    const avgBefore = product.averageCostEur == null ? null : Number(product.averageCostEur);
    const qtyAfter = qtyBefore + args.qtyDelta;

    let avgAfter: number;
    let unitCost: number;

    if (args.qtyDelta >= 0) {
      unitCost = args.unitCostEur ?? 0;
      if (qtyBefore <= 0 || avgBefore == null) {
        avgAfter = unitCost;
      } else if (qtyAfter <= 0) {
        avgAfter = avgBefore;
      } else {
        avgAfter = (qtyBefore * avgBefore + args.qtyDelta * unitCost) / qtyAfter;
      }
    } else {
      // Outbound: leaves at the running average, so the average itself does not move.
      unitCost = avgBefore ?? args.unitCostEur ?? 0;
      avgAfter = avgBefore ?? unitCost;
    }

    // Money is 2dp: keeping the stored average at the same precision it is shown at
    // means qty x average always reconciles by hand.
    avgAfter = round2(avgAfter);

    await tx.product.update({
      where: { id: args.productId },
      data: { averageCostEur: new Prisma.Decimal(avgAfter), averageCostQty: qtyAfter, averageCostUpdatedAt: new Date() },
    });

    await tx.productCostEvent.create({
      data: {
        productId: args.productId,
        reason: args.reason,
        refType: args.refType ?? null,
        refId: args.refId ?? null,
        reference: args.reference ?? null,
        qtyDelta: args.qtyDelta,
        unitCostEur: new Prisma.Decimal(round2(unitCost)),
        landedAddOnEur: new Prisma.Decimal(round2(args.landedAddOnEur ?? 0)),
        qtyBefore,
        avgBeforeEur: avgBefore == null ? null : new Prisma.Decimal(avgBefore),
        qtyAfter,
        avgAfterEur: new Prisma.Decimal(avgAfter),
        notes: args.notes ?? null,
        createdById: args.actorId ?? null,
      },
    });

    return { qtyBefore, avgBefore, qtyAfter, avgAfter, unitCost };
  }

  /** Refuse a post that cannot be costed, naming the SKUs so it is actionable. */
  assertCostable(lines: CostableLine[], costs: AllocatableCost[]) {
    const gaps = this.missingBasis(lines, costs);
    if (!gaps.length) return;
    const parts = gaps.map(
      (g) =>
        `${g.method === 'weight' ? 'weight' : 'dimensions'} missing for ${g.skus.slice(0, 5).join(', ')}${
          g.skus.length > 5 ? ` +${g.skus.length - 5} more` : ''
        }`,
    );
    throw new BadRequestException(
      `Cannot cost this receipt — ${parts.join('; ')}. Fill the product data in, or change the cost allocation method on the receipt.`,
    );
  }
}

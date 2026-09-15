import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JobsService } from '../../jobs/jobs.service';
import { FloorService } from '../floor/floor.service';
import { ISO_TO_MARKETPLACE, MARKETPLACE_TO_ISO } from '../config/repricing.config';
import { resolveParams } from '../config/resolve-preset';
import { parseRangeRow, planRangeChange, type RangeChange, type RangePlan, type RangeRow } from './price-range-edit';

/** Which SKUs a bulk edit or an export covers. Every filter narrows; none means all. */
export interface RangeFilters {
  marketplace?: string;
  brandId?: string;
  vendorId?: string;
  productTypeId?: string;
  q?: string;
  state?: string;
  skuPricingIds?: string[];
}

type Row = Prisma.RepricingSkuPricingGetPayload<{ include: { preset: true } }>;

/** Most SKUs one bulk edit or export will touch, so a filter left empty cannot rewrite everything by accident of scale. */
const BULK_CAP = 5000;

/**
 * Setting the price range a SKU is repriced within — per row, in bulk, and from a spreadsheet.
 *
 * Every route plans each row through `planRangeChange` first, so a preview shows exactly what an
 * apply will do, and a row with any problem is left untouched rather than half-changed.
 *
 * A change of MARGIN moves the solved margin floor, which needs Amazon's fee estimate for that SKU.
 * Those recomputes run as a job after the write, so a bulk edit returns at once and the floors
 * follow; until they do, the SKU keeps pricing on its previous floor.
 */
@Injectable()
export class PriceRangeService {
  private readonly logger = new Logger(PriceRangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly floors: FloorService,
    private readonly jobs: JobsService,
  ) {}

  // ── reading ────────────────────────────────────────────────────────────────────────────────────

  async where(f: RangeFilters): Promise<Prisma.RepricingSkuPricingWhereInput | null> {
    const iso = f.marketplace?.trim().toUpperCase();
    const marketplaceId = iso ? ISO_TO_MARKETPLACE[iso] : undefined;
    if (iso && !marketplaceId) return null;

    let productIds: string[] | undefined;
    if (f.brandId || f.vendorId || f.productTypeId) {
      // No Prisma relation from this table to Product, so product filters resolve to ids first.
      const products = await this.prisma.product.findMany({
        where: {
          ...(f.brandId ? { brandId: f.brandId } : {}),
          ...(f.vendorId ? { vendorId: f.vendorId } : {}),
          ...(f.productTypeId ? { productTypeId: f.productTypeId } : {}),
        },
        select: { id: true },
      });
      productIds = products.map((p) => p.id);
      if (productIds.length === 0) return null;
    }
    const term = f.q?.trim();
    return {
      deletedAt: null,
      ...(marketplaceId ? { marketplaceId } : {}),
      ...(f.state ? { automationState: f.state } : {}),
      ...(productIds ? { productId: { in: productIds } } : {}),
      ...(f.skuPricingIds?.length ? { id: { in: f.skuPricingIds } } : {}),
      ...(term
        ? { OR: [{ sku: { contains: term, mode: 'insensitive' as const } }, { asin: { contains: term, mode: 'insensitive' as const } }] }
        : {}),
    };
  }

  private rangeRow(r: Row): RangeRow {
    return {
      breakevenCents: r.breakevenCents,
      strategyFloorCents: r.strategyFloorCents,
      minPriceCents: r.minPriceCents,
      maxPriceCents: r.maxPriceCents,
      minMarginPct: r.minMarginPct != null ? Number(r.minMarginPct) : null,
      clearanceFloorCents: r.clearanceFloorCents,
      clearanceReason: r.clearanceReason,
      clearanceEndsAt: r.clearanceEndsAt,
      clearanceUntilStock: r.clearanceUntilStock,
    };
  }

  /** Units in availability for the products whose clearance ends at a stock level. */
  private async unitsFor(rows: Row[]): Promise<Map<string, number>> {
    const ids = [...new Set(rows.filter((r) => r.productId && r.clearanceUntilStock != null).map((r) => r.productId as string))];
    if (!ids.length) return new Map();
    const av = await this.prisma.productAvailability.findMany({ where: { productId: { in: ids } }, select: { productId: true, quantity: true } });
    return new Map(av.map((a) => [a.productId, a.quantity]));
  }

  // ── writing ────────────────────────────────────────────────────────────────────────────────────

  private async write(rows: { row: Row; plan: RangePlan }[]): Promise<{ applied: number; floorJobId: string | null }> {
    let applied = 0;
    for (const { row, plan } of rows) {
      if (!plan.changed || plan.problems.length) continue;
      await this.prisma.repricingSkuPricing.update({
        where: { id: row.id },
        data: {
          ...plan.data,
          ...(plan.data.minMarginPct !== undefined
            ? { minMarginPct: plan.data.minMarginPct == null ? null : new Prisma.Decimal(plan.data.minMarginPct) }
            : {}),
        },
      });
      applied += 1;
    }
    const recompute = rows.filter((r) => r.plan.changed && r.plan.marginChanged).map((r) => r.row.id);
    let floorJobId: string | null = null;
    if (recompute.length) {
      const job = this.jobs.start('repricing.range-floors', `Recalculating ${recompute.length} floor(s) for a new margin`, async (ctx) => {
        ctx.setTotal(recompute.length);
        let ok = 0;
        for (const id of recompute) {
          if (ctx.cancelled) break;
          try { await this.floors.computeFloorsForSku(id); ok += 1; ctx.tick(true); }
          catch (e) { this.logger.warn(`Floor recompute failed for ${id}: ${(e as Error).message}`); ctx.tick(false); }
        }
        return { recomputed: ok, of: recompute.length };
      });
      floorJobId = job.id;
    }
    return { applied, floorJobId };
  }

  private view(row: Row, plan: RangePlan) {
    return {
      id: row.id,
      sku: row.sku,
      marketplace: MARKETPLACE_TO_ISO[row.marketplaceId] ?? row.marketplaceId,
      currency: row.currency,
      breakevenCents: row.breakevenCents,
      problems: plan.problems,
      changed: plan.changed,
      marginChanged: plan.marginChanged,
      before: { floorCents: plan.before.floorCents, floorSource: plan.before.floorSource, maxPriceCents: plan.before.maxPriceCents },
      after: { floorCents: plan.after.floorCents, floorSource: plan.after.floorSource, maxPriceCents: plan.after.maxPriceCents, notes: plan.after.notes },
    };
  }

  async updateOne(id: string, change: RangeChange, actorId?: string) {
    const row = await this.prisma.repricingSkuPricing.findFirst({ where: { id, deletedAt: null }, include: { preset: true } });
    if (!row) throw new NotFoundException('SKU pricing row not found');
    const units = await this.unitsFor([row]);
    const plan = planRangeChange(this.rangeRow(row), change, { now: new Date(), actorId, availableUnits: row.productId ? units.get(row.productId) ?? null : null });
    if (plan.problems.length) throw new BadRequestException(plan.problems.join('; '));
    const { applied, floorJobId } = await this.write([{ row, plan }]);
    return { ...this.view(row, plan), applied: applied > 0, floorJobId };
  }

  async bulk(f: RangeFilters, change: RangeChange, apply: boolean, actorId?: string) {
    const where = await this.where(f);
    if (!where) return { matched: 0, willChange: 0, refused: [], sample: [], applied: 0, floorJobId: null };
    const total = await this.prisma.repricingSkuPricing.count({ where });
    if (total > BULK_CAP) {
      throw new BadRequestException(`That selection covers ${total} SKUs; narrow it to ${BULK_CAP} or fewer.`);
    }
    const rows = await this.prisma.repricingSkuPricing.findMany({ where, include: { preset: true }, orderBy: { sku: 'asc' } });
    const units = await this.unitsFor(rows);
    const now = new Date();
    const planned = rows.map((row) => ({
      row,
      plan: planRangeChange(this.rangeRow(row), change, { now, actorId, availableUnits: row.productId ? units.get(row.productId) ?? null : null }),
    }));
    const refused = planned.filter((p) => p.plan.problems.length).map((p) => this.view(p.row, p.plan));
    const changing = planned.filter((p) => p.plan.changed);
    const result = {
      matched: rows.length,
      willChange: changing.length,
      refused: refused.slice(0, 200),
      refusedTotal: refused.length,
      sample: changing.slice(0, 50).map((p) => this.view(p.row, p.plan)),
    };
    if (!apply) return { ...result, applied: 0, floorJobId: null };
    const { applied, floorJobId } = await this.write(planned);
    this.logger.log(`Price range bulk edit: ${applied} of ${rows.length} SKU(s) changed`);
    return { ...result, applied, floorJobId };
  }

  // ── spreadsheet ────────────────────────────────────────────────────────────────────────────────

  async exportRows(f: RangeFilters) {
    const where = await this.where(f);
    if (!where) return { rows: [] };
    const rows = await this.prisma.repricingSkuPricing.findMany({ where, include: { preset: true }, orderBy: [{ marketplaceId: 'asc' }, { sku: 'asc' }], take: BULK_CAP });
    const productIds = [...new Set(rows.map((r) => r.productId).filter(Boolean) as string[])];
    const products = productIds.length
      ? await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, brand: { select: { name: true } }, vendor: { select: { name: true } }, productType: { select: { name: true } } },
      })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const units = await this.unitsFor(rows);
    const now = new Date();
    const money = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2));
    const SOURCE = { clearance: 'Clearance', min_price: 'Min price', margin: 'Margin' } as const;
    return {
      rows: rows.map((r) => {
        const p = r.productId ? byId.get(r.productId) : undefined;
        const plan = planRangeChange(this.rangeRow(r), {}, { now, availableUnits: r.productId ? units.get(r.productId) ?? null : null });
        const margin = resolveParams(r, r.preset);
        return {
          'SKU': r.sku,
          'Marketplace': MARKETPLACE_TO_ISO[r.marketplaceId] ?? r.marketplaceId,
          'ASIN': r.asin ?? '',
          'Brand': p?.brand?.name ?? '',
          'Vendor': p?.vendor?.name ?? '',
          'Product type': p?.productType?.name ?? '',
          'Currency': r.currency,
          'Current price': money(r.currentPriceCents),
          'Breakeven': money(r.breakevenCents),
          'Margin floor': money(r.strategyFloorCents),
          'Floor in use': money(plan.before.floorCents),
          'Floor from': `${SOURCE[plan.before.floorSource]}${plan.before.floorSource === 'margin' ? ` (${margin.minMarginPctDisplay}% from ${margin.marginFrom})` : ''}`,
          'Min price': money(r.minPriceCents),
          'Max price': money(r.maxPriceCents),
          'Margin %': r.minMarginPct != null ? String(Number(r.minMarginPct)) : '',
          'Clearance floor': money(r.clearanceFloorCents),
          'Clearance reason': r.clearanceReason ?? '',
          // The last day it runs, which is how the import reads a date back.
          'Clearance ends': r.clearanceEndsAt ? new Date(r.clearanceEndsAt.getTime() - 1).toISOString().slice(0, 10) : '',
          'Clearance until stock': r.clearanceUntilStock != null ? String(r.clearanceUntilStock) : '',
        };
      }),
    };
  }

  /** Plan every spreadsheet row against the SKU it names. Nothing is written. */
  private async planImport(records: Record<string, unknown>[], actorId?: string) {
    const parsed = records.slice(0, BULK_CAP).map((rec, i) => ({ line: i + 2, ...parseRangeRow(rec) }));
    const keys = parsed.filter((p) => p.sku && ISO_TO_MARKETPLACE[p.marketplace]).map((p) => ({ sku: p.sku, marketplaceId: ISO_TO_MARKETPLACE[p.marketplace] }));
    const rows = keys.length
      ? await this.prisma.repricingSkuPricing.findMany({ where: { deletedAt: null, OR: keys }, include: { preset: true } })
      : [];
    const byKey = new Map(rows.map((r) => [`${r.sku}|${r.marketplaceId}`, r]));
    const units = await this.unitsFor(rows);
    const now = new Date();
    return parsed.map((p) => {
      const marketplaceId = ISO_TO_MARKETPLACE[p.marketplace];
      const row = marketplaceId ? byKey.get(`${p.sku}|${marketplaceId}`) : undefined;
      const problems = [...p.problems];
      if (p.marketplace && !marketplaceId) problems.push(`Marketplace "${p.marketplace}" is not one we reprice on`);
      if (!row && p.sku && marketplaceId) problems.push('No repricing row for this SKU on this marketplace');
      if (!row || problems.length) {
        return { line: p.line, sku: p.sku, marketplace: p.marketplace, status: 'error' as const, problems, row: null, plan: null };
      }
      const plan = planRangeChange(this.rangeRow(row), p.change, { now, actorId, availableUnits: row.productId ? units.get(row.productId) ?? null : null });
      const status = plan.problems.length ? 'error' as const : plan.changed ? 'change' as const : 'no_change' as const;
      return { line: p.line, sku: p.sku, marketplace: p.marketplace, status, problems: plan.problems, row, plan };
    });
  }

  async importValidate(records: Record<string, unknown>[]) {
    const planned = await this.planImport(records);
    return {
      rows: planned.map((p) => ({
        line: p.line,
        sku: p.sku,
        marketplace: p.marketplace,
        status: p.status,
        problems: p.problems,
        ...(p.row && p.plan ? { view: this.view(p.row, p.plan) } : {}),
      })),
      counts: {
        change: planned.filter((p) => p.status === 'change').length,
        noChange: planned.filter((p) => p.status === 'no_change').length,
        error: planned.filter((p) => p.status === 'error').length,
      },
    };
  }

  /** Re-plans from the file rather than trusting a preview, then writes only the rows that change cleanly. */
  async importCommit(records: Record<string, unknown>[], actorId?: string) {
    const planned = await this.planImport(records, actorId);
    const good = planned.filter((p) => p.status === 'change' && p.row && p.plan) as { row: Row; plan: RangePlan }[];
    const { applied, floorJobId } = await this.write(good.map((g) => ({ row: g.row, plan: g.plan })));
    return { applied, skippedWithProblems: planned.filter((p) => p.status === 'error').length, floorJobId };
  }
}

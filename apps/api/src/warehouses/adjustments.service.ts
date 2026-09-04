import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { StockService } from './stock.service';
import { normaliseSerials, parseSerials } from './transfers.service';
import {
  ADJUSTMENT_MODES,
  ADJUSTMENT_REASONS,
  AdjustmentImportRowDto,
  AdjustmentMode,
  ManualAdjustDto,
} from './dto/warehouse.dto';

/** Spreadsheet wording for the three modes, so a sheet can say "Add" rather than "add". */
const MODE_BY_LABEL = new Map<string, AdjustmentMode>([
  ['set', 'set'],
  ['set to', 'set'],
  ['recount', 'set'],
  ['stocktake', 'set'],
  ['add', 'add'],
  ['increase', 'add'],
  ['remove', 'remove'],
  ['decrease', 'remove'],
  ['subtract', 'remove'],
]);

const REASON_BY_LABEL = new Map<string, string>([
  ['opening balance', 'opening_balance'],
  ['opening_balance', 'opening_balance'],
  ['adjustment', 'adjustment'],
  ['damage', 'damage'],
  ['damage / write-off', 'damage'],
  ['write-off', 'damage'],
  ['stocktake', 'stocktake'],
]);

/**
 * Manual inventory adjustments — someone stating what is actually on a shelf.
 *
 * Separate from a transfer because the two answer different questions. A transfer knows where the
 * stock went; an adjustment is the case where it appeared or vanished and the only honest record is
 * a reason and a name.
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly activity: ActivityService,
  ) {}

  async adjust(dto: ManualAdjustDto, actorId?: string, companyIds?: string[]) {
    const { product, warehouse } = await this.resolve(dto.productId, dto.warehouseId, companyIds);
    const serials = normaliseSerials(dto.serials ?? [], product.mainSku);

    if (product.serialTracked) return this.adjustSerial(dto, product, warehouse, serials, actorId);
    if (serials.length) {
      throw new BadRequestException(`${product.mainSku} is not serial-tracked — remove the serial numbers, or turn tracking on for it first`);
    }
    return this.adjustQuantity(dto, product, warehouse, actorId);
  }

  // ---------------------------------------------------------------- quantity products

  private async adjustQuantity(
    dto: ManualAdjustDto,
    product: { id: string; mainSku: string },
    warehouse: { id: string; name: string },
    actorId?: string,
  ) {
    const qty = dto.quantity;
    if (!Number.isInteger(qty)) throw new BadRequestException('Quantity must be a whole number');
    if (dto.mode === 'set' && (qty as number) < 0) throw new BadRequestException('Quantity on hand cannot be negative');
    if (dto.mode !== 'set' && (qty as number) <= 0) throw new BadRequestException('Quantity must be above zero');

    const current =
      (
        await this.prisma.stockLevel.findUnique({
          where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
          select: { quantityOnHand: true },
        })
      )?.quantityOnHand ?? 0;

    const delta = dto.mode === 'set' ? (qty as number) - current : dto.mode === 'add' ? (qty as number) : -(qty as number);
    if (delta === 0) return { changed: false, quantityOnHand: current, qtyDelta: 0 };

    const res = await this.prisma.$transaction((tx) =>
      this.stock.applyDeltaWithin(tx, {
        productId: product.id,
        warehouseId: warehouse.id,
        qtyDelta: delta,
        reason: dto.reason,
        actorId,
        notes: dto.notes?.trim() || null,
      }),
    );

    await this.log(product, warehouse, delta, res.quantityOnHand, dto.reason, [], actorId);
    return { changed: true, ...res };
  }

  // ---------------------------------------------------------------- serial-tracked products

  /**
   * Serial-tracked products name the units rather than a count.
   *
   * `set` is refused here on purpose. For a tracked product it would have to mean "these are all
   * the serials present", so a list that came up short would write off every unit not on it —
   * a paste that lost its last lines would scrap real stock and report success. Add and remove
   * can only ever affect units someone actually typed.
   */
  private async adjustSerial(
    dto: ManualAdjustDto,
    product: { id: string; mainSku: string },
    warehouse: { id: string; name: string },
    serials: string[],
    actorId?: string,
  ) {
    if (dto.mode === 'set') {
      throw new BadRequestException(
        `${product.mainSku} is serial-tracked. Add or remove the specific serial numbers instead of setting a count.`,
      );
    }
    if (!serials.length) throw new BadRequestException(`${product.mainSku} is serial-tracked — name the serial numbers`);
    if (dto.quantity != null && dto.quantity !== serials.length) {
      throw new BadRequestException(
        `Quantity is ${dto.quantity} but ${serials.length} serial${serials.length === 1 ? ' was' : 's were'} named`,
      );
    }

    const adding = dto.mode === 'add';
    const delta = adding ? serials.length : -serials.length;

    const res = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.serialNumber.findMany({
        where: { productId: product.id, serial: { in: serials } },
        select: { id: true, serial: true, status: true, warehouseId: true },
      });

      if (adding) {
        // A serial already on file is either a typo or a real mix-up. Merging it would make the
        // register describe stock that does not exist in two places at once.
        if (existing.length) {
          throw new BadRequestException(
            `Already registered for ${product.mainSku}: ${existing.map((e) => `${e.serial} (${e.status.replace(/_/g, ' ')})`).join(', ')}`,
          );
        }
      } else {
        const byS = new Map(existing.map((e) => [e.serial, e]));
        const unknown = serials.filter((s) => !byS.has(s));
        if (unknown.length) throw new BadRequestException(`Not a registered serial for ${product.mainSku}: ${unknown.join(', ')}`);
        const gone = existing.filter((e) => e.status !== 'in_stock');
        if (gone.length) {
          throw new BadRequestException(`Already gone: ${gone.map((e) => `${e.serial} (${e.status.replace(/_/g, ' ')})`).join(', ')}`);
        }
        const elsewhere = existing.filter((e) => e.warehouseId !== warehouse.id);
        if (elsewhere.length) {
          throw new BadRequestException(`Not in ${warehouse.name}: ${elsewhere.map((e) => e.serial).join(', ')}`);
        }
      }

      const moved = await this.stock.applyDeltaWithin(tx, {
        productId: product.id,
        warehouseId: warehouse.id,
        qtyDelta: delta,
        reason: dto.reason,
        actorId,
        notes: dto.notes?.trim() || null,
        serials,
      });

      if (adding) {
        await tx.serialNumber.createMany({
          data: serials.map((serial) => ({
            productId: product.id,
            serial,
            status: 'in_stock',
            warehouseId: warehouse.id,
            receivedAt: new Date(),
            createdById: actorId ?? null,
          })),
        });
      } else {
        await tx.serialNumber.updateMany({
          where: { id: { in: existing.map((e) => e.id) } },
          data: { status: dto.disposition ?? 'scrapped', warehouseId: null, dispatchedAt: new Date() },
        });
      }

      return moved;
    });

    await this.log(product, warehouse, delta, res.quantityOnHand, dto.reason, serials, actorId);
    return { changed: true, ...res };
  }

  // ---------------------------------------------------------------- shared

  private async resolve(productId: string, warehouseId: string, companyIds?: string[]) {
    const [product, warehouse] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true, mainSku: true, serialTracked: true },
      }),
      this.prisma.warehouse.findFirst({
        where: { id: warehouseId, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
        select: { id: true, name: true, isActive: true },
      }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (!warehouse.isActive) throw new BadRequestException(`${warehouse.name} is inactive — reactivate it before moving stock`);
    return { product, warehouse };
  }

  private async log(
    product: { id: string; mainSku: string },
    warehouse: { name: string },
    delta: number,
    balanceAfter: number,
    reason: string,
    serials: string[],
    actorId?: string,
  ) {
    await this.activity.record({
      entityType: 'stock_adjustment',
      entityId: product.id,
      entityLabel: product.mainSku,
      action: 'update',
      actorId: actorId ?? null,
      summary: `${delta > 0 ? '+' : ''}${delta} in ${warehouse.name} → ${balanceAfter} (${reason.replace(/_/g, ' ')})${
        serials.length ? ` · ${serials.join(', ')}` : ''
      }`,
      // record() drops an update with no changes, so the delta is stated as one.
      changes: [{ field: 'quantityOnHand', label: `On hand · ${warehouse.name}`, from: String(balanceAfter - delta), to: String(balanceAfter) }],
    });
  }

  // ---------------------------------------------------------------- import

  /**
   * Dry-run an adjustment sheet. Every row is checked against the balance the rows above it would
   * leave behind, so three removals of 10 against a balance of 15 fail here rather than half-way
   * through the commit.
   */
  async importValidate(rows: AdjustmentImportRowDto[], companyIds?: string[]) {
    const warehouses = await this.prisma.warehouse.findMany({
      where: { deletedAt: null, isActive: true, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, name: true },
    });
    const byName = new Map(warehouses.map((w) => [w.name.trim().toLowerCase(), w]));

    const skus = [...new Set(rows.map((r) => String(r.sku ?? '').trim()).filter(Boolean))];
    const bySku = await this.resolveSkus(skus);

    const productIds = [...new Set([...bySku.values()].map((p) => p.id))];
    const onHand = new Map<string, number>();
    if (productIds.length) {
      const levels = await this.prisma.stockLevel.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, warehouseId: true, quantityOnHand: true },
      });
      for (const l of levels) onHand.set(`${l.productId}|${l.warehouseId}`, l.quantityOnHand);
    }

    const claimed = new Set<string>();

    const out = rows.map((raw, i) => {
      const errors: string[] = [];
      const sku = String(raw.sku ?? '').trim();
      const warehouseName = String(raw.warehouse ?? '').trim();
      const actionRaw = String(raw.action ?? '').trim();
      const qtyRaw = String(raw.quantity ?? '').trim();
      const serials = parseSerials(raw.serials);
      const reasonRaw = String(raw.reason ?? '').trim();

      const product = sku ? bySku.get(sku.toLowerCase()) : undefined;
      if (!sku) errors.push('SKU is required');
      else if (!product) errors.push(`SKU "${sku}" is not in the catalogue`);

      const warehouse = warehouseName ? byName.get(warehouseName.toLowerCase()) : undefined;
      if (!warehouseName) errors.push('Warehouse is required');
      else if (!warehouse) errors.push(`No active warehouse named "${warehouseName}"`);

      const mode = actionRaw ? MODE_BY_LABEL.get(actionRaw.toLowerCase()) : undefined;
      if (!actionRaw) errors.push(`Action is required — one of ${ADJUSTMENT_MODES.join(', ')}`);
      else if (!mode) errors.push(`"${actionRaw}" is not an action. Use Set, Add or Remove.`);

      const reason = reasonRaw ? REASON_BY_LABEL.get(reasonRaw.toLowerCase()) : 'adjustment';
      if (reasonRaw && !reason) errors.push(`"${reasonRaw}" is not a reason. Use one of: ${ADJUSTMENT_REASONS.join(', ')}.`);

      let quantity: number | null = null;
      if (product?.serialTracked) {
        if (mode === 'set') errors.push(`${sku} is serial-tracked — use Add or Remove and name the serials, not Set`);
        if (!serials.length) errors.push(`${sku} is serial-tracked — list the serial numbers`);
        else {
          const dupe = serials.filter((s, idx) => serials.indexOf(s) !== idx);
          if (dupe.length) errors.push(`The same serial is listed twice: ${[...new Set(dupe)].join(', ')}`);
          if (qtyRaw !== '' && Number(qtyRaw) !== serials.length) errors.push(`Quantity says ${qtyRaw} but ${serials.length} serial(s) were listed`);
          quantity = serials.length;
          for (const s of serials) {
            const key = `${product.id}|${s}`;
            if (claimed.has(key)) errors.push(`Serial ${s} appears twice in this file`);
            claimed.add(key);
          }
        }
      } else if (product) {
        if (serials.length) errors.push(`${sku} is not serial-tracked — leave the serials column empty`);
        const n = Number(qtyRaw);
        if (qtyRaw === '') errors.push('Quantity is required');
        else if (!Number.isInteger(n)) errors.push(`Quantity "${qtyRaw}" is not a whole number`);
        else if (n < 0) errors.push('Quantity cannot be negative');
        else if (n === 0 && mode !== 'set') errors.push('Quantity must be above zero to add or remove');
        else quantity = n;
      }

      // Walk the running balance so a file that overdraws is caught here, not part-way through.
      if (product && warehouse && mode && quantity != null && errors.length === 0) {
        const key = `${product.id}|${warehouse.id}`;
        const before = onHand.get(key) ?? 0;
        const after = mode === 'set' ? quantity : mode === 'add' ? before + quantity : before - quantity;
        if (after < 0) errors.push(`${warehouse.name} holds ${before} of ${sku} after the rows above — cannot remove ${quantity}`);
        else onHand.set(key, after);
      }

      return {
        row: i + 2,
        sku,
        productId: product?.id ?? null,
        productName: product?.title ?? null,
        serialTracked: product?.serialTracked ?? false,
        warehouse: warehouseName,
        warehouseId: warehouse?.id ?? null,
        mode: mode ?? null,
        quantity,
        serials,
        reason: reason ?? null,
        notes: String(raw.notes ?? '').trim() || null,
        errors,
        valid: errors.length === 0,
      };
    });

    return { rows: out, validCount: out.filter((r) => r.valid).length, errorCount: out.filter((r) => !r.valid).length };
  }

  /**
   * Apply a validated sheet.
   *
   * Rows are applied one at a time rather than in a single transaction, because each is an
   * independent statement about one shelf — unlike a transfer, where a half-applied document would
   * leave two warehouses disagreeing. The file is re-validated first and refused whole if anything
   * is wrong, so the partial case needs a change under our feet to happen at all; if it does, the
   * count of what landed is returned rather than swallowed.
   */
  async importCommit(rows: AdjustmentImportRowDto[], actorId?: string, companyIds?: string[]) {
    const check = await this.importValidate(rows, companyIds);
    if (check.errorCount > 0) {
      const first = check.rows.find((r) => !r.valid)!;
      throw new BadRequestException(`Row ${first.row}: ${first.errors[0]} — nothing was imported.`);
    }

    let applied = 0;
    let unchanged = 0;
    const failures: { row: number; sku: string; message: string }[] = [];

    for (const r of check.rows) {
      try {
        const res = await this.adjust(
          {
            productId: r.productId!,
            warehouseId: r.warehouseId!,
            mode: r.mode!,
            quantity: r.quantity ?? undefined,
            serials: r.serials.length ? r.serials : undefined,
            reason: r.reason ?? 'adjustment',
            notes: r.notes,
          },
          actorId,
          companyIds,
        );
        if (res.changed) applied++;
        else unchanged++;
      } catch (e: any) {
        failures.push({ row: r.row, sku: r.sku, message: e?.message ?? 'Failed' });
      }
    }

    return { applied, unchanged, failed: failures.length, failures, total: check.rows.length };
  }

  private async resolveSkus(skus: string[]) {
    const map = new Map<string, { id: string; mainSku: string; title: string; serialTracked: boolean }>();
    if (!skus.length) return map;

    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, mainSku: { in: skus, mode: 'insensitive' } },
      select: { id: true, mainSku: true, title: true, serialTracked: true },
    });
    for (const p of products) map.set(p.mainSku.trim().toLowerCase(), p);

    const aliases = await this.prisma.productSkuAlias.findMany({
      where: { skuValue: { in: skus, mode: 'insensitive' }, deletedAt: null, product: { deletedAt: null } },
      select: { skuValue: true, product: { select: { id: true, mainSku: true, title: true, serialTracked: true } } },
    });
    for (const a of aliases) {
      const key = a.skuValue.trim().toLowerCase();
      if (!map.has(key)) map.set(key, a.product);
    }
    return map;
  }
}

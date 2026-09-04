import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { StockService } from './stock.service';
import { CreateTransferDto, TransferImportRowDto, TransferLineDto } from './dto/warehouse.dto';

export interface TransferQuery {
  q?: string;
  warehouseId?: string;
  companyIds?: string[];
  page?: number;
  pageSize?: number;
}

/** Split a spreadsheet cell of serials. People separate them with whatever is to hand. */
export function parseSerials(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(/[\s,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Moving stock between our own warehouses.
 *
 * The whole transfer is one database transaction. A five-line transfer that fails on line four
 * leaves nothing behind — half a transfer is worse than none, because the balances would be wrong
 * in two warehouses at once with no record saying which lines made it.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly activity: ActivityService,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(query: TransferQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));
    const q = query.q?.trim();

    const where: Prisma.StockTransferWhereInput = {
      ...(query.companyIds ? { companyId: { in: query.companyIds } } : {}),
      // Either end of the move counts as "involving this warehouse" — someone filtering by Office
      // wants what left it as much as what arrived.
      ...(query.warehouseId
        ? { OR: [{ fromWarehouseId: query.warehouseId }, { toWarehouseId: query.warehouseId }] }
        : {}),
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { reference: { contains: q, mode: 'insensitive' } },
                  { notes: { contains: q, mode: 'insensitive' } },
                  { movements: { some: { product: { mainSku: { contains: q, mode: 'insensitive' } } } } },
                ],
              },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.stockTransfer.count({ where }),
      this.prisma.stockTransfer.findMany({
        where,
        include: {
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
          // Only the inbound leg, so a two-line transfer reports two lines rather than four.
          movements: {
            where: { qtyDelta: { gt: 0 } },
            select: { qtyDelta: true, serials: true, product: { select: { id: true, mainSku: true, title: true } } },
            orderBy: { product: { mainSku: 'asc' } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const actorNames = await this.actorNames(rows.map((r) => r.createdById));

    return {
      rows: rows.map((t) => ({
        id: t.id,
        reference: t.reference,
        createdAt: t.createdAt,
        createdBy: t.createdById ? actorNames.get(t.createdById) ?? null : null,
        from: t.fromWarehouse,
        to: t.toWarehouse,
        notes: t.notes,
        lineCount: t.movements.length,
        totalUnits: t.movements.reduce((s, m) => s + m.qtyDelta, 0),
        lines: t.movements.map((m) => ({
          productId: m.product.id,
          sku: m.product.mainSku,
          productName: m.product.title,
          quantity: m.qtyDelta,
          serials: m.serials,
        })),
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private async actorNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((v): v is string => !!v))];
    if (!wanted.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, fullName: true, email: true } });
    return new Map(users.map((u) => [u.id, u.fullName || u.email]));
  }

  // ---------------------------------------------------------------- write

  async create(dto: CreateTransferDto, actorId?: string, companyIds?: string[]) {
    const { from, to } = await this.resolveWarehouses(dto.fromWarehouseId, dto.toWarehouseId, companyIds);
    const lines = await this.prepareLines(dto.lines);

    const transfer = await this.prisma.$transaction(async (tx) => {
      const reference = await nextTransferReference(tx);
      const header = await tx.stockTransfer.create({
        data: {
          reference,
          companyId: from.companyId,
          fromWarehouseId: from.id,
          toWarehouseId: to.id,
          notes: dto.notes?.trim() || null,
          createdById: actorId ?? null,
        },
      });

      for (const line of lines) {
        // Serials are re-checked inside the transaction. The pre-flight ran against a snapshot;
        // between then and here another transfer could have moved the same unit, and two warehouses
        // both claiming a serial is exactly what the register exists to prevent.
        if (line.serials.length) await this.assertSerialsOnShelf(tx, line.productId, line.serials, from.id, line.sku);

        const shared = { reason: 'transfer', reference, transferId: header.id, actorId, serials: line.serials };
        await this.stock.applyDeltaWithin(tx, { ...shared, productId: line.productId, warehouseId: from.id, qtyDelta: -line.quantity });
        await this.stock.applyDeltaWithin(tx, { ...shared, productId: line.productId, warehouseId: to.id, qtyDelta: line.quantity });

        if (line.serials.length) {
          await tx.serialNumber.updateMany({
            where: { productId: line.productId, serial: { in: line.serials } },
            data: { warehouseId: to.id },
          });
        }
      }

      return header;
    });

    await this.activity.record({
      entityType: 'stock_transfer',
      entityId: transfer.id,
      entityLabel: transfer.reference,
      action: 'create',
      actorId: actorId ?? null,
      summary: `${lines.reduce((s, l) => s + l.quantity, 0)} unit(s) across ${lines.length} line(s): ${from.name} → ${to.name}`,
    });

    return {
      id: transfer.id,
      reference: transfer.reference,
      from: { id: from.id, name: from.name },
      to: { id: to.id, name: to.name },
      lineCount: lines.length,
      totalUnits: lines.reduce((s, l) => s + l.quantity, 0),
    };
  }

  // ---------------------------------------------------------------- validation

  /** Both ends of the move, with the rules that make a transfer a transfer rather than a sale. */
  private async resolveWarehouses(fromId: string, toId: string, companyIds?: string[]) {
    if (fromId === toId) throw new BadRequestException('Source and destination are the same warehouse');

    const found = await this.prisma.warehouse.findMany({
      where: { id: { in: [fromId, toId] }, deletedAt: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, name: true, isActive: true, companyId: true },
    });
    const from = found.find((w) => w.id === fromId);
    const to = found.find((w) => w.id === toId);
    if (!from) throw new NotFoundException('Source warehouse not found');
    if (!to) throw new NotFoundException('Destination warehouse not found');
    if (!from.isActive) throw new BadRequestException(`${from.name} is inactive — reactivate it before moving stock out of it`);
    if (!to.isActive) throw new BadRequestException(`${to.name} is inactive — reactivate it before moving stock into it`);

    // Stock crossing between companies is a sale from one to the other, with an invoice and a VAT
    // consequence. Letting it through here would move the goods and record none of that.
    if (from.companyId !== to.companyId) {
      throw new BadRequestException(
        `${from.name} and ${to.name} belong to different companies. Moving stock between companies is a sale, not an internal transfer.`,
      );
    }

    return { from, to };
  }

  /** Resolve the products and apply the serial rules, before anything is written. */
  private async prepareLines(raw: TransferLineDto[]) {
    if (!raw?.length) throw new BadRequestException('Add at least one product to transfer');

    const productIds = raw.map((l) => l.productId);
    const dupes = productIds.filter((id, i) => productIds.indexOf(id) !== i);
    if (dupes.length) {
      // Two lines for one product would each be applied, so the sheet would say 5 and the balance
      // would move by 10. Refusing is clearer than silently summing them.
      throw new BadRequestException('The same product appears on more than one line — combine them into a single quantity');
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true, mainSku: true, serialTracked: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return raw.map((line) => {
      const product = byId.get(line.productId);
      if (!product) throw new NotFoundException(`Product ${line.productId} not found`);

      const serials = normaliseSerials(line.serials ?? [], product.mainSku);

      if (product.serialTracked) {
        if (!serials.length) throw new BadRequestException(`${product.mainSku} is serial-tracked — name the serial numbers being moved`);
        // The quantity is not independent information for a tracked product; disagreeing with the
        // list means one of the two is a mistake, and we cannot tell which.
        if (line.quantity != null && line.quantity !== serials.length) {
          throw new BadRequestException(
            `${product.mainSku}: quantity is ${line.quantity} but ${serials.length} serial${serials.length === 1 ? ' was' : 's were'} named`,
          );
        }
        return { productId: product.id, sku: product.mainSku, quantity: serials.length, serials };
      }

      if (serials.length) {
        throw new BadRequestException(`${product.mainSku} is not serial-tracked — remove the serial numbers, or turn tracking on for it first`);
      }
      if (!Number.isInteger(line.quantity) || (line.quantity as number) <= 0) {
        throw new BadRequestException(`${product.mainSku}: quantity must be a whole number above zero`);
      }
      return { productId: product.id, sku: product.mainSku, quantity: line.quantity as number, serials: [] as string[] };
    });
  }

  /** Every named serial must be on this product's shelf in this warehouse, right now. */
  private async assertSerialsOnShelf(
    tx: Prisma.TransactionClient,
    productId: string,
    serials: string[],
    warehouseId: string,
    sku: string,
  ) {
    const found = await tx.serialNumber.findMany({
      where: { productId, serial: { in: serials } },
      select: { serial: true, status: true, warehouseId: true },
    });
    const bySerial = new Map(found.map((f) => [f.serial, f]));

    const unknown = serials.filter((s) => !bySerial.has(s));
    if (unknown.length) throw new BadRequestException(`${sku}: not a registered serial — ${unknown.join(', ')}`);

    const gone = found.filter((f) => f.status !== 'in_stock');
    if (gone.length) {
      throw new BadRequestException(`${sku}: no longer in stock — ${gone.map((f) => `${f.serial} (${f.status.replace(/_/g, ' ')})`).join(', ')}`);
    }

    const elsewhere = found.filter((f) => f.warehouseId !== warehouseId);
    if (elsewhere.length) {
      throw new BadRequestException(`${sku}: not in the source warehouse — ${elsewhere.map((f) => f.serial).join(', ')}`);
    }
  }

  // ---------------------------------------------------------------- import

  /**
   * Dry-run a transfer sheet. Reports every problem in every row before a single unit moves,
   * mirroring the opening-stock import: nothing is written unless the whole file is clean.
   *
   * Rows sharing a source and destination become one transfer, which is what a sheet of twelve
   * lines from Main Warehouse to Office plainly means.
   */
  async importValidate(rows: TransferImportRowDto[], companyIds?: string[]) {
    const warehouses = await this.prisma.warehouse.findMany({
      where: { deletedAt: null, isActive: true, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: { id: true, name: true, companyId: true },
    });
    const byName = new Map(warehouses.map((w) => [w.name.trim().toLowerCase(), w]));

    const skus = [...new Set(rows.map((r) => String(r.sku ?? '').trim()).filter(Boolean))];
    const bySku = await this.resolveSkus(skus);

    // On-hand and serial state are read once for the whole sheet, then decremented as rows are
    // walked. Checking each row against the database alone would pass three rows of 10 against a
    // balance of 15, and only the third would fail — at commit time, with the first two applied.
    const onHand = new Map<string, number>();
    const levels = await this.prisma.stockLevel.findMany({
      where: { productId: { in: [...new Set([...bySku.values()].map((p) => p.id))] } },
      select: { productId: true, warehouseId: true, quantityOnHand: true },
    });
    for (const l of levels) onHand.set(`${l.productId}|${l.warehouseId}`, l.quantityOnHand);

    const claimed = new Set<string>();

    const out = rows.map((raw, i) => {
      const errors: string[] = [];
      const sku = String(raw.sku ?? '').trim();
      const fromName = String(raw.fromWarehouse ?? '').trim();
      const toName = String(raw.toWarehouse ?? '').trim();
      const qtyRaw = String(raw.quantity ?? '').trim();
      const serials = parseSerials(raw.serials);

      const product = sku ? bySku.get(sku.toLowerCase()) : undefined;
      if (!sku) errors.push('SKU is required');
      else if (!product) errors.push(`SKU "${sku}" is not in the catalogue`);

      const from = fromName ? byName.get(fromName.toLowerCase()) : undefined;
      const to = toName ? byName.get(toName.toLowerCase()) : undefined;
      if (!fromName) errors.push('From warehouse is required');
      else if (!from) errors.push(`No active warehouse named "${fromName}"`);
      if (!toName) errors.push('To warehouse is required');
      else if (!to) errors.push(`No active warehouse named "${toName}"`);
      if (from && to && from.id === to.id) errors.push('From and To are the same warehouse');
      if (from && to && from.companyId !== to.companyId) errors.push('Those warehouses belong to different companies — that is a sale, not a transfer');

      let quantity: number | null = null;
      if (product?.serialTracked) {
        if (!serials.length) errors.push(`${sku} is serial-tracked — list the serial numbers being moved`);
        else {
          const dupe = serials.filter((s, idx) => serials.indexOf(s) !== idx);
          if (dupe.length) errors.push(`The same serial is listed twice: ${[...new Set(dupe)].join(', ')}`);
          if (qtyRaw !== '' && Number(qtyRaw) !== serials.length) {
            errors.push(`Quantity says ${qtyRaw} but ${serials.length} serial(s) were listed`);
          }
          quantity = serials.length;
          for (const s of serials) {
            const key = `${product.id}|${s}`;
            if (claimed.has(key)) errors.push(`Serial ${s} is moved twice in this file`);
            claimed.add(key);
          }
        }
      } else if (product) {
        if (serials.length) errors.push(`${sku} is not serial-tracked — leave the serials column empty`);
        const n = Number(qtyRaw);
        if (qtyRaw === '') errors.push('Quantity is required');
        else if (!Number.isInteger(n)) errors.push(`Quantity "${qtyRaw}" is not a whole number`);
        else if (n <= 0) errors.push('Quantity must be above zero');
        else quantity = n;
      }

      if (product && from && quantity != null && errors.length === 0) {
        const key = `${product.id}|${from.id}`;
        const available = onHand.get(key) ?? 0;
        if (available < quantity) {
          // "at this row" rather than "and the rows above it": on row 2 there are none, and the
          // figure is the plain balance. It stays true once earlier rows have eaten into it.
          errors.push(`${from.name} has ${available} of ${sku} available at this row — cannot move ${quantity}`);
        } else {
          onHand.set(key, available - quantity);
        }
      }

      return {
        row: i + 2, // +2: 1-based, and the sheet has a header
        sku,
        productId: product?.id ?? null,
        productName: product?.title ?? null,
        serialTracked: product?.serialTracked ?? false,
        fromWarehouse: fromName,
        fromWarehouseId: from?.id ?? null,
        toWarehouse: toName,
        toWarehouseId: to?.id ?? null,
        quantity,
        serials,
        notes: String(raw.notes ?? '').trim() || null,
        errors,
        valid: errors.length === 0,
      };
    });

    return { rows: out, validCount: out.filter((r) => r.valid).length, errorCount: out.filter((r) => !r.valid).length };
  }

  /** Group the validated rows by route and post one transfer per route. */
  async importCommit(rows: TransferImportRowDto[], actorId?: string, companyIds?: string[]) {
    const check = await this.importValidate(rows, companyIds);
    if (check.errorCount > 0) {
      const first = check.rows.find((r) => !r.valid)!;
      throw new BadRequestException(`Row ${first.row}: ${first.errors[0]} — nothing was imported.`);
    }

    const routes = new Map<string, { fromWarehouseId: string; toWarehouseId: string; lines: TransferLineDto[]; notes: string[] }>();
    for (const r of check.rows) {
      const key = `${r.fromWarehouseId}|${r.toWarehouseId}`;
      const route = routes.get(key) ?? { fromWarehouseId: r.fromWarehouseId!, toWarehouseId: r.toWarehouseId!, lines: [], notes: [] };
      // One product may legitimately appear on several rows of a sheet for the same route; the
      // single-transfer path refuses duplicates, so they are summed here rather than there.
      const existing = route.lines.find((l) => l.productId === r.productId);
      if (existing) {
        existing.quantity += r.quantity!;
        existing.serials = [...(existing.serials ?? []), ...r.serials];
      } else {
        route.lines.push({ productId: r.productId!, quantity: r.quantity!, serials: r.serials });
      }
      if (r.notes) route.notes.push(r.notes);
      routes.set(key, route);
    }

    const created: Awaited<ReturnType<TransfersService['create']>>[] = [];
    for (const route of routes.values()) {
      created.push(
        await this.create(
          {
            fromWarehouseId: route.fromWarehouseId,
            toWarehouseId: route.toWarehouseId,
            lines: route.lines,
            notes: [...new Set(route.notes)].join(' · ').slice(0, 500) || null,
          },
          actorId,
          companyIds,
        ),
      );
    }

    return {
      transfers: created,
      transferCount: created.length,
      lineCount: created.reduce((s, t) => s + t.lineCount, 0),
      totalUnits: created.reduce((s, t) => s + t.totalUnits, 0),
    };
  }

  /** SKUs by main code or alias — the same resolution the opening-stock import uses. */
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

/** Trim, drop blanks, and refuse a list that names the same unit twice. */
export function normaliseSerials(raw: string[], sku: string): string[] {
  const cleaned = raw.map((s) => String(s ?? '').trim()).filter(Boolean);
  const dupes = cleaned.filter((s, i) => cleaned.indexOf(s) !== i);
  if (dupes.length) throw new BadRequestException(`${sku}: the same serial is listed twice — ${[...new Set(dupes)].join(', ')}`);
  return cleaned;
}

/**
 * Next transfer reference for the current year: TRF-YYYY-NNNNN.
 *
 * Derived from the highest existing suffix rather than a count, so a deleted row never causes a
 * reuse. Must run inside the same transaction as the insert; the unique index is the real guard if
 * two ever race.
 */
export async function nextTransferReference(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = `TRF-${new Date().getUTCFullYear()}-`;
  const latest = await tx.stockTransfer.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  const lastSeq = latest ? Number(latest.reference.slice(prefix.length)) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

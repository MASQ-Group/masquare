import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DetectedColumn } from './sheet-extract';
import { extractSheet, listSheets } from './workbook';
import { FieldSuggestion, VendorField, VENDOR_FIELDS, capabilitiesOf, suggestMapping } from './field-suggest';
import { MatchedBy, RowMatch, buildIndex, matchRows, norm } from './matcher';
import { PlanProduct, PlanRowInput, buildPlan, summarisePlan } from './plan';

/** Where a mapped column was found, saved so the next file of the same layout resolves itself. */
export interface MappingRef {
  header: string;
  letter: string;
  ordinal: number;
}

export type SavedMapping = Partial<Record<VendorField, MappingRef>>;

const ACTIVE = { deletedAt: null };
/** Vendor price lists are catalogues, not data dumps — anything larger is a mistaken upload. */
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = /\.(csv|xls|xlsx|xlsm)$/i;

@Injectable()
export class VendorImportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Re-resolve a saved mapping against the columns of a freshly uploaded file.
   *
   * Header name first, because vendors add and reorder columns between editions and a saved
   * POSITION can silently point at a different column next month — the failure mode this whole
   * feature exists to avoid. Position is the fallback for genuinely headerless columns, and the
   * caller is told which was used so the UI can flag a mapping that moved.
   */
  resolveSaved(
    saved: SavedMapping,
    columns: DetectedColumn[],
  ): Array<{ field: VendorField; columnIndex: number | null; matchedBy: 'header' | 'position' | null; movedFrom?: string }> {
    const used = new Set<number>();
    return VENDOR_FIELDS.map((field) => {
      const ref = saved[field];
      if (!ref) return { field, columnIndex: null, matchedBy: null };

      const wanted = ref.header.trim().toLowerCase();
      if (wanted) {
        const idx = columns.findIndex((c, i) => !used.has(i) && c.header.trim().toLowerCase() === wanted);
        if (idx >= 0) {
          used.add(idx);
          const moved = columns[idx].letter !== ref.letter;
          return { field, columnIndex: idx, matchedBy: 'header' as const, ...(moved ? { movedFrom: ref.letter } : {}) };
        }
      }
      // No header match: fall back to the letter the mapping was saved against.
      const byLetter = columns.findIndex((c, i) => !used.has(i) && c.letter === ref.letter);
      if (byLetter >= 0) {
        used.add(byLetter);
        return { field, columnIndex: byLetter, matchedBy: 'position' as const };
      }
      return { field, columnIndex: null, matchedBy: null };
    });
  }

  /**
   * Read an uploaded price file and propose a mapping.
   *
   * A saved profile wins over auto-detection where it resolves; detection fills the rest. Nothing
   * is written here — this is the step the user confirms against real sample values.
   */
  async analyse(file: { originalname?: string; size?: number; buffer?: Buffer } | undefined, vendorId?: string, sheet?: string, profileId?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('No file was uploaded.');
    if (file.size != null && file.size > MAX_BYTES) {
      throw new BadRequestException(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Price lists are normally well under ${MAX_BYTES / 1024 / 1024} MB — check it is the right file.`);
    }
    if (file.originalname && !ACCEPTED.test(file.originalname)) {
      throw new BadRequestException('Upload a .csv, .xls or .xlsx file. PDF price lists are not supported yet.');
    }

    let sheets: ReturnType<typeof listSheets>;
    let table: ReturnType<typeof extractSheet>;
    try {
      sheets = listSheets(file.buffer);
      table = extractSheet(file.buffer, sheet);
    } catch {
      throw new BadRequestException('Could not read this file. Make sure it is a valid spreadsheet and not password-protected.');
    }
    if (!table.columns.length || !table.rows.length) {
      throw new BadRequestException('No data rows were found in this sheet. Pick a different sheet, or check the file is not empty.');
    }

    const vendor = vendorId
      ? await this.prisma.vendor.findFirst({ where: { id: vendorId, ...ACTIVE }, select: { id: true, name: true, currency: true, mapIncludesVat: true } })
      : null;
    if (vendorId && !vendor) throw new NotFoundException('Vendor not found');

    const profile = profileId
      ? await this.prisma.vendorImportProfile.findFirst({ where: { id: profileId, ...ACTIVE } })
      : vendorId
        ? await this.prisma.vendorImportProfile.findFirst({ where: { vendorId, ...ACTIVE }, orderBy: { updatedAt: 'desc' } })
        : null;

    const detected = suggestMapping(table.columns);
    const fromProfile = profile ? this.resolveSaved((profile.mapping ?? {}) as SavedMapping, table.columns) : null;

    // Profile where it resolved, detection elsewhere. Both are proposals the user confirms.
    const mapping: Array<FieldSuggestion & { source: 'profile' | 'detected' | 'none'; matchedBy?: string; movedFrom?: string }> = VENDOR_FIELDS.map((field) => {
      const saved = fromProfile?.find((f) => f.field === field);
      if (saved?.columnIndex != null) {
        return {
          field,
          columnIndex: saved.columnIndex,
          confidence: 1,
          reason: saved.matchedBy === 'header'
            ? `saved mapping for ${profile!.name}${saved.movedFrom ? ` — column moved from ${saved.movedFrom}` : ''}`
            : `saved mapping for ${profile!.name}, matched by position`,
          source: 'profile',
          matchedBy: saved.matchedBy ?? undefined,
          movedFrom: saved.movedFrom,
        };
      }
      const auto = detected.find((d) => d.field === field)!;
      return { ...auto, source: auto.columnIndex != null ? ('detected' as const) : ('none' as const) };
    });

    return {
      file: { name: file.originalname ?? 'upload', rows: table.rows.length },
      sheets: sheets.map((s) => ({ name: s.name, rowCount: s.rowCount })),
      sheet: table.sheet,
      headerRowIndex: table.headerRowIndex,
      discarded: table.discarded,
      sectionLabels: table.sectionLabels.slice(0, 10),
      columns: table.columns,
      mapping,
      capabilities: capabilitiesOf(mapping),
      vendor: vendor ? { id: vendor.id, name: vendor.name, currency: vendor.currency, mapIncludesVat: vendor.mapIncludesVat } : null,
      profile: profile ? { id: profile.id, name: profile.name, currency: profile.currency } : null,
      // Never assumed — the user confirms it before any cost is written.
      suggestedCurrency: profile?.currency ?? vendor?.currency ?? 'EUR',
    };
  }

  /**
   * Match an uploaded file's rows to our products, using the mapping the user confirmed.
   *
   * Read-only. Nothing is written: this is the step that answers "how much of this file do we
   * even recognise" before any change is proposed.
   */
  async match(
    file: { originalname?: string; size?: number; buffer?: Buffer } | undefined,
    vendorId: string,
    mapping: Partial<Record<VendorField, number>>,
    sheet?: string,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('No file was uploaded.');
    if (!vendorId) throw new BadRequestException('Choose a vendor before matching.');
    if (mapping?.sku == null) {
      throw new BadRequestException('Map the SKU column first — without it no row can be matched to a product.');
    }
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, ...ACTIVE }, select: { id: true, name: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const table = extractSheet(file.buffer, sheet);
    const col = (f: VendorField) => (mapping[f] != null ? mapping[f]! : -1);
    const cell = (row: string[], f: VendorField) => (col(f) >= 0 ? row[col(f)] ?? '' : '');

    const rows = table.rows.map((r) => ({
      sku: cell(r, 'sku'),
      ean: cell(r, 'ean'),
      manufacturerSku: cell(r, 'manufacturerSku'),
    }));

    // Only fetch products that could plausibly match, rather than the whole catalogue.
    const skus = [...new Set(rows.map((r) => norm(r.sku)).filter(Boolean))];
    const eans = [...new Set(rows.map((r) => String(r.ean ?? '').replace(/\D/g, '')).filter(Boolean))];
    const mfrs = [...new Set(rows.map((r) => norm(r.manufacturerSku)).filter(Boolean))];

    const [products, aliases] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          deletedAt: null,
          OR: [
            ...(skus.length ? [{ mainSku: { in: skus, mode: 'insensitive' as const } }] : []),
            ...(skus.length ? [{ vendorSku: { in: skus, mode: 'insensitive' as const } }] : []),
            ...(eans.length ? [{ ean: { in: eans } }, { upc: { in: eans } }] : []),
            ...(mfrs.length ? [{ manufacturerSku: { in: mfrs, mode: 'insensitive' as const } }] : []),
          ],
        },
        select: { id: true, mainSku: true, title: true, ean: true, upc: true, vendorSku: true, manufacturerSku: true },
      }),
      this.prisma.vendorSkuAlias.findMany({ where: { vendorId, ...ACTIVE }, select: { vendorSku: true, productId: true } }),
    ]);

    const idx = buildIndex(products, aliases);
    const { matches, summary } = matchRows(rows, idx);
    const byId = new Map(products.map((p) => [p.id, p]));

    return {
      vendor: { id: vendor.id, name: vendor.name },
      sheet: table.sheet,
      summary,
      /** Every row, so the UI can show matched and unmatched together in file order. */
      rows: matches.map((m: RowMatch) => {
        const p = m.productId ? byId.get(m.productId) : null;
        return {
          index: m.index,
          vendorSku: rows[m.index].sku,
          ean: rows[m.index].ean,
          manufacturerSku: rows[m.index].manufacturerSku,
          productId: m.productId,
          product: p ? { id: p.id, mainSku: p.mainSku, title: p.title } : null,
          matchedBy: m.matchedBy as MatchedBy | null,
          reason: m.reason ?? null,
          ambiguous: m.ambiguous
            ? {
                by: m.ambiguous.by,
                products: m.ambiguous.productIds
                  .map((id) => byId.get(id))
                  .filter(Boolean)
                  .map((x) => ({ id: x!.id, mainSku: x!.mainSku, title: x!.title })),
              }
            : null,
        };
      }),
    };
  }

  listAliases(vendorId: string) {
    return this.prisma.vendorSkuAlias.findMany({
      where: { vendorId, ...ACTIVE },
      orderBy: { vendorSku: 'asc' },
      include: { product: { select: { id: true, mainSku: true, title: true } } },
    });
  }

  /** Record "this vendor's code means this product". Re-recording a code replaces the decision. */
  async saveAlias(dto: { vendorId: string; vendorSku: string; productId: string }, actorId?: string) {
    const key = norm(dto.vendorSku);
    if (!key) throw new BadRequestException('The vendor code cannot be empty.');
    const [vendor, product] = await Promise.all([
      this.prisma.vendor.findFirst({ where: { id: dto.vendorId, ...ACTIVE }, select: { id: true } }),
      this.prisma.product.findFirst({ where: { id: dto.productId, deletedAt: null }, select: { id: true } }),
    ]);
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (!product) throw new NotFoundException('Product not found');

    const existing = await this.prisma.vendorSkuAlias.findUnique({
      where: { vendorId_vendorSku: { vendorId: dto.vendorId, vendorSku: key } },
    });
    if (existing) {
      return this.prisma.vendorSkuAlias.update({
        where: { id: existing.id },
        data: { productId: dto.productId, deletedAt: null },
        include: { product: { select: { id: true, mainSku: true, title: true } } },
      });
    }
    return this.prisma.vendorSkuAlias.create({
      data: { vendorId: dto.vendorId, vendorSku: key, productId: dto.productId, createdById: actorId },
      include: { product: { select: { id: true, mainSku: true, title: true } } },
    });
  }

  async removeAlias(id: string) {
    await this.prisma.vendorSkuAlias.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  /** Everything preview and apply both need: the matched rows plus the products behind them. */
  private async resolvePlan(
    file: { originalname?: string; buffer?: Buffer } | undefined,
    vendorId: string,
    mapping: Partial<Record<VendorField, number>>,
    currency: string,
    sheet?: string,
    brandDiscounts?: Record<string, number>,
    anomalyPct = 0.3,
  ) {
    const matched = await this.match(file as any, vendorId, mapping, sheet);
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, ...ACTIVE },
      select: { id: true, name: true, mapIncludesVat: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const table = extractSheet(file!.buffer!, sheet);
    const col = (f: VendorField) => (mapping[f] != null ? mapping[f]! : -1);
    const cellOf = (rowIndex: number, f: VendorField) => (col(f) >= 0 ? table.rows[rowIndex]?.[col(f)] ?? '' : '');

    const ids = [...new Set(matched.rows.map((r) => r.productId).filter((x): x is string => !!x))];
    const products = ids.length
      ? await this.prisma.product.findMany({
          where: { id: { in: ids } },
          select: {
            id: true, mainSku: true, title: true,
            purchaseCostAmount: true, purchaseCostCurrency: true,
            mapAmount: true, mapCurrency: true, ean: true, upc: true,
            vatClass: { select: { ratePct: true } },
            availability: { select: { quantity: true } },
            brand: { select: { id: true, name: true } },
          },
        })
      : [];

    const planProducts = new Map<string, PlanProduct>(
      products.map((p) => [
        p.id,
        {
          id: p.id, mainSku: p.mainSku, title: p.title,
          purchaseCostAmount: p.purchaseCostAmount != null ? Number(p.purchaseCostAmount) : null,
          purchaseCostCurrency: p.purchaseCostCurrency ?? 'EUR',
          mapAmount: p.mapAmount != null ? Number(p.mapAmount) : null,
          mapCurrency: p.mapCurrency ?? 'EUR',
          ean: p.ean ?? null, upc: p.upc ?? null,
          availability: p.availability?.quantity ?? null,
          vatRatePct: p.vatClass?.ratePct != null ? Number(p.vatClass.ratePct) : null,
          brandId: p.brand?.id ?? null,
          brandName: p.brand?.name ?? null,
        },
      ]),
    );

    const planRows: PlanRowInput[] = matched.rows
      .filter((r) => r.productId)
      .map((r) => ({
        productId: r.productId!,
        purchaseCost: cellOf(r.index, 'purchaseCost'),
        map: cellOf(r.index, 'map'),
        availability: cellOf(r.index, 'availability'),
        ean: cellOf(r.index, 'ean'),
      }));

    const plan = buildPlan(planRows, planProducts, {
      currency: (currency || 'EUR').toUpperCase(),
      mapIncludesVat: vendor.mapIncludesVat,
      anomalyPct,
      brandDiscounts,
    });
    return { matched, plan, vendor, sheet: table.sheet };
  }

  /** What applying this file WOULD change. Writes nothing. */
  async preview(
    file: { originalname?: string; buffer?: Buffer } | undefined,
    vendorId: string,
    mapping: Partial<Record<VendorField, number>>,
    currency: string,
    sheet?: string,
    brandDiscounts?: Record<string, number>,
  ) {
    const { matched, plan, vendor } = await this.resolvePlan(file, vendorId, mapping, currency, sheet, brandDiscounts);
    return {
      vendor: { id: vendor.id, name: vendor.name, mapIncludesVat: vendor.mapIncludesVat },
      currency: (currency || 'EUR').toUpperCase(),
      match: matched.summary,
      summary: summarisePlan(plan),
      changes: plan.changes,
      skipped: plan.skipped,
    };
  }

  /**
   * Apply the file.
   *
   * Every previous value is captured in the run, so it can be undone in one action. One
   * transaction: a half-applied price list is worse than none, because nobody can tell which
   * half landed.
   */
  async apply(
    file: { originalname?: string; buffer?: Buffer } | undefined,
    vendorId: string,
    mapping: Partial<Record<VendorField, number>>,
    currency: string,
    sheet?: string,
    profileId?: string,
    actorId?: string,
    brandDiscounts?: Record<string, number>,
  ) {
    const { matched, plan, sheet: sheetName } = await this.resolvePlan(file, vendorId, mapping, currency, sheet, brandDiscounts);
    if (!plan.changes.length) {
      throw new BadRequestException('This file proposes no changes — nothing to apply.');
    }
    const ccy = (currency || 'EUR').toUpperCase();

    return this.prisma.$transaction(
      async (tx) => {
        const run = await tx.vendorImportRun.create({
          data: {
            vendorId,
            profileId: profileId ?? null,
            fileName: file?.originalname ?? 'upload',
            sheetName,
            currency: ccy,
            rowsTotal: matched.summary.total,
            rowsMatched: matched.summary.matched,
            changed: plan.changes.length,
            brandDiscounts: (brandDiscounts && Object.keys(brandDiscounts).length ? brandDiscounts : undefined) as object | undefined,
            createdById: actorId ?? null,
          },
        });

        for (const c of plan.changes) {
          await tx.vendorImportChange.create({
            data: { runId: run.id, productId: c.productId, field: c.field, oldValue: c.oldValue, newValue: c.newValue },
          });

          if (c.field === 'purchaseCost') {
            await tx.product.update({
              where: { id: c.productId },
              data: { purchaseCostAmount: Number(c.newValue.split(' ')[0]), purchaseCostCurrency: ccy },
            });
          } else if (c.field === 'map') {
            await tx.product.update({
              where: { id: c.productId },
              data: { mapAmount: Number(c.newValue.split(' ')[0]), mapCurrency: ccy },
            });
          } else if (c.field === 'ean' || c.field === 'upc') {
            await tx.product.update({ where: { id: c.productId }, data: { [c.field]: c.newValue } });
          } else if (c.field === 'availability') {
            const qty = Number(c.newValue);
            const prev = Number(c.oldValue ?? 0);
            await tx.productAvailability.upsert({
              where: { productId: c.productId },
              create: { productId: c.productId, quantity: qty, lastSource: 'vendor_import', updatedById: actorId ?? null },
              update: { quantity: qty, lastSource: 'vendor_import', updatedById: actorId ?? null },
            });
            await tx.availabilityLedger.create({
              data: {
                productId: c.productId,
                delta: qty - prev,
                newQuantity: qty,
                reason: 'vendor_import',
                refType: 'vendor_import_run',
                refId: run.id,
                createdById: actorId ?? null,
              },
            });
          }
        }
        return { runId: run.id, applied: plan.changes.length };
      },
      { timeout: 120000 },
    );
  }

  listRuns(vendorId?: string) {
    return this.prisma.vendorImportRun.findMany({
      where: vendorId ? { vendorId } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { vendor: { select: { id: true, name: true } }, _count: { select: { changes: true } } },
    });
  }

  getRun(id: string) {
    return this.prisma.vendorImportRun.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        changes: { include: { product: { select: { id: true, mainSku: true, title: true } } }, take: 1000 },
      },
    });
  }

  /**
   * Undo a run, putting every field back to the value it held before.
   *
   * Restores from what was recorded at apply time rather than recomputing, so a rollback is not
   * itself an inference. Changes made after the run are overwritten — that is what undo means,
   * and the run stays on record either way.
   */
  async rollback(runId: string, actorId?: string) {
    const run = await this.prisma.vendorImportRun.findUnique({ where: { id: runId }, include: { changes: true } });
    if (!run) throw new NotFoundException('Import run not found');
    if (run.rolledBackAt) throw new BadRequestException('That run has already been rolled back.');

    return this.prisma.$transaction(
      async (tx) => {
        for (const c of run.changes) {
          if (c.revertedAt) continue;
          const parts = (c.oldValue ?? '').split(' ');
          const amount = parts[0];
          const ccy = parts[1];
          if (c.field === 'purchaseCost') {
            await tx.product.update({
              where: { id: c.productId },
              data: { purchaseCostAmount: c.oldValue ? Number(amount) : null, purchaseCostCurrency: ccy || 'EUR' },
            });
          } else if (c.field === 'map') {
            await tx.product.update({
              where: { id: c.productId },
              data: { mapAmount: c.oldValue ? Number(amount) : null, mapCurrency: ccy || 'EUR' },
            });
          } else if (c.field === 'ean' || c.field === 'upc') {
            await tx.product.update({ where: { id: c.productId }, data: { [c.field]: c.oldValue } });
          } else if (c.field === 'availability') {
            const qty = Number(c.oldValue ?? 0);
            const current = await tx.productAvailability.findUnique({
              where: { productId: c.productId },
              select: { quantity: true },
            });
            await tx.productAvailability.upsert({
              where: { productId: c.productId },
              create: { productId: c.productId, quantity: qty, lastSource: 'vendor_import', updatedById: actorId ?? null },
              update: { quantity: qty, lastSource: 'vendor_import', updatedById: actorId ?? null },
            });
            await tx.availabilityLedger.create({
              data: {
                productId: c.productId,
                delta: qty - (current?.quantity ?? 0),
                newQuantity: qty,
                reason: 'vendor_import',
                refType: 'vendor_import_run_rollback',
                refId: run.id,
                note: 'Rolled back',
                createdById: actorId ?? null,
              },
            });
          }
          await tx.vendorImportChange.update({ where: { id: c.id }, data: { revertedAt: new Date() } });
        }
        await tx.vendorImportRun.update({
          where: { id: run.id },
          data: { rolledBackAt: new Date(), rolledBackById: actorId ?? null },
        });
        return { ok: true, reverted: run.changes.length };
      },
      { timeout: 120000 },
    );
  }

  listProfiles(vendorId?: string) {
    return this.prisma.vendorImportProfile.findMany({
      where: { ...ACTIVE, ...(vendorId ? { vendorId } : {}) },
      orderBy: { updatedAt: 'desc' },
      include: { vendor: { select: { id: true, name: true } } },
    });
  }

  async saveProfile(
    dto: { id?: string; vendorId: string; name: string; sheetName?: string | null; currency: string; mapping: SavedMapping },
    actorId?: string,
  ) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, ...ACTIVE }, select: { id: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (!dto.mapping?.sku) {
      throw new BadRequestException('A profile needs at least the SKU column mapped — without it no row can be matched to a product.');
    }
    const data = {
      vendorId: dto.vendorId,
      name: dto.name.trim() || 'Price list',
      sheetName: dto.sheetName ?? null,
      currency: (dto.currency || 'EUR').toUpperCase(),
      mapping: dto.mapping as object,
    };
    if (dto.id) {
      return this.prisma.vendorImportProfile.update({ where: { id: dto.id }, data });
    }
    return this.prisma.vendorImportProfile.create({ data: { ...data, createdById: actorId } });
  }

  async removeProfile(id: string) {
    await this.prisma.vendorImportProfile.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}

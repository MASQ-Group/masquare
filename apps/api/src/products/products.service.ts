import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BulkUpdateDto, CreateProductDto, MoneyDto, UpdateProductDto } from './dto/product.dto';

export interface ProductQuery {
  q?: string;
  field?: string;
  vendorId?: string[];
  brandId?: string[];
  fulfilmentTypeId?: string[];
  productTypeId?: string[];
  categoryId?: string[];
  country?: string;
  page?: number;
  pageSize?: number;
}

const MAX_MEDIA = 8;

const listInclude = {
  brand: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  productType: { select: { id: true, name: true } },
  fulfilmentType: { select: { id: true, name: true, code: true } },
  category: { select: { id: true, name: true } },
  media: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' as const }, take: 1 },
  aliases: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: { fulfilmentType: { select: { id: true, name: true, code: true } } },
  },
  attributes: {
    where: { deletedAt: null },
    include: { attribute: { select: { id: true, name: true, inputType: true } } },
  },
} satisfies Prisma.ProductInclude;

const fullInclude = {
  brand: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  productType: { select: { id: true, name: true } },
  fulfilmentType: { select: { id: true, name: true, code: true } },
  category: { select: { id: true, name: true } },
  aliases: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: { fulfilmentType: { select: { id: true, name: true, code: true } } },
  },
  media: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' as const } },
  attributes: {
    where: { deletedAt: null },
    include: { attribute: { select: { id: true, name: true, inputType: true } } },
  },
  companies: { select: { companyId: true } },
} satisfies Prisma.ProductInclude;

function money(amount: Prisma.Decimal | null, currency: string) {
  return { amount: amount == null ? null : Number(amount), currency };
}
function num(v: Prisma.Decimal | null) {
  return v == null ? null : Number(v);
}
function volumetric(l: Prisma.Decimal | null, w: Prisma.Decimal | null, h: Prisma.Decimal | null) {
  if (l == null || w == null || h == null) return null;
  return Number(((Number(l) * Number(w) * Number(h)) / 5000).toFixed(3));
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private serialize(p: any) {
    return {
      id: p.id,
      mainSku: p.mainSku,
      title: p.title,
      brandId: p.brandId,
      vendorId: p.vendorId,
      productTypeId: p.productTypeId,
      fulfilmentTypeId: p.fulfilmentTypeId,
      categoryId: p.categoryId,
      brand: p.brand ?? null,
      vendor: p.vendor ?? null,
      productType: p.productType ?? null,
      fulfilmentType: p.fulfilmentType ?? null,
      category: p.category ?? null,
      ean: p.ean,
      upc: p.upc,
      vendorSku: p.vendorSku,
      manufacturerSku: p.manufacturerSku,
      countryOfOrigin: p.countryOfOrigin,
      hsCode: p.hsCode,
      purchaseCost: money(p.purchaseCostAmount, p.purchaseCostCurrency),
      map: money(p.mapAmount, p.mapCurrency),
      msrp: money(p.msrpAmount, p.msrpCurrency),
      productWeightKg: num(p.productWeightKg),
      packageWeightKg: num(p.packageWeightKg),
      packageLengthCm: num(p.packageLengthCm),
      packageWidthCm: num(p.packageWidthCm),
      packageHeightCm: num(p.packageHeightCm),
      volumetricWeightKg: volumetric(p.packageLengthCm, p.packageWidthCm, p.packageHeightCm),
      aliases:
        p.aliases?.map((a: any) => ({
          id: a.id,
          skuValue: a.skuValue,
          label: a.label,
          fulfilmentTypeId: a.fulfilmentTypeId,
          fulfilmentType: a.fulfilmentType ?? null,
        })) ?? [],
      media: p.media?.map((m: any) => ({ id: m.id, url: m.url, sortOrder: m.sortOrder })) ?? [],
      attributes:
        p.attributes?.map((a: any) => ({
          id: a.id,
          attributeId: a.attributeId,
          value: a.value,
          attributeName: a.attribute?.name,
          inputType: a.attribute?.inputType,
        })) ?? [],
      companyIds: p.companies?.map((c: any) => c.companyId) ?? [],
      aliasCount: p._count?.aliases ?? p.aliases?.length ?? 0,
      featuredImage: p.media?.[0]?.url ?? null,
    };
  }

  /** SKU namespace = union of every main SKU + every alias, unique platform-wide. */
  private async assertSkuNamespace(skuValues: string[], exceptProductId?: string) {
    const cleaned = skuValues.map((s) => s.trim()).filter(Boolean);
    const lower = cleaned.map((s) => s.toLowerCase());
    const dupInInput = lower.find((v, i) => lower.indexOf(v) !== i);
    if (dupInInput) throw new BadRequestException(`Duplicate SKU in this product: "${dupInInput}"`);

    const mainClash = await this.prisma.product.findFirst({
      where: {
        deletedAt: null,
        mainSku: { in: cleaned, mode: 'insensitive' },
        ...(exceptProductId ? { id: { not: exceptProductId } } : {}),
      },
      select: { mainSku: true },
    });
    if (mainClash) throw new BadRequestException(`SKU "${mainClash.mainSku}" is already used by another product`);

    const aliasClash = await this.prisma.productSkuAlias.findFirst({
      where: {
        deletedAt: null,
        skuValue: { in: cleaned, mode: 'insensitive' },
        ...(exceptProductId ? { productId: { not: exceptProductId } } : {}),
      },
      select: { skuValue: true },
    });
    if (aliasClash) throw new BadRequestException(`SKU "${aliasClash.skuValue}" is already used as an alias`);
  }

  /** Companies that co-own products (participants of the shared Products module). */
  private async coOwnerCompanyIds(): Promise<string[]> {
    const shared = await this.prisma.moduleSharing.findMany({
      where: { module: { key: 'products' }, deletedAt: null },
      select: { companyId: true },
    });
    let ids = shared.map((s) => s.companyId);
    if (!ids.length) {
      const enabled = await this.prisma.companyModule.findMany({
        where: { module: { key: 'products' }, enabled: true, deletedAt: null },
        select: { companyId: true },
      });
      ids = enabled.map((e) => e.companyId);
    }
    return [...new Set(ids)];
  }

  async list(query: ProductQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));

    const and: Prisma.ProductWhereInput[] = [{ deletedAt: null }];
    if (query.vendorId?.length) and.push({ vendorId: { in: query.vendorId } });
    if (query.brandId?.length) and.push({ brandId: { in: query.brandId } });
    if (query.fulfilmentTypeId?.length) and.push({ fulfilmentTypeId: { in: query.fulfilmentTypeId } });
    if (query.productTypeId?.length) and.push({ productTypeId: { in: query.productTypeId } });
    if (query.categoryId?.length) and.push({ categoryId: { in: query.categoryId } });
    if (query.country) and.push({ countryOfOrigin: { equals: query.country, mode: 'insensitive' } });

    const q = query.q?.trim();
    if (q) {
      const like = { contains: q, mode: 'insensitive' as const };
      if (query.field === 'mainSku') and.push({ mainSku: like });
      else if (query.field === 'title') and.push({ title: like });
      else if (query.field === 'hsCode') and.push({ hsCode: like });
      else if (query.field === 'ean') and.push({ ean: like });
      else {
        and.push({
          OR: [
            { mainSku: like },
            { title: like },
            { ean: like },
            { upc: like },
            { vendorSku: like },
            { manufacturerSku: like },
            { aliases: { some: { deletedAt: null, skuValue: like } } },
            { attributes: { some: { deletedAt: null, value: like } } },
          ],
        });
      }
    }

    const where: Prisma.ProductWhereInput = { AND: and };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { items: rows.map((r) => this.serialize(r)), total, page, pageSize };
  }

  async get(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: fullInclude });
    if (!product) throw new NotFoundException('Product not found');
    return this.serialize(product);
  }

  private scalarData(dto: CreateProductDto | UpdateProductDto) {
    const m = (v?: MoneyDto) => ({ amount: v?.amount ?? null, currency: v?.currency ?? 'EUR' });
    const pc = m(dto.purchaseCost);
    const map = m(dto.map);
    const msrp = m(dto.msrp);
    return {
      mainSku: dto.mainSku?.trim(),
      title: dto.title,
      brandId: dto.brandId ?? null,
      vendorId: dto.vendorId ?? null,
      productTypeId: dto.productTypeId ?? null,
      fulfilmentTypeId: dto.fulfilmentTypeId ?? null,
      categoryId: dto.categoryId ?? null,
      ean: dto.ean,
      upc: dto.upc,
      vendorSku: dto.vendorSku,
      manufacturerSku: dto.manufacturerSku,
      countryOfOrigin: dto.countryOfOrigin,
      hsCode: dto.hsCode,
      purchaseCostAmount: pc.amount,
      purchaseCostCurrency: pc.currency,
      mapAmount: map.amount,
      mapCurrency: map.currency,
      msrpAmount: msrp.amount,
      msrpCurrency: msrp.currency,
      productWeightKg: dto.productWeightKg ?? null,
      packageWeightKg: dto.packageWeightKg ?? null,
      packageLengthCm: dto.packageLengthCm ?? null,
      packageWidthCm: dto.packageWidthCm ?? null,
      packageHeightCm: dto.packageHeightCm ?? null,
    };
  }

  async create(dto: CreateProductDto, actorId?: string) {
    const skuValues = [dto.mainSku, ...(dto.aliases?.map((a) => a.skuValue) ?? [])];
    await this.assertSkuNamespace(skuValues);
    const companyIds = await this.coOwnerCompanyIds();

    const product = await this.prisma.product.create({
      data: {
        ...this.scalarData(dto),
        createdById: actorId,
        updatedById: actorId,
        aliases: dto.aliases?.length
          ? {
              create: dto.aliases.map((a) => ({
                skuValue: a.skuValue.trim(),
                label: a.label,
                fulfilmentTypeId: a.fulfilmentTypeId ?? null,
              })),
            }
          : undefined,
        attributes: dto.attributes?.length
          ? { create: dto.attributes.map((a) => ({ attributeId: a.attributeId, value: a.value })) }
          : undefined,
        companies: companyIds.length ? { create: companyIds.map((companyId) => ({ companyId })) } : undefined,
      },
      include: fullInclude,
    });
    return this.serialize(product);
  }

  async update(id: string, dto: UpdateProductDto, actorId?: string) {
    await this.get(id);
    const skuValues = [dto.mainSku, ...(dto.aliases?.map((a) => a.skuValue) ?? [])].filter(Boolean) as string[];
    if (skuValues.length) await this.assertSkuNamespace(skuValues, id);

    const product = await this.prisma.$transaction(async (tx) => {
      if (dto.aliases) {
        await tx.productSkuAlias.deleteMany({ where: { productId: id } });
        if (dto.aliases.length) {
          await tx.productSkuAlias.createMany({
            data: dto.aliases.map((a) => ({
              productId: id,
              skuValue: a.skuValue.trim(),
              label: a.label,
              fulfilmentTypeId: a.fulfilmentTypeId ?? null,
            })),
          });
        }
      }
      if (dto.attributes) {
        await tx.productAttribute.deleteMany({ where: { productId: id } });
        if (dto.attributes.length) {
          await tx.productAttribute.createMany({
            data: dto.attributes.map((a) => ({ productId: id, attributeId: a.attributeId, value: a.value })),
          });
        }
      }
      return tx.product.update({
        where: { id },
        data: { ...this.scalarData(dto), updatedById: actorId },
        include: fullInclude,
      });
    });
    return this.serialize(product);
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  // --- Bulk operations -----------------------------------------------------
  async byIds(ids: string[]) {
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: fullInclude,
    });
    return rows.map((r) => this.serialize(r));
  }

  async bulkDelete(ids: string[]) {
    const res = await this.prisma.product.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { ok: true, count: res.count };
  }

  async bulkUpdate(dto: BulkUpdateDto, actorId?: string) {
    const data: Prisma.ProductUpdateManyMutationInput = { updatedById: actorId };
    let touched = false;
    if (dto.productTypeId !== undefined) { (data as any).productTypeId = dto.productTypeId; touched = true; }
    if (dto.categoryId !== undefined) { (data as any).categoryId = dto.categoryId; touched = true; }
    if (touched) {
      await this.prisma.product.updateMany({ where: { id: { in: dto.ids }, deletedAt: null }, data });
    }
    if (dto.attributes?.length) {
      for (const pid of dto.ids) {
        for (const a of dto.attributes) {
          await this.prisma.productAttribute.upsert({
            where: { productId_attributeId: { productId: pid, attributeId: a.attributeId } },
            create: { productId: pid, attributeId: a.attributeId, value: a.value },
            update: { value: a.value, deletedAt: null },
          });
        }
      }
    }
    return { ok: true, count: dto.ids.length };
  }

  // --- Bulk import: validate then commit -----------------------------------
  /** Field-level checks on a single import row. Errors block the row from being
   *  imported; warnings are informational. Every value is read as a string, so a
   *  stray numeric/blank cell can never crash the review. */
  private validateImportRow(row: Record<string, unknown>): { field: string; message: string; severity: 'error' | 'warning' }[] {
    const issues: { field: string; message: string; severity: 'error' | 'warning' }[] = [];
    const get = (k: string) => (row[k] == null ? '' : String(row[k]).trim());

    if (!get('mainSku') && !get('sku')) issues.push({ field: 'mainSku', message: 'Main SKU is required', severity: 'error' });
    if (!get('title')) issues.push({ field: 'title', message: 'Title is required', severity: 'error' });

    const numericFields: [string, string][] = [
      ['purchaseCost', 'Purchase cost'], ['map', 'MAP'], ['msrp', 'MSRP'],
      ['productWeightKg', 'Product weight'], ['packageWeightKg', 'Package weight'],
      ['packageLengthCm', 'Package length'], ['packageWidthCm', 'Package width'], ['packageHeightCm', 'Package height'],
    ];
    for (const [key, label] of numericFields) {
      const v = get(key);
      if (v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n)) issues.push({ field: key, message: `${label} must be a number (got "${v}")`, severity: 'error' });
      else if (n < 0) issues.push({ field: key, message: `${label} cannot be negative`, severity: 'error' });
    }

    for (const [key, label] of [['ean', 'EAN'], ['upc', 'UPC']] as [string, string][]) {
      const v = get(key);
      if (v && !/^\d{6,14}$/.test(v)) issues.push({ field: key, message: `${label} should be 6–14 digits (got "${v}")`, severity: 'warning' });
    }
    return issues;
  }

  async importValidate(purpose: 'add' | 'edit', rows: Record<string, unknown>[]) {
    const out: Array<{
      index: number; sku: string; title: string; status: string;
      conflictOn: string[]; existingProductId: string | null; existingSku: string | null;
      issues: { field: string; message: string; severity: 'error' | 'warning' }[];
    }> = [];
    const seenSku = new Map<string, number>(); // within-file duplicate detection

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? {};
      const get = (k: string) => (row[k] == null ? '' : String(row[k]).trim());
      const sku = get('mainSku') || get('sku');
      const ean = get('ean');
      const upc = get('upc');

      const issues = this.validateImportRow(row);
      if (sku) {
        const dupOf = seenSku.get(sku.toLowerCase());
        if (dupOf != null) issues.push({ field: 'mainSku', message: `Duplicate of row ${dupOf + 1} in this file`, severity: 'error' });
        else seenSku.set(sku.toLowerCase(), i);
      }

      try {
        const bySku = sku
          ? await this.prisma.product.findFirst({
              where: {
                deletedAt: null,
                OR: [
                  { mainSku: { equals: sku, mode: 'insensitive' } },
                  { aliases: { some: { deletedAt: null, skuValue: { equals: sku, mode: 'insensitive' } } } },
                ],
              },
              select: { id: true, mainSku: true },
            })
          : null;
        const byEan = ean ? await this.prisma.product.findFirst({ where: { deletedAt: null, ean: { equals: ean, mode: 'insensitive' } }, select: { id: true, mainSku: true } }) : null;
        const byUpc = upc ? await this.prisma.product.findFirst({ where: { deletedAt: null, upc: { equals: upc, mode: 'insensitive' } }, select: { id: true, mainSku: true } }) : null;

        const matched = bySku ?? byEan ?? byUpc;
        const conflictOn: string[] = [];
        if (bySku) conflictOn.push('SKU');
        if (byEan) conflictOn.push('EAN');
        if (byUpc) conflictOn.push('UPC');

        const hasError = issues.some((x) => x.severity === 'error');
        const status = hasError ? 'error' : purpose === 'add' ? (matched ? 'conflict' : 'new') : matched ? 'match' : 'missing';

        out.push({ index: i, sku, title: get('title'), status, conflictOn, existingProductId: matched?.id ?? null, existingSku: matched?.mainSku ?? null, issues });
      } catch (e: any) {
        // A single bad row must never fail the whole review — report it as an error row.
        out.push({ index: i, sku, title: get('title'), status: 'error', conflictOn: [], existingProductId: null, existingSku: null, issues: [...issues, { field: 'row', message: e?.message ?? 'Could not read this row', severity: 'error' }] });
      }
    }
    return { rows: out };
  }

  private async resolveNamed(kind: string, name?: string): Promise<string | null> {
    const n = (name ?? '').trim();
    if (!n) return null;
    const insensitive = { equals: n, mode: 'insensitive' as const };
    switch (kind) {
      case 'brand': {
        const e = await this.prisma.brand.findFirst({ where: { name: insensitive, deletedAt: null } });
        return e?.id ?? (await this.prisma.brand.create({ data: { name: n } })).id;
      }
      case 'vendor': {
        const e = await this.prisma.vendor.findFirst({ where: { name: insensitive, deletedAt: null } });
        return e?.id ?? (await this.prisma.vendor.create({ data: { name: n } })).id;
      }
      case 'productType': {
        const e = await this.prisma.productType.findFirst({ where: { name: insensitive, deletedAt: null } });
        return e?.id ?? (await this.prisma.productType.create({ data: { name: n } })).id;
      }
      case 'fulfilmentType': {
        const e = await this.prisma.fulfilmentType.findFirst({
          where: { deletedAt: null, OR: [{ name: insensitive }, { code: insensitive }] },
        });
        return e?.id ?? (await this.prisma.fulfilmentType.create({ data: { name: n } })).id;
      }
      case 'category': {
        const e = await this.prisma.productCategory.findFirst({ where: { name: insensitive, deletedAt: null } });
        return e?.id ?? (await this.prisma.productCategory.create({ data: { name: n } })).id;
      }
      default:
        return null;
    }
  }

  private async rowToBody(row: Record<string, unknown>): Promise<CreateProductDto> {
    // Coerce every cell to a string up-front so numeric/blank cells can't crash.
    const str = (k: string) => (row[k] == null ? undefined : String(row[k]).trim() || undefined);
    const num = (k: string) => {
      const v = str(k);
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      mainSku: (str('mainSku') ?? str('sku') ?? '').trim(),
      title: (str('title') ?? '').trim(),
      brandId: await this.resolveNamed('brand', str('brand')),
      vendorId: await this.resolveNamed('vendor', str('vendor')),
      productTypeId: await this.resolveNamed('productType', str('productType')),
      fulfilmentTypeId: await this.resolveNamed('fulfilmentType', str('fulfilmentType')),
      categoryId: await this.resolveNamed('category', str('category')),
      ean: str('ean'), upc: str('upc'), vendorSku: str('vendorSku'), manufacturerSku: str('manufacturerSku'),
      countryOfOrigin: str('countryOfOrigin'), hsCode: str('hsCode'),
      purchaseCost: { amount: num('purchaseCost'), currency: 'EUR' },
      map: { amount: num('map'), currency: 'EUR' },
      msrp: { amount: num('msrp'), currency: 'EUR' },
      productWeightKg: num('productWeightKg'),
      packageWeightKg: num('packageWeightKg'),
      packageLengthCm: num('packageLengthCm'),
      packageWidthCm: num('packageWidthCm'),
      packageHeightCm: num('packageHeightCm'),
    } as CreateProductDto;
  }

  async importCommit(
    items: { row: Record<string, string>; action: 'add' | 'edit' | 'skip'; productId?: string }[],
    actorId?: string,
  ) {
    let created = 0, updated = 0, skipped = 0;
    const errors: { sku: string; message: string }[] = [];
    for (const item of items) {
      if (item.action === 'skip') { skipped++; continue; }
      try {
        const body = await this.rowToBody(item.row);
        if (!body.mainSku || !body.title) throw new Error('Main SKU and Title are required');
        if (item.action === 'edit' && item.productId) {
          await this.update(item.productId, body as UpdateProductDto, actorId);
          updated++;
        } else {
          await this.create(body, actorId);
          created++;
        }
      } catch (e: any) {
        errors.push({ sku: (item.row.mainSku ?? item.row.sku ?? '').trim(), message: e?.message ?? 'Failed' });
      }
    }
    return { created, updated, skipped, errors };
  }

  // --- Media ---------------------------------------------------------------
  async addMedia(id: string, file: { buffer: Buffer; originalname: string; mimetype: string }) {
    await this.get(id);
    const count = await this.prisma.productMedia.count({ where: { productId: id, deletedAt: null } });
    if (count >= MAX_MEDIA) throw new BadRequestException(`A product can have at most ${MAX_MEDIA} images`);

    const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      throw new BadRequestException('Only jpg, png, or webp images are allowed');
    }
    const key = `products/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const url = await this.storage.putObject(key, file.buffer, file.mimetype);
    await this.prisma.productMedia.create({ data: { productId: id, url, sortOrder: count } });
    return this.get(id);
  }

  async deleteMedia(id: string, mediaId: string) {
    await this.prisma.productMedia.updateMany({
      where: { id: mediaId, productId: id },
      data: { deletedAt: new Date() },
    });
    return this.get(id);
  }

  async reorderMedia(id: string, orderedIds: string[]) {
    await this.prisma.$transaction(
      orderedIds.map((mediaId, index) =>
        this.prisma.productMedia.updateMany({
          where: { id: mediaId, productId: id },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.get(id);
  }
}

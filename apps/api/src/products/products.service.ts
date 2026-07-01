import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateProductDto, MoneyDto, UpdateProductDto } from './dto/product.dto';

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
  attributes: {
    where: { deletedAt: null },
    include: { attribute: { select: { id: true, name: true, inputType: true } } },
  },
  _count: { select: { aliases: true } },
} satisfies Prisma.ProductInclude;

const fullInclude = {
  brand: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  productType: { select: { id: true, name: true } },
  fulfilmentType: { select: { id: true, name: true, code: true } },
  category: { select: { id: true, name: true } },
  aliases: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' as const } },
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
      aliases: p.aliases?.map((a: any) => ({ id: a.id, skuValue: a.skuValue, label: a.label })) ?? [],
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
          ? { create: dto.aliases.map((a) => ({ skuValue: a.skuValue.trim(), label: a.label })) }
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
            data: dto.aliases.map((a) => ({ productId: id, skuValue: a.skuValue.trim(), label: a.label })),
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

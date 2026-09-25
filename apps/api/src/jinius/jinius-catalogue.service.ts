import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  readImportPermission, readJiniusAttributes, readJiniusHierarchies, readJiniusProductMatches, requiredAttributes,
  type JiniusCapability,
} from './jinius-catalogue';

/** Mirakl's catalogue endpoints, by its own codes. */
const PATHS = {
  /** H11 — the operator's category tree. */
  hierarchies: '/api/hierarchies',
  /** PM11 — the attributes a category asks for. */
  attributes: '/api/products/attributes',
  /** P31 — look products up by reference (EAN and the like). */
  products: '/api/products',
  /** P51 — product imports; reading the list needs the same permission as creating one. */
  productImports: '/api/products/imports',
  /** VL11 — the operator's value lists. */
  valuesLists: '/api/values_lists',
} as const;

/**
 * The reference types worth trying, because the operator chooses which it matches on.
 *
 * Mirakl's own documentation says SHOP_SKU and SKU are not valid here, and leaves the rest to the
 * operator: a marketplace may key on EAN, on GTIN, on UPC, or on a code of its own. Asking with each
 * in turn is the only way to learn which, and it is three cheap reads.
 */
const REFERENCE_TYPES = ['EAN', 'GTIN', 'UPC'] as const;

/**
 * What Jinius allows, asked of Jinius.
 *
 * Read-only, and deliberately the first thing built for listing: a Mirakl marketplace decides for
 * itself which product references it matches on, which categories exist, what each demands, and
 * whether sellers may add products at all. Building a listing flow on assumptions about any of that
 * is how a feature gets written twice.
 */
@Injectable()
export class JiniusCatalogueService {
  private readonly logger = new Logger(JiniusCatalogueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  private async integration(integrationId?: string, companyIds?: string[]) {
    const rows = await this.prisma.channelIntegration.findMany({
      where: {
        deletedAt: null, channelType: 'jinius',
        ...(integrationId ? { id: integrationId } : {}),
        ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!rows.length) throw new NotFoundException('No Jinius connection is set up for this company.');
    if (!integrationId && rows.length > 1) throw new BadRequestException('More than one Jinius connection — say which.');
    return rows[0];
  }

  /**
   * Ask Jinius what it allows, using a handful of our own barcodes as the test.
   *
   * Nothing is written anywhere — here or at Jinius. The barcodes are ours already; asking whether a
   * marketplace carries a product is the same question its search box answers.
   */
  async probe(integrationId: string | undefined, companyIds: string[], sampleSize = 10) {
    const integration = await this.integration(integrationId, companyIds);

    /**
     * Products we already sell on Jinius, first.
     *
     * The first version sampled our newest products, and every one came back "not carried" — which
     * says nothing, because a product we have never listed there probably is not there. A product we
     * are ALREADY selling on Jinius must exist in its catalogue, so if the lookup cannot find that
     * one, the lookup is wrong rather than the catalogue empty. Newest products fill any remainder,
     * because "are the ones we would list next already there?" is the other half of the question.
     */
    const take = Math.min(Math.max(sampleSize, 1), 25);
    const listedHere = await this.prisma.channelListing.findMany({
      where: { integration: { id: integration.id }, product: { deletedAt: null, ean: { not: null }, NOT: { ean: '' } } },
      take,
      orderBy: { lastPulledAt: 'desc' },
      select: { product: { select: { mainSku: true, title: true, ean: true } } },
    });
    const sampled = listedHere.map((l) => l.product!).filter(Boolean);
    if (sampled.length < take) {
      const more = await this.prisma.product.findMany({
        where: { deletedAt: null, ean: { not: null }, NOT: { ean: '' }, mainSku: { notIn: sampled.map((p) => p.mainSku) } },
        orderBy: { createdAt: 'desc' },
        take: take - sampled.length,
        select: { mainSku: true, title: true, ean: true },
      });
      sampled.push(...more);
    }
    const products = sampled;
    const listedSkus = new Set(listedHere.map((l) => l.product!.mainSku));
    const barcodes = products.map((p) => (p.ean ?? '').trim()).filter(Boolean);

    const [hierarchies, imports] = await Promise.all([
      this.integrations.jiniusGet(integration.id, PATHS.hierarchies, { max: 100 }),
      this.integrations.jiniusGet(integration.id, PATHS.productImports, { max: 1 }),
    ]);

    /** Each reference type in turn; the one that finds anything is the one Jinius matches on. */
    const attempts: { type: string; status: number; matched: number }[] = [];
    let found: ReturnType<typeof readJiniusProductMatches> = [];
    let matchedWith: string | null = null;
    for (const type of REFERENCE_TYPES) {
      if (!barcodes.length) break;
      const r = await this.integrations.jiniusGet(integration.id, PATHS.products, {
        product_references: barcodes.map((b) => `${type}|${b}`).join(','),
      });
      const rows = r.ok ? readJiniusProductMatches(r.json, barcodes) : [];
      const hits = rows.filter((m) => m.found).length;
      attempts.push({ type, status: r.status, matched: hits });
      if (hits > found.filter((m) => m.found).length) { found = rows; matchedWith = type; }
      if (hits === barcodes.length) break; // nothing better to find
    }
    if (!found.length && barcodes.length) found = barcodes.map((reference) => ({ reference, found: false, productId: null, productIdType: null, title: null, categoryCode: null, categoryLabel: null }));

    const capabilities: JiniusCapability[] = [readImportPermission(imports.status)];

    const tree = hierarchies.ok ? readJiniusHierarchies(hierarchies.json) : { categories: [], total: null };
    capabilities.push(hierarchies.ok
      ? { name: 'Read the category tree', allowed: true, detail: `${tree.total ?? tree.categories.length} categories.` }
      : { name: 'Read the category tree', allowed: false, detail: `Jinius answered ${hierarchies.status}.` });

    const carried = found.filter((m) => m.found);
    const tried = attempts.map((a) => `${a.type}: ${a.status === 200 ? `${a.matched} found` : `HTTP ${a.status}`}`).join(', ');
    capabilities.push({
      name: 'Match our products by barcode',
      allowed: carried.length > 0,
      detail: barcodes.length
        ? `${carried.length} of ${barcodes.length} sampled barcodes found${matchedWith ? ` using ${matchedWith}` : ''} (${tried}). `
          + `${listedSkus.size} of the sample are products we already sell on Jinius.`
        : 'No product here has a barcode to look up.',
    });

    /**
     * The attributes of a category we can actually reach — taken from a product Jinius already
     * carries, so the answer describes a real category rather than the first one in the tree.
     */
    let attributes: ReturnType<typeof readJiniusAttributes> = [];
    let attributesFor: string | null = null;
    /**
     * A category we can actually reach: one of a product they carry, else the deepest in the tree.
     * Not every operator flags the end of a branch, and picking the first category would describe a
     * department rather than something a product goes in.
     */
    const deepest = [...tree.categories].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
    const sampleCategory = carried.find((m) => m.categoryCode)?.categoryCode
      ?? tree.categories.find((c) => c.leaf)?.code
      ?? deepest?.code
      ?? null;
    if (sampleCategory) {
      const r = await this.integrations.jiniusGet(integration.id, PATHS.attributes, { hierarchy: sampleCategory });
      if (r.ok) { attributes = readJiniusAttributes(r.json); attributesFor = sampleCategory; }
    }

    const result = {
      integrationId: integration.id,
      integrationName: integration.name,
      capabilities,
      /** What an offer would be created against, as Jinius names it. */
      referenceType: carried[0]?.productIdType ?? null,
      /** Which reference type Jinius answered to, so the listing flow asks with the right one. */
      matchedWith,
      referenceAttempts: attempts,
      sample: found.map((m) => {
        const ours = products.find((p) => (p.ean ?? '').trim() === m.reference) ?? null;
        return {
          ...m,
          sku: ours?.mainSku ?? null,
          ourTitle: ours?.title ?? null,
          /** We already sell this one on Jinius, so their catalogue certainly holds it. */
          weSellThere: !!ours && listedSkus.has(ours.mainSku),
        };
      }),
      categories: tree.categories.slice(0, 15),
      categoryCount: tree.total,
      attributesFor,
      requiredAttributes: requiredAttributes(attributes).map((a) => ({ code: a.code, label: a.label, type: a.type, valuesList: a.valuesList })),
      attributeCount: attributes.length,
    };
    this.logger.log(`Jinius probe: ${carried.length}/${barcodes.length} barcodes carried, ${tree.categories.length} categories, imports ${imports.status}`);
    return result;
  }
}

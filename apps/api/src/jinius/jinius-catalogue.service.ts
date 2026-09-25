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

    // Products of ours with a barcode, newest first: the ones most likely to be listed next.
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, ean: { not: null }, NOT: { ean: '' } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(sampleSize, 1), 25),
      select: { mainSku: true, title: true, ean: true },
    });
    const barcodes = products.map((p) => (p.ean ?? '').trim()).filter(Boolean);

    const [hierarchies, matches, imports] = await Promise.all([
      this.integrations.jiniusGet(integration.id, PATHS.hierarchies, { max: 100 }),
      barcodes.length
        ? this.integrations.jiniusGet(integration.id, PATHS.products, { product_references: barcodes.map((b) => `EAN|${b}`).join(',') })
        : Promise.resolve(null),
      this.integrations.jiniusGet(integration.id, PATHS.productImports, { max: 1 }),
    ]);

    const capabilities: JiniusCapability[] = [readImportPermission(imports.status)];

    const tree = hierarchies.ok ? readJiniusHierarchies(hierarchies.json) : { categories: [], total: null };
    capabilities.push(hierarchies.ok
      ? { name: 'Read the category tree', allowed: true, detail: `${tree.total ?? tree.categories.length} categories.` }
      : { name: 'Read the category tree', allowed: false, detail: `Jinius answered ${hierarchies.status}.` });

    const found = matches?.ok ? readJiniusProductMatches(matches.json, barcodes) : [];
    const carried = found.filter((m) => m.found);
    capabilities.push({
      name: 'Match our products by barcode',
      allowed: carried.length > 0,
      detail: matches
        ? matches.ok
          ? `${carried.length} of ${barcodes.length} sampled barcodes are already in Jinius’s catalogue.`
          : `Jinius answered ${matches.status} to a barcode lookup.`
        : 'No product here has a barcode to look up.',
    });

    /**
     * The attributes of a category we can actually reach — taken from a product Jinius already
     * carries, so the answer describes a real category rather than the first one in the tree.
     */
    let attributes: ReturnType<typeof readJiniusAttributes> = [];
    let attributesFor: string | null = null;
    const sampleCategory = carried.find((m) => m.categoryCode)?.categoryCode ?? tree.categories.find((c) => c.leaf)?.code ?? null;
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
      sample: found.map((m) => ({
        ...m,
        sku: products.find((p) => (p.ean ?? '').trim() === m.reference)?.mainSku ?? null,
        ourTitle: products.find((p) => (p.ean ?? '').trim() === m.reference)?.title ?? null,
      })),
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

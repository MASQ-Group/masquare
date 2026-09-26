import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { ProductFactsService } from '../../gather/product-facts.service';
import { factFor } from '../../gather/fact-names';
import { eligibleValues } from '../../gather/provenance';
import { readProductCopy, renderParagraphs, renderTitle } from '../../gather/product-copy';
import { readJiniusAttributes, readJiniusHierarchies } from '../../jinius/jinius-catalogue';
import { OnbuyImagesService } from '../onbuy/onbuy-images.service';
import {
  jiniusProductCsv, missingForJiniusProduct, readJiniusProductImportId, readJiniusProductImportReport,
  readJiniusProductOutcome, type JiniusAttributeNeed, type JiniusProductInput,
} from './jinius-product';

/** Mirakl's catalogue endpoints, by its own codes. */
const PATHS = {
  /** H11 — the operator's category tree. */
  hierarchies: '/api/hierarchies',
  /** PM11 — the attributes a category asks for. */
  attributes: '/api/products/attributes',
  /** P41 — create products. A FILE, not JSON. */
  productImports: '/api/products/imports',
} as const;

/** Jinius sells in Cyprus; 150 characters is what its own offers carry for a name. */
const NAME_MAX = 150;

/**
 * Creating a product in Jinius's catalogue, so our own words can carry an offer.
 *
 * The offer flow attaches to a product Jinius already holds and the buyer reads THEIR page — fine
 * when their entry is good, useless when it is thin or wrong. IT49693 is already attached to a
 * catalogue product whose barcode is not ours, which is exactly the case this exists for.
 *
 * The values come from what the platform already knows rather than from a second round of typing:
 * the shared facts answer the attributes by name, the shared copy answers the name and description,
 * and the images are the ones already prepared for OnBuy. Anything left is reported as a gap
 * against the attribute's own label, which is the thing a person can go and fix.
 */
@Injectable()
export class JiniusProductService {
  private readonly logger = new Logger(JiniusProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly facts: ProductFactsService,
    private readonly images: OnbuyImagesService,
  ) {}

  /** The same gate every other channel's listing writes use. */
  async liveWritesEnabled(): Promise<boolean> {
    if (process.env.LISTING_LIVE_WRITES === 'false') return false;
    const settings = await this.prisma.platformSettings.findFirst({ select: { listingLiveWrites: true } });
    return settings?.listingLiveWrites ?? false;
  }

  private async integration(integrationId: string | undefined, companyIds?: string[]) {
    const row = await this.prisma.channelIntegration.findFirst({
      where: {
        deletedAt: null, channelType: 'jinius',
        ...(integrationId ? { id: integrationId } : {}),
        ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
      },
      select: { id: true, name: true, marketplace: true, config: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!row) throw new NotFoundException('No Jinius connection is set up for this company.');
    return row;
  }

  /**
   * The delimiter their import expects.
   *
   * An operator's choice, and the one thing about the file format that cannot be read from any API.
   * A setting rather than a constant so a wrong guess is corrected in Settings instead of in a
   * deployment — semicolon is Mirakl's usual default and is what this starts from.
   */
  private delimiterFor(config: unknown): string {
    const c = (config ?? {}) as Record<string, string>;
    const raw = (c.importDelimiter ?? '').trim();
    return raw ? raw.slice(0, 1) : ';';
  }

  /** Their categories, searched by name — the picker and the automatic choice both read this. */
  async categories(integrationId: string | undefined, q: string, companyIds?: string[]) {
    const intg = await this.integration(integrationId, companyIds);
    const r = await this.integrations.jiniusGet(intg.id, PATHS.hierarchies, { max: 100 });
    if (!r.ok) throw new BadRequestException(`Jinius would not list its categories (HTTP ${r.status}).`);
    const all = readJiniusHierarchies(r.json).categories;
    const needle = (q ?? '').trim().toLowerCase();
    const matched = needle ? all.filter((c) => c.label.toLowerCase().includes(needle)) : all;
    return { integrationId: intg.id, total: all.length, categories: matched.slice(0, 50) };
  }

  /** What one of their categories demands, and what it merely accepts. */
  private async needsFor(integrationId: string, categoryCode: string): Promise<JiniusAttributeNeed[]> {
    const r = await this.integrations.jiniusGet(integrationId, PATHS.attributes, { hierarchy: categoryCode });
    if (!r.ok) throw new BadRequestException(`Jinius would not describe that category (HTTP ${r.status}).`);
    return readJiniusAttributes(r.json).map((a) => ({ code: a.code, label: a.label, required: a.requirement === 'REQUIRED' }));
  }

  /**
   * Everything one product import is made of, resolved once so preview and create cannot differ.
   *
   * An attribute is answered by its LABEL rather than its code, because a label is what the rest of
   * the platform calls a fact: "Colour" matches the colour we hold however eBay or OnBuy spelled it
   * when it was found. A code like `FaKiBo_12` matches nothing and never will.
   */
  private async buildInput(productId: string, integrationId: string, categoryCode: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true, mainSku: true, title: true, copy: true, ean: true,
        brand: { select: { name: true } },
        media: { where: { deletedAt: null }, select: { id: true, url: true }, orderBy: { sortOrder: 'asc' }, take: 3 },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const [needs, known] = await Promise.all([
      this.needsFor(integrationId, categoryCode),
      this.facts.facts(productId),
    ]);
    const answers = eligibleValues(known);
    const copy = readProductCopy(product.copy);

    /** The images the platform already converted for OnBuy — the same JPEG, so nothing is done twice. */
    const prepared = product.media.length ? await this.images.prepare(product.media, 3) : { urls: [], problems: [] };

    const values: Record<string, string> = {};
    for (const need of needs) {
      const label = need.label.toLowerCase();
      let value = '';
      if (label.includes('shop sku') || label === 'sku') value = product.mainSku;
      else if (label === 'category') value = categoryCode;
      else if (label === 'name' || label.includes('product name') || label === 'title') {
        value = renderTitle(copy.title, NAME_MAX) || product.title || '';
      } else if (label.includes('description')) {
        value = renderParagraphs(copy.paragraphs, 'plain');
      } else if (label.includes('image')) {
        value = prepared.urls[0] ?? '';
      } else if (label.includes('brand')) {
        value = product.brand?.name ?? '';
      } else if (label === 'ean' || label.includes('barcode') || label.includes('gtin')) {
        value = product.ean ?? '';
      } else {
        // Everything else comes from what the platform already knows, matched by what the fact IS.
        value = factFor(answers, need.label) ?? '';
      }
      if (value.trim()) values[need.code] = value.trim();
    }

    const input: JiniusProductInput = { shopSku: product.mainSku, categoryCode, values };
    return { product, needs, input, imageProblems: prepared.problems };
  }

  /** What would be sent, what answers it, and what still stops it. Sends nothing. */
  async preview(productId: string, integrationId: string | undefined, categoryCode: string, companyIds?: string[]) {
    const intg = await this.integration(integrationId, companyIds);
    if (!(categoryCode ?? '').trim()) throw new BadRequestException('Choose a Jinius category first — it decides which attributes exist.');
    const { needs, input, imageProblems } = await this.buildInput(productId, intg.id, categoryCode);
    const delimiter = this.delimiterFor(intg.config);

    return {
      integrationId: intg.id,
      categoryCode,
      shopSku: input.shopSku,
      /** Every attribute, with what answers it and where that answer came from. */
      attributes: needs.map((n) => ({
        code: n.code, label: n.label, required: n.required, value: input.values[n.code] ?? null,
      })),
      missing: missingForJiniusProduct(needs, input),
      imageProblems,
      /** The file itself, so a person can see exactly what leaves the building. */
      file: { name: 'products.csv', delimiter, content: jiniusProductCsv(input, delimiter) },
      liveWrites: await this.liveWritesEnabled(),
    };
  }

  /**
   * Send the product to Jinius, and wait long enough to say what happened.
   *
   * Two independent yeses as everywhere else: the platform's listing-writes setting AND an explicit
   * confirm. Mirakl queues the import, so this waits a few seconds rather than claiming success on
   * an acknowledgement — and where it is still running, it says so rather than guessing.
   */
  async create(
    productId: string,
    integrationId: string | undefined,
    args: { categoryCode: string; confirm?: boolean },
    actorId?: string,
    companyIds?: string[],
  ) {
    const intg = await this.integration(integrationId, companyIds);
    const { needs, input } = await this.buildInput(productId, intg.id, args.categoryCode);
    const missing = missingForJiniusProduct(needs, input);
    if (missing.length) throw new BadRequestException(missing.join(' '));

    const delimiter = this.delimiterFor(intg.config);
    const content = jiniusProductCsv(input, delimiter);
    const live = await this.liveWritesEnabled();
    if (!(live && args.confirm === true)) {
      return { ok: true as const, dryRun: true, importId: null as number | null, message: `Validated. ${content.split('\r\n')[0].split(delimiter).length} column(s) would be sent for ${input.shopSku}.` };
    }

    const res = await this.integrations.jiniusPostFile(
      intg.id, PATHS.productImports, { name: 'products.csv', content, type: 'text/csv' },
    );
    const importId = res.ok ? readJiniusProductImportId(res.json) : null;

    let report = null as ReturnType<typeof readJiniusProductImportReport> | null;
    if (importId != null) {
      for (const wait of [1000, 2000, 3000, 4000]) {
        await new Promise((r) => setTimeout(r, wait));
        const r = await this.integrations.jiniusGet(intg.id, `${PATHS.productImports}/${importId}`);
        if (!r.ok) break;
        report = readJiniusProductImportReport(r.json);
        if (report.done) break;
      }
    }

    const outcome = readJiniusProductOutcome(res.status, importId, report);
    this.logger.log(`Jinius product import for ${input.shopSku}: ${outcome.message}`);
    /**
     * The raw answer is kept on a failure.
     *
     * The file format is the one thing about this that could not be read from any API, so the first
     * refusal is the most informative thing that will ever happen — and summarising it away would
     * throw that away.
     */
    return {
      ...outcome,
      dryRun: false,
      importId,
      status: report?.status ?? null,
      theirAnswer: outcome.ok ? null : (res.text ?? '').slice(0, 600),
    };
  }

  /** How an import that was still running has got on since. */
  async importStatus(integrationId: string | undefined, importId: number, companyIds?: string[]) {
    const intg = await this.integration(integrationId, companyIds);
    const r = await this.integrations.jiniusGet(intg.id, `${PATHS.productImports}/${importId}`);
    if (!r.ok) throw new BadRequestException(`Jinius answered ${r.status} when asked about import ${importId}.`);
    const report = readJiniusProductImportReport(r.json);
    return { importId, ...report, ...readJiniusProductOutcome(200, importId, report) };
  }
}

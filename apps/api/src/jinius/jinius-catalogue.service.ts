import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  offerReferenceTypes, readImportPermission, readJiniusAttributes, readJiniusHierarchies, readJiniusOfferAttachments,
  readJiniusProductMatches, readLookupAnswer, requiredAttributes,
  type JiniusCapability, type JiniusLookupAttempt,
} from './jinius-catalogue';
import { readJiniusOfferDetail, readOfferQuantityVerdict, type JiniusOfferDetail } from './jinius-offer-probe';

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
  /** OF21 — our own offers, read here to see what they are attached to. */
  offers: '/api/offers',
} as const;

/**
 * The reference types worth trying, because the operator chooses which it matches on.
 *
 * Mirakl's own documentation says SHOP_SKU and SKU are not valid here, and leaves the rest to the
 * operator: a marketplace may key on EAN, on GTIN, on UPC, or on a code of its own. Asking with each
 * in turn is the only way to learn which, and it is three cheap reads.
 */
const REFERENCE_TYPES = ['EAN', 'GTIN', 'UPC'] as const;

/** How many references to put in one lookup. Small enough that a length limit cannot be the reason. */
const CHUNK = 3;

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

    /**
     * What our own live offers are attached to.
     *
     * Read before anything is looked up, because these are the references Jinius certainly holds:
     * the offers are live. They are what the lookup gets tested with, so a failure can only be about
     * how we asked.
     */
    const offersRead = await this.integrations.jiniusGet(integration.id, PATHS.offers, { max: 5 });
    const ourOffers = offersRead.ok ? readJiniusOfferAttachments(offersRead.json) : [];
    const offerTypes = offerReferenceTypes(ourOffers);

    /** What the sample lookup came to, filled in once the diagnosis below says how to ask. */
    const attempts: { type: string; status: number; matched: number }[] = [];
    let found: ReturnType<typeof readJiniusProductMatches> = barcodes.map((reference) => ({
      reference, found: false, productId: null, productIdType: null, title: null, categoryCode: null, categoryLabel: null,
    }));
    let matchedWith: string | null = null;

    const capabilities: JiniusCapability[] = [readImportPermission(imports.status)];

    const tree = hierarchies.ok ? readJiniusHierarchies(hierarchies.json) : { categories: [], total: null };
    capabilities.push(hierarchies.ok
      ? { name: 'Read the category tree', allowed: true, detail: `${tree.total ?? tree.categories.length} categories.` }
      : { name: 'Read the category tree', allowed: false, detail: `Jinius answered ${hierarchies.status}.` });

    /**
     * Our own barcode next to the one Jinius holds for the same offer.
     *
     * They should be the same code for the same box. Where they differ, either our barcode is wrong or
     * the offer was attached to the wrong catalogue product — and either way no barcode lookup could
     * ever match, which is worth knowing before blaming the endpoint.
     */
    const offerSkus = ourOffers.map((o) => o.shopSku).filter(Boolean);
    const oursBySku = new Map(
      (offerSkus.length
        ? await this.prisma.product.findMany({ where: { mainSku: { in: offerSkus }, deletedAt: null }, select: { mainSku: true, ean: true } })
        : []
      ).map((p) => [p.mainSku, (p.ean ?? '').trim()]),
    );
    const offerRows = ourOffers.map((o) => {
      const theirEan = o.references.find((r) => r.type === 'EAN')?.value ?? null;
      const ourEan = oursBySku.get(o.shopSku) || null;
      return { ...o, ourEan, eanDiffers: !!theirEan && !!ourEan && theirEan !== ourEan };
    });

    /**
     * Why a lookup that cannot fail, fails.
     *
     * Every reference asked about below comes off a live offer, so Jinius certainly holds it. If the
     * answer is still empty, the fault is in how we ask, not in what they carry — so the same lookup
     * goes out encoded (as we send it) and exactly as Mirakl documents it, pipe and comma unencoded,
     * and the first of the answer is kept verbatim rather than summarised into another "0 found".
     */
    const liveEans = [...new Set(ourOffers.flatMap((o) => o.references).filter((r) => r.type === 'EAN').map((r) => r.value))];
    const ownRef = ourOffers.flatMap((o) => o.references).find((r) => !['EAN', 'GTIN', 'UPC'].includes(r.type)) ?? null;
    const lookupAttempts: JiniusLookupAttempt[] = [];
    const lookup = async (
      how: string,
      kind: JiniusLookupAttempt['kind'],
      encoding: JiniusLookupAttempt['encoding'],
      type: string,
      values: string[],
      extra: Record<string, string | number> = {},
    ) => {
      const filter = values.map((v) => `${type}|${v}`).join(',');
      const r = encoding === 'encoded'
        ? await this.integrations.jiniusGet(integration.id, PATHS.products, { ...extra, product_references: filter })
        : await this.integrations.jiniusGet(integration.id, PATHS.products, extra, { product_references: filter });
      const list = Array.isArray(r.json?.products) ? r.json.products : null;
      lookupAttempts.push({
        how, kind, encoding, type, asked: values.length, status: r.status,
        products: list ? list.length : null,
        // What came back is not the same question as what we could tie back to the asking.
        matched: list ? readJiniusProductMatches(r.json, values).filter((m) => m.found).length : null,
        excerpt: (r.text ?? '').slice(0, 400),
      });
      return r;
    };
    if (liveEans.length) {
      await lookup('One EAN, encoded as the platform sends it', 'single', 'encoded', 'EAN', liveEans.slice(0, 1));
      await lookup('One EAN, exactly as Mirakl documents it', 'single', 'documented', 'EAN', liveEans.slice(0, 1));
    }
    // A list is the interesting case: it is how the platform asks, and its separator is the comma.
    if (liveEans.length > 1) {
      await lookup(`${Math.min(liveEans.length, 3)} EANs at once, encoded as the platform sends it`, 'list', 'encoded', 'EAN', liveEans.slice(0, 3));
      await lookup(`${Math.min(liveEans.length, 3)} EANs at once, exactly as Mirakl documents it`, 'list', 'documented', 'EAN', liveEans.slice(0, 3));
    }
    if (ownRef) await lookup(`One ${ownRef.type}, exactly as Mirakl documents it`, 'single', 'documented', ownRef.type, [ownRef.value]);
    // With no filter at all: whether the endpoint yields any product to this shop is its own answer.
    await lookup('No filter at all, one row', 'unfiltered', 'encoded', '', [], { max: 1 });

    const listAnswer = readLookupAnswer(lookupAttempts);

    /**
     * Now ask about our own products, the way the diagnosis says works.
     *
     * Deliberately last. Every earlier version asked first, in the one way the platform knew, and
     * reported the empty answer as "Jinius does not carry it" — about products we were selling there
     * at the time. The lookup is only worth running once we know how this marketplace wants to be
     * asked, and the sample table then shows their catalogue rather than our bug.
     */
    if (listAnswer.matchesBack && barcodes.length) {
      const askFor = async (type: string, values: string[]) => {
        if (listAnswer.askOneAtATime) {
          const out: typeof found = [];
          for (const v of values) {
            const r = await this.integrations.jiniusGet(integration.id, PATHS.products, { product_references: `${type}|${v}` });
            out.push(readJiniusProductMatches(r.ok ? r.json : null, [v])[0]);
          }
          return out;
        }
        /**
         * In chunks, because a long list is a different request from a short one.
         * The diagnosis proves at most a few references at a time; nothing proves ten, and a
         * marketplace that quietly ignores an over-long filter would look like an empty catalogue.
         */
        const out: typeof found = [];
        for (let i = 0; i < values.length; i += CHUNK) {
          const part = values.slice(i, i + CHUNK);
          const filter = part.map((v) => `${type}|${v}`).join(',');
          const r = listAnswer.sendUnencoded
            ? await this.integrations.jiniusGet(integration.id, PATHS.products, {}, { product_references: filter })
            : await this.integrations.jiniusGet(integration.id, PATHS.products, { product_references: filter });
          out.push(...readJiniusProductMatches(r.ok ? r.json : null, part));
        }
        return out;
      };

      // The type the diagnosis proved first, then the others: our barcodes may be of another kind.
      const order = [listAnswer.type, ...REFERENCE_TYPES.filter((t) => t !== listAnswer.type)].filter(Boolean) as string[];
      for (const type of order) {
        const rows = await askFor(type, barcodes);
        const hits = rows.filter((m) => m.found).length;
        attempts.push({ type, status: 200, matched: hits });
        if (hits > found.filter((m) => m.found).length) { found = rows; matchedWith = type; }
        if (hits === barcodes.length) break;
      }
    }

    capabilities.push({
      name: 'See what our live offers point at',
      allowed: ourOffers.length > 0,
      detail: !offersRead.ok
        ? `Jinius answered ${offersRead.status} when asked for our offers.`
        : !ourOffers.length
          ? 'No offers came back to read.'
          : offerTypes.length
            ? `Our offers carry ${offerTypes.join(', ')} — so that is what Jinius recognises.`
            : 'Our offers carry no product reference at all: they are attached by a product code of Jinius\u2019s own, not by a barcode.',
    });

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

    capabilities.push({
      name: 'Look a product up in their catalogue',
      allowed: listAnswer.matchesBack,
      detail: listAnswer.matchesBack
        ? `Yes \u2014 asked as "${lookupAttempts.find((a) => (a.matched ?? 0) > 0)!.how}".`
        : listAnswer.works
          ? 'Their answer carries products, but none we can tie back to what we asked \u2014 we are reading the reply wrongly.'
          : 'No \u2014 every way of asking came back empty.',
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
      /** Our own live offers, and the references Jinius holds for them. */
      ourOffers: offerRows,
      offerReferenceTypes: offerTypes,
      /** The same lookup asked several ways, kept verbatim, so an empty answer can be read. */
      lookupAttempts,
      /** What those attempts add up to, and what to do about it. */
      listAnswer,
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
    this.logger.log(
      `Jinius probe: ${carried.length}/${barcodes.length} barcodes carried, ${tree.categories.length} categories, `
      + `imports ${imports.status}, our offers carry [${offerTypes.join(', ')}]`,
    );
    return result;
  }

  /**
   * One offer, exactly as Jinius describes it, beside what we hold for it.
   *
   * For when their API and their seller portal disagree - OF21 answered quantity 3 for 65-16567828
   * while the portal showed 1, minutes after the pull and with nothing ever pushed from here. No
   * summary can settle that; only the field names Jinius actually sends can.
   *
   * Every page is read rather than filtered, because a filter we guessed at is one more thing that
   * could be the reason an offer is not found.
   */
  async offerProbe(integrationId: string | undefined, companyIds: string[], sku: string) {
    const wanted = (sku ?? '').trim();
    if (!wanted) throw new BadRequestException('Give the shop SKU of the offer to look at.');
    const integration = await this.integration(integrationId, companyIds);

    const PAGE = 100;
    const MAX_PAGES = 30;
    let detail: JiniusOfferDetail | null = null;
    let scanned = 0;
    let total: number | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await this.integrations.jiniusGet(integration.id, PATHS.offers, { max: PAGE, offset: page * PAGE });
      if (!r.ok) throw new BadRequestException(`Jinius answered ${r.status} when asked for its offers.`);
      const offers = Array.isArray(r.json?.offers) ? r.json.offers : [];
      if (total == null && typeof r.json?.total_count === 'number') total = r.json.total_count;
      scanned += offers.length;
      detail = readJiniusOfferDetail(r.json, wanted);
      if (detail) break;
      if (!offers.length || (total != null && scanned >= total)) break;
    }

    const row = await this.prisma.channelListing.findFirst({
      where: { integrationId: integration.id, channelSku: wanted },
      select: { listedQuantity: true, listedPrice: true, listingStatus: true, lastPulledAt: true, lastPushedAt: true },
    });

    return {
      integrationId: integration.id,
      sku: wanted,
      scanned,
      totalOffers: total,
      found: !!detail,
      verdict: readOfferQuantityVerdict(detail, row?.listedQuantity ?? null, wanted),
      fields: detail?.fields ?? [],
      ours: row
        ? {
          quantity: row.listedQuantity, price: row.listedPrice, status: row.listingStatus,
          lastPulledAt: row.lastPulledAt, lastPushedAt: row.lastPushedAt,
        }
        : null,
    };
  }
}

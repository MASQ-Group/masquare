import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  offerReferenceTypes, readImportPermission, readJiniusAttributes, readJiniusHierarchies, readJiniusOfferAttachments,
  readJiniusProductMatches, readLookupAnswer, requiredAttributes,
  type JiniusCapability, type JiniusLookupAttempt,
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

    /**
     * What our own live offers are attached to.
     *
     * It only matters when the barcodes found nothing — and then it is the whole answer. These offers
     * are live on Jinius, so every reference they carry is one Jinius recognises.
     */
    const offersRead = await this.integrations.jiniusGet(integration.id, PATHS.offers, { max: 5 });
    const ourOffers = offersRead.ok ? readJiniusOfferAttachments(offersRead.json) : [];
    const offerTypes = offerReferenceTypes(ourOffers);

    /**
     * One more lookup, with a type our own offers carry that we had not thought to ask for.
     *
     * If Jinius keys on something of its own, this is where that is proven: the values come from live
     * offers, so a lookup that still finds nothing means P31 is not the way in at all.
     */
    for (const type of offerTypes) {
      if (attempts.some((a) => a.type === type)) continue;
      const values = ourOffers.flatMap((o) => o.references.filter((r) => r.type === type).map((r) => r.value)).slice(0, 10);
      if (!values.length) continue;
      const r = await this.integrations.jiniusGet(integration.id, PATHS.products, {
        product_references: values.map((v) => `${type}|${v}`).join(','),
      });
      const rows = r.ok ? readJiniusProductMatches(r.json, values) : [];
      const hits = rows.filter((m) => m.found).length;
      attempts.push({ type, status: r.status, matched: hits });
      if (hits > found.filter((m) => m.found).length) { found = rows; matchedWith = type; }
    }

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
        products: list ? list.length : null, excerpt: (r.text ?? '').slice(0, 400),
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
     * Ask the sample again, the way that works.
     *
     * The first pass asked the only way the platform knows, and the diagnosis above has just shown
     * that way to be wrong. Leaving the table reading "not carried" would be reporting our own bug as
     * their catalogue — which is exactly the mistake this whole probe exists to stop.
     */
    if (listAnswer.works && listAnswer.type && barcodes.length && !found.some((m) => m.found)) {
      const type = listAnswer.type;
      let rows: typeof found = [];
      if (listAnswer.askOneAtATime) {
        for (const b of barcodes) {
          const r = await this.integrations.jiniusGet(integration.id, PATHS.products, { product_references: `${type}|${b}` });
          rows.push(readJiniusProductMatches(r.ok ? r.json : null, [b])[0]);
        }
      } else {
        const r = await this.integrations.jiniusGet(
          integration.id, PATHS.products, {}, { product_references: barcodes.map((b) => `${type}|${b}`).join(',') },
        );
        rows = readJiniusProductMatches(r.ok ? r.json : null, barcodes);
      }
      const hits = rows.filter((m) => m.found).length;
      attempts.push({ type: `${type}, asked ${listAnswer.askOneAtATime ? 'one at a time' : 'unencoded'}`, status: 200, matched: hits });
      if (hits) { found = rows; matchedWith = type; }
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
      allowed: listAnswer.works,
      detail: listAnswer.works
        ? `Yes \u2014 asked as "${lookupAttempts.find((a) => (a.products ?? 0) > 0)!.how}".`
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
}

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { buildInventoryItem, buildOffer, ebayItemUrl, ebaySafeSku, missingForPublish, offerUpdateBody, type EbayOfferInput } from './offer-payload';
import { publishIdentity } from './publish-identity';
import { aspectsForPayload, missingAspects, resolveAspects } from './category-plan';
import {
  applyUserEdits, classifyAspect, eligibleValues, isPayloadEligible, normaliseAspects, toJson,
  verifyAspect, type AspectRecord,
} from '../../gather/provenance';
import { canGather, foldFindings, type SourceFinding } from '../../gather/gather-rules';
import { verifyIdentity } from '../../gather/identity';
import { ManufacturerSourceService } from '../../gather/manufacturer-source.service';
import { WebResearchService } from '../../gather/web-research.service';
import { screenResearch, type ResearchedFinding, type ResearchedSource } from '../../gather/screen-research';
import { htmlToPlainText, proseToHtml, renderEbayDescription } from './description-template';
import { checkBuyerText } from '../../gather/buyer-text';
import { matchCompetitors } from './competitor-match';
import { ebayListingDefaults, withEbayListingDefaults, type EbayListingDefaults } from './ebay-listing-defaults';
import {
  descriptionStore, groupSpecs, normaliseExtras, resolveGlance, withDescriptionStore,
  type DescriptionExtras, type EbayDescriptionStore,
} from './description-extras';
import { PricingService } from '../../pricing/pricing.service';
import { toEbayOutcome, type EbayPriceOutcome, type EbayPriceSuggestion } from './ebay-pricing';
import { fitFeeModel, type FeeModel, type SettledOrder } from './ebay-fee-model';
import { ActivityService } from '../../activity/activity.service';
import { diffRecords } from '../../activity/diff';
import { PRODUCT_FIELD_LABELS } from '../../activity/product-fields';

/**
 * Creating an eBay listing through the Inventory API.
 *
 * Unlike Amazon, where we attach an offer to a catalogue entry someone else already wrote, eBay
 * makes us supply the whole listing: title, description, images, category and aspects. That is why
 * the product card grew the Content tab.
 *
 * The immediate reason this exists is a question nobody can answer from documentation: does eBaymag
 * pick up a listing created through the Inventory API, or only ones made in Seller Central? The
 * account currently has ZERO inventory items â€” every one of its 5,150 listings came from the
 * Trading API or by hand â€” so the only way to find out is to publish one and look.
 *
 * Publishing is staged deliberately. Steps one and two create private records that can be deleted
 * without trace; only `publish` produces something a buyer can see and purchase.
 */
@Injectable()
export class EbayListingService {
  private readonly logger = new Logger(EbayListingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly manufacturer: ManufacturerSourceService,
    private readonly web: WebResearchService,
    private readonly prices: PricingService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Whether a real listing may be created.
   *
   * Same shape as the Amazon gate: the environment overrules the setting, so a server can be made
   * incapable of listing regardless of who is clicking.
   */
  async liveWritesEnabled(): Promise<boolean> {
    if (process.env.LISTING_LIVE_WRITES === 'false') return false;
    const settings = await this.prisma.platformSettings.findFirst({ select: { listingLiveWrites: true } });
    return settings?.listingLiveWrites ?? false;
  }

  /**
   * The eBay connection this request may use.
   *
   * `companyIds` is not optional decoration. Both companies sell on eBay, and an integration id is
   * enough to reach a seller account â€” so a request that names one it may not see must fail here
   * rather than quietly act through the other company's token. Omitted only by callers with no user
   * behind them, which is background work and correctly unscoped.
   */
  /**
   * The row a plan is filed under.
   *
   * `listing.service.upsertPlan` keys on the INTEGRATION's own marketplace â€” `"GB"` for eBay â€” and
   * this used to hard-code `''`. Same product, same integration, two rows: a category chosen on the
   * Content tab was written somewhere the Channels tab never looked, so it read as unsaved.
   *
   * Derived here rather than passed in, because the two places that write a plan have to agree and
   * the only way to guarantee that is for them to compute it the same way.
   */
  private planKey(integration: { id: string; marketplace: string | null }) {
    return { integrationId: integration.id, marketplace: integration.marketplace ?? '' };
  }

  private async ebayIntegration(integrationId?: string, companyIds?: string[]) {
    const scope = companyIds ? { targetCompanyId: { in: companyIds } } : {};
    const row = integrationId
      ? await this.prisma.channelIntegration.findFirst({ where: { id: integrationId, deletedAt: null, channelType: 'ebay', ...scope } })
      : await this.prisma.channelIntegration.findFirst({ where: { deletedAt: null, channelType: 'ebay', status: 'active', ...scope } });
    if (!row) throw new NotFoundException('No eBay integration');
    return row;
  }

  /** What eBay needs before anything can be published, and what is missing. Read-only. */
  async prerequisites(integrationId?: string) {
    const row = await this.ebayIntegration(integrationId);
    const pre = await this.integrations.ebayPublishPrerequisites(row.id);
    return {
      integrationId: row.id,
      liveWritesEnabled: await this.liveWritesEnabled(),
      ...pre,
      /** What every listing uses unless a product says otherwise. */
      defaults: ebayListingDefaults(row.config),
      /** The store's own words for the description: name, condition wording, shipping lines. */
      descriptionStore: descriptionStore(row.config),
      /**
       * Which sales channel this eBay account is, so its settings can live on that channel's own
       * card rather than in a section of their own that belongs to nothing.
       */
      salesChannelId: row.targetSalesChannelId ?? null,
      // Stated rather than left for the caller to work out from four empty arrays.
      blockers: [
        ...(pre.locations.length === 0 ? ['No merchant location â€” every offer needs one'] : []),
        ...(pre.fulfillmentPolicies.length === 0 ? ['No postage policy'] : []),
        ...(pre.paymentPolicies.length === 0 ? ['No payment policy'] : []),
        ...(pre.returnPolicies.length === 0 ? ['No returns policy'] : []),
        ...pre.errors,
      ],
    };
  }

  /**
   * Choose the location and policies every listing on this channel uses.
   *
   * Account-wide on purpose: they are the same for almost every listing, and the product form only
   * has to differ where a product genuinely does. Stores which of eBay's records were picked, not
   * copies of them â€” eBay remains the owner of what a policy actually says.
   */
  async saveListingDefaults(
    args: {
      integrationId?: string; companyIds?: string[];
      merchantLocationKey?: string | null; fulfillmentPolicyId?: string | null; paymentPolicyId?: string | null; returnPolicyId?: string | null;
    },
  ): Promise<{ ok: true; defaults: EbayListingDefaults }> {
    const row = await this.ebayIntegration(args.integrationId, args.companyIds);
    const config = withEbayListingDefaults(row.config, {
      ...(args.merchantLocationKey !== undefined ? { merchantLocationKey: args.merchantLocationKey } : {}),
      ...(args.fulfillmentPolicyId !== undefined ? { fulfillmentPolicyId: args.fulfillmentPolicyId } : {}),
      ...(args.paymentPolicyId !== undefined ? { paymentPolicyId: args.paymentPolicyId } : {}),
      ...(args.returnPolicyId !== undefined ? { returnPolicyId: args.returnPolicyId } : {}),
    });
    const saved = await this.prisma.channelIntegration.update({
      where: { id: row.id },
      data: { config: config as never },
      select: { config: true },
    });
    this.logger.log(`eBay listing defaults saved for integration ${row.id}`);
    return { ok: true as const, defaults: ebayListingDefaults(saved.config) };
  }

  /**
   * The store's words in every eBay description: its name, its condition wording and its shipping
   * and returns lines. Account-wide, like the policies beside it on the channel card.
   */
  async saveDescriptionStore(
    args: { integrationId?: string; companyIds?: string[] } & Partial<EbayDescriptionStore>,
  ): Promise<{ ok: true; descriptionStore: EbayDescriptionStore }> {
    const row = await this.ebayIntegration(args.integrationId, args.companyIds);
    /**
     * These words appear on EVERY listing, so one eBay refuses â€” a "top rated" claim, a link, a phone
     * number â€” would get every publish refused. Held to the same rules as a product's own text.
     */
    const pieces: [string, string | null | undefined][] = [
      ['store name', args.storeName], ['condition in the header', args.conditionLabel], ['condition card', args.conditionNote],
      ...(args.shipping ?? []).flatMap((r, i): [string, string][] => [[`shipping line ${i + 1}`, `${r.label} ${r.value}`]]),
    ];
    const problems = pieces.flatMap(([where, text]) => (text?.trim() ? checkBuyerText({ intro: text }, []).map((p) => `${where} ${p.problem}`) : []));
    if (problems.length) throw new BadRequestException(`That text cannot go on a listing â€” ${problems.join('; ')}`);
    const next: Partial<EbayDescriptionStore> = {};
    if (args.storeName !== undefined) next.storeName = args.storeName;
    if (args.conditionLabel !== undefined) next.conditionLabel = args.conditionLabel;
    if (args.conditionNote !== undefined) next.conditionNote = args.conditionNote;
    if (args.shipping !== undefined) next.shipping = args.shipping;
    const saved = await this.prisma.channelIntegration.update({
      where: { id: row.id },
      data: { config: withDescriptionStore(row.config, next) as never },
      select: { config: true },
    });
    return { ok: true as const, descriptionStore: descriptionStore(saved.config) };
  }

  /**
   * Create the merchant location the account is missing.
   *
   * A write, but it creates an address record rather than a listing â€” nothing public, nothing
   * buyable. That makes it the safest way to confirm the token really carries the write scope: if
   * it does not, this fails while there is still nothing to undo.
   */
  async createLocation(
    args: { integrationId?: string; key: string; addressLine1: string; city: string; postalCode: string; country: string; addressLine2?: string; stateOrProvince?: string },
  ) {
    const row = await this.ebayIntegration(args.integrationId);
    const res = await this.integrations.ebayCreateLocation(row.id, args.key, {
      addressLine1: args.addressLine1,
      addressLine2: args.addressLine2,
      city: args.city,
      postalCode: args.postalCode,
      country: args.country,
      stateOrProvince: args.stateOrProvince,
    });
    if (!res.ok) throw new BadRequestException(`eBay refused the location: ${res.message}`);
    this.logger.log(`eBay merchant location ${res.key} ${res.created ? 'created' : 'already existed'}`);
    return res;
  }

  /**
   * Where eBay would file this product, asked of eBay.
   *
   * Its tree is its own and the LEAF decides which aspects are compulsory, so a category cannot be
   * derived from our taxonomy â€” only requested. Searched on the eBay title where there is one,
   * because that is the text written for this channel, falling back to the catalogue title.
   *
   * Read-only. Nothing is stored until somebody chooses.
   */
  async categorySuggestions(productId: string, integrationId?: string, query?: string, companyIds?: string[]) {
    const row = await this.ebayIntegration(integrationId, companyIds);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { ebayTitle: true, title: true, brand: { select: { name: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');
    const q = (query ?? product.ebayTitle ?? product.title ?? '').trim();
    const res = await this.integrations.ebayCategorySuggestions(row.id, q);
    return { integrationId: row.id, searchedFor: q, ...res };
  }

  /**
   * The aspects a category demands, married to what the product already answers.
   *
   * The saved plan wins over everything; Brand and MPN come off the product because they always
   * mean the same thing wherever they appear. What comes back is a form: which aspects exist, which
   * are compulsory, what is already answered and by what, and which answers eBay would refuse.
   */
  async categoryAspects(productId: string, categoryId: string, integrationId?: string, companyIds?: string[]) {
    const row = await this.ebayIntegration(integrationId, companyIds);
    const [product, plan, res] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { manufacturerSku: true, brand: { select: { name: true } } },
      }),
      this.prisma.productChannelPlan.findFirst({
        where: { productId, ...this.planKey(row) },
        select: { aspects: true, categoryRef: true },
      }),
      this.integrations.ebayCategoryAspects(row.id, categoryId),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!res.ok) throw new BadRequestException(`eBay would not describe that category: ${res.message}`);

    /**
     * Only what may actually be used is handed to the resolution. A suggestion one marketplace made
     * and nothing corroborates is absent from `planned` entirely, so it falls through to the
     * product's own brand or MPN and is still reported as missing â€” held back at every layer rather
     * than only at the payload.
     */
    const records = normaliseAspects(plan?.aspects);
    const resolved = resolveAspects(res.aspects, eligibleValues(records), {
      brand: product.brand?.name ?? null,
      mpn: product.manufacturerSku ?? null,
    });
    return {
      integrationId: row.id,
      categoryId,
      /** True when this is the category already saved, so the form can say so. */
      isSaved: plan?.categoryRef === categoryId,
      aspects: resolved.map((a, i) => ({
        ...a,
        mode: res.aspects[i]?.mode ?? null,
        values: res.aspects[i]?.values ?? [],
        valueCount: res.aspects[i]?.valueCount ?? 0,
        /**
         * The evidence, so the form can show where an answer came from instead of presenting every
         * value as equally trustworthy. Absent for an aspect nothing has ever been stored against.
         */
        provenance: records[a.name] ? describeProvenance(records[a.name]) : null,
      })),
      missing: missingAspects(resolved),
    };
  }

  /**
   * Save the category and aspects for this product.
   *
   * Kept on `ProductChannelPlan`, the same table Amazon's launch plans use, so the answer survives
   * the page and a publish months later sends what was decided rather than what a form last held.
   *
   * eBaymag republishes an eBay UK listing to every other eBay marketplace, so ONE plan per product
   * is the whole requirement here â€” there is no per-marketplace fan-out for us to store.
   */
  async savePlan(
    productId: string,
    args: {
      integrationId?: string; categoryId?: string; categoryName?: string | null; aspects?: Record<string, string>;
      condition?: string; handlingTimeDays?: number | null; offerPriceCents?: number | null; companyIds?: string[];
      merchantLocationKey?: string | null; fulfillmentPolicyId?: string | null; paymentPolicyId?: string | null; returnPolicyId?: string | null;
      /** The description's per-product parts, as edited in section 3. Replaces what is stored. */
      descriptionExtras?: unknown;
    },
  ) {
    const row = await this.ebayIntegration(args.integrationId, args.companyIds);
    const key = this.planKey(row);
    const existing = await this.prisma.productChannelPlan.findFirst({
      where: { productId, ...key },
      select: { id: true, aspects: true },
    });
    /**
     * Merged rather than replaced. The form only ever sends the fields it drew, so a wholesale
     * overwrite would delete anything gathered for an aspect the category no longer lists â€” and
     * with it the evidence that made the value trustworthy.
     */
    const merged = applyUserEdits(normaliseAspects(existing?.aspects), args.aspects ?? {}, new Date().toISOString());
    const data = {
      /**
       * Only written when a category is actually supplied. The price and dispatch form saves through
       * here too and has no category to send â€” writing `args.categoryId` unconditionally would erase
       * the chosen category every time somebody saved a price, and the item specifics with it.
       */
      ...(args.categoryId?.trim()
        ? { categoryRef: args.categoryId.trim(), categoryName: args.categoryName ?? null }
        : {}),
      aspects: toJson(merged),
      ...(args.condition ? { condition: args.condition } : {}),
      ...(args.handlingTimeDays !== undefined ? { handlingTimeDays: args.handlingTimeDays } : {}),
      ...(args.offerPriceCents !== undefined ? { offerPriceCents: args.offerPriceCents } : {}),
      /**
       * Written only when sent, and null is a real answer meaning "go back to the channel's
       * default" â€” which is why these use `!== undefined` rather than truthiness.
       */
      ...(args.merchantLocationKey !== undefined ? { merchantLocationKey: args.merchantLocationKey } : {}),
      ...(args.fulfillmentPolicyId !== undefined ? { fulfillmentPolicyId: args.fulfillmentPolicyId } : {}),
      ...(args.paymentPolicyId !== undefined ? { paymentPolicyId: args.paymentPolicyId } : {}),
      ...(args.returnPolicyId !== undefined ? { returnPolicyId: args.returnPolicyId } : {}),
      ...(args.descriptionExtras !== undefined ? { descriptionExtras: normaliseExtras(args.descriptionExtras) as never } : {}),
    };
    const saved = existing
      ? await this.prisma.productChannelPlan.update({ where: { id: existing.id }, data })
      : await this.prisma.productChannelPlan.create({ data: { productId, ...key, ...data } });
    this.logger.log(`eBay plan saved for ${productId}: category ${args.categoryId}`);
    return { ok: true as const, planId: saved.id, categoryId: saved.categoryRef };
  }

  /**
   * Go and find the item specifics this category demands.
   *
   * On demand, one product at a time, and never on a schedule â€” the category has to be right before
   * this is worth running, and only a person can say that it is.
   *
   * What it does NOT do is as important as what it does. It refuses without an identifier precise
   * enough to search on. It writes nothing for an aspect no source mentioned. It never overwrites a
   * value somebody entered. And it holds back anything a single marketplace claims on its own,
   * because the standard here is the manufacturer, or two sources agreeing.
   *
   * Right now exactly one source can actually be reached, so most of what it finds arrives as a
   * suggestion rather than an answer. That is reported rather than hidden: a gather that quietly
   * consulted one source and presented the result as researched would be worse than no gather.
   */
  async gatherAspects(
    productId: string,
    args: { integrationId?: string; companyIds?: string[]; userId?: string; manufacturerUrls?: string[] },
  ) {
    const ctx = await this.gatherContext(productId, args.integrationId, args.companyIds);
    const { searchOn, plan, cat, aspectNames } = await this.requireGatherable(ctx);
    const { product } = ctx;
    const verdict = { searchOn };

    /** `warned` is used-but-doubtful: a page you nominated that argues about which product it is. */
    const sources: Array<{ kind: string; status: 'ok' | 'nothing' | 'failed' | 'unavailable' | 'not-built' | 'rejected' | 'warned'; message: string }> = [];
    const findings: SourceFinding[] = [];

    /**
     * Pages a person nominated â€” read first, and trusted.
     *
     * A nominated page is accepted as correct because a person chose it, which is a deliberate
     * business rule: the human looked at the page and decided it describes this product, and that
     * judgement beats anything this code could infer. So identity here WARNS rather than refuses.
     * Refusing would mean overruling the person who chose the page, and they know something we do
     * not â€” but the Panasonic that came back branded Marley is also real, so a page that disagrees
     * about the brand or the part number says so loudly beside its own findings.
     *
     * Several pages, because the answer is often split across them, and because two pages agreeing
     * is worth more than one asserting.
     */
    const nominated = dedupeUrls([...(args.manufacturerUrls ?? []), ...product.manufacturerUrls]);
    if (nominated.length === 0) {
      sources.push({
        kind: 'manufacturer',
        status: 'unavailable',
        message: 'No page nominated for this product, so nothing authoritative was read. Add one below and it will be used from now on.',
      });
    }

    const usablePages: string[] = [];
    for (const pageUrl of nominated) {
      const page = await this.manufacturer.read(pageUrl);
      const host = safeHost(pageUrl);

      if (!page.ok) {
        sources.push({ kind: `manufacturer:${host}`, status: 'failed', message: `${host} could not be used: ${page.message}.` });
        continue;
      }

      const who = verifyIdentity({ brand: product.brand?.name ?? null, mpn: product.manufacturerSku }, page.identity);
      /** Used either way; the doubt is reported rather than acted on. */
      sources.push({
        kind: `manufacturer:${host}`,
        status: who.ok ? 'ok' : 'warned',
        message: who.ok
          ? `${page.pairs.length} fields from ${host}, confirmed by ${who.matchedOn.join(' and ')}.`
          : `${page.pairs.length} fields from ${host}, used because you nominated it â€” but check it: ${who.reason}.`,
      });

      for (const pair of page.pairs) {
        findings.push({ ...pair, kind: 'manufacturer', url: page.finalUrl ?? pageUrl, label: host });
      }
      usablePages.push(pageUrl);
    }

    /** Remembered only once fetched and read, so a typo is not stored as a source. */
    const toStore = dedupeUrls([...product.manufacturerUrls, ...usablePages]);
    if (toStore.length !== product.manufacturerUrls.length) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { manufacturerUrls: toStore, ...(args.userId ? { updatedById: args.userId } : {}) },
      });
    }

    const amazon = await this.prisma.channelIntegration.findFirst({
      where: {
        deletedAt: null, channelType: 'amazon', status: 'active',
        ...(args.companyIds ? { targetCompanyId: { in: args.companyIds } } : {}),
      },
      select: { id: true },
    });
    if (!amazon) {
      sources.push({ kind: 'amazon', status: 'unavailable', message: 'No active Amazon integration to ask.' });
    } else {
      const res = await this.integrations.amazonCatalogAttributes(amazon.id, verdict.searchOn.gtin, verdict.searchOn.gtinKind);
      /**
       * Identity before attributes, always. A barcode lookup returning exactly one product is not
       * evidence that it is OUR product â€” it returned one Marley earphone for a Panasonic, and every
       * attribute on it was faithfully recorded for the wrong thing. A mismatch is not a bad field
       * among good ones; it is a different product, so the whole source is dropped.
       */
      const who = res.ok
        ? verifyIdentity(
          { brand: product.brand?.name ?? null, mpn: product.manufacturerSku },
          res.identity,
        )
        : null;

      if (!res.ok) {
        sources.push({ kind: 'amazon', status: 'failed', message: res.message ?? 'Amazon would not answer.' });
      } else if (who && !who.ok) {
        sources.push({ kind: 'amazon', status: 'rejected', message: `Amazon was not used: ${who.reason}.` });
      } else if (res.found.length === 0) {
        sources.push({ kind: 'amazon', status: 'nothing', message: `Amazon holds nothing under this ${verdict.searchOn.gtinKind}.` });
      } else {
        const how = who && who.ok ? who.matchedOn.join(' and ') : 'identity';
        sources.push({ kind: 'amazon', status: 'ok', message: `${res.found.length} fields from Amazon${res.asin ? ` (ASIN ${res.asin})` : ''}, confirmed by ${how}.` });
        for (const f of res.found) {
          findings.push({
            ...f,
            kind: 'amazon',
            ...(res.detailUrl ? { url: res.detailUrl } : {}),
            ...(res.asin ? { label: `Amazon ASIN ${res.asin}` } : {}),
          });
        }
      }
    }

    /**
     * The open web, searched by Claude.
     *
     * Last, after the pages a person nominated and after Amazon, because it is the least certain of
     * the three â€” and because the two above give it something to agree with. Its findings are
     * evidence like any other: a page on the maker's own domain is authoritative, two independent
     * sites agreeing is enough, and a lone retailer is held back for somebody to confirm.
     */
    if (!this.web.available) {
      sources.push({
        kind: 'web',
        status: 'unavailable',
        message: 'Web search is switched off on this server (no Claude API key configured).',
      });
    } else {
      const found = await this.web.research(
        {
          brand: product.brand?.name ?? null,
          brandWebsite: product.brand?.website ?? null,
          mpn: verdict.searchOn.mpn,
          gtin: verdict.searchOn.gtin,
          gtinKind: verdict.searchOn.gtinKind,
          title: product.title,
        },
        aspectNames,
      );

      if (!found.ok) {
        sources.push({ kind: 'web', status: 'failed', message: `Web search could not be used: ${found.message}.` });
      } else if (found.findings.length === 0) {
        sources.push({ kind: 'web', status: 'nothing', message: `Web search found nothing stated for these fields (${found.costHint}).` });
      } else {
        const hosts = [...new Set(found.findings.map((f) => f.label))];
        sources.push({
          kind: 'web',
          status: 'ok',
          message: `${found.findings.length} values from ${hosts.length} ${hosts.length === 1 ? 'page' : 'pages'} â€” ${hosts.join(', ')} (${found.costHint}).`,
        });
        findings.push(...found.findings);
      }
    }

    const saved = await this.foldAndSave(plan, cat, aspectNames, findings, args.userId);
    this.logger.log(
      `eBay gather for ${productId}: ${findings.length} findings, ${saved.touched.length} aspects touched, ${saved.filled} usable`,
    );

    return {
      ok: true as const,
      sources,
      ...saved,
      /** What the form should show in the manufacturer page box next time it is opened. */
      manufacturerUrls: toStore,
    };
  }

  /**
   * Everything a gather needs to know about one product, loaded once.
   *
   * Deliberately does NOT refuse. The gather button and the connector's write both go on to
   * `requireGatherable`, which does; the connector's read-only brief does not, because telling a
   * researcher WHY a product cannot be gathered is the useful answer there, not an error.
   */
  private async gatherContext(productId: string, integrationId?: string, companyIds?: string[]) {
    const row = await this.ebayIntegration(integrationId, companyIds);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true, mainSku: true, title: true, manufacturerSku: true, ean: true, upc: true, manufacturerUrls: true,
        brand: { select: { name: true, website: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const verdict = canGather({
      manufacturerSku: product.manufacturerSku,
      ean: product.ean,
      upc: product.upc,
      brand: product.brand?.name ?? null,
      title: product.title,
    });
    const plan = await this.prisma.productChannelPlan.findFirst({
      where: { productId, ...this.planKey(row) },
      select: { id: true, aspects: true, categoryRef: true, categoryName: true },
    });
    return { row, product, verdict, plan };
  }

  /**
   * The two refusals every WRITE honours, whoever is writing â€” the gather button or Claude through
   * the connector. One copy, so neither path can drift into accepting what the other refuses.
   */
  private async requireGatherable(ctx: Awaited<ReturnType<EbayListingService['gatherContext']>>) {
    // The identifier rule, before anything is fetched or any time is spent.
    if (!ctx.verdict.ok) throw new BadRequestException(ctx.verdict.reason);
    /**
     * eBay decides which item specifics exist FROM the category, so without one there is no list to
     * fill and nothing to match a finding against. This is why the tab numbers the category first.
     */
    const plan = ctx.plan;
    if (!plan?.categoryRef) {
      throw new BadRequestException('Choose an eBay category first â€” it decides which item specifics exist.');
    }
    const cat = await this.integrations.ebayCategoryAspects(ctx.row.id, plan.categoryRef);
    if (!cat.ok) throw new BadRequestException(`Could not ask eBay what this category needs: ${cat.message}`);
    return { searchOn: ctx.verdict.searchOn, plan, cat, aspectNames: cat.aspects.map((a) => a.name) };
  }

  /**
   * Fold findings into the stored answers and save â€” the single place evidence becomes data.
   *
   * Shared by the gather button and the connector for the same reason as `requireGatherable`: the
   * provenance rules must be applied identically no matter who found the evidence.
   */
  private async foldAndSave(
    plan: { id: string; aspects: unknown },
    cat: { aspects: Array<{ name: string; required: boolean }> },
    aspectNames: string[],
    findings: SourceFinding[],
    userId?: string,
  ) {
    const existing = normaliseAspects(plan.aspects);
    const { records, ignored, touched } = foldFindings(existing, findings, aspectNames, new Date().toISOString());

    /** Nothing changed means nothing is written â€” an empty gather should not touch the row. */
    if (touched.some((t) => t.changed)) {
      await this.prisma.productChannelPlan.update({
        where: { id: plan.id },
        data: { aspects: toJson(records), ...(userId ? { updatedById: userId } : {}) },
      });
    }

    const usable = touched.filter((t) => isPayloadEligible(records[t.name]));
    return {
      /**
       * Required aspects with no answer of any kind â€” excluding Brand, MPN and Model, which are
       * filled from the product when the listing is built and so are never actually missing.
       * Listing them sent a researcher hunting for a value it is not allowed to write.
       */
      stillEmpty: aspectNames.filter((n) => cat.aspects.find((a) => a.name === n)?.required
        && !records[n]
        && !/^(brand|mpn|model)$/i.test(n)),
      filled: usable.length,
      heldBack: touched.length - usable.length,
      touched: touched.map((t) => ({ ...t, provenance: describeProvenance(records[t.name]) })),
      ignored,
    };
  }

  /**
   * Find a product by the SKU a person would type â€” its main SKU, or any alias it carries.
   *
   * Exact, case-insensitively, and nothing looser. A researcher asking about `RP-HJE201E-K` must get
   * that product or be told there is none; a nearest match would hand it a neighbouring model to
   * research, which is the exact mistake the identifier rules exist to prevent.
   */
  async productIdBySku(sku: string): Promise<string | null> {
    const wanted = sku.trim();
    if (!wanted) return null;
    const main = await this.prisma.product.findFirst({
      where: { deletedAt: null, mainSku: { equals: wanted, mode: 'insensitive' } },
      select: { id: true },
    });
    if (main) return main.id;
    const alias = await this.prisma.productSkuAlias.findFirst({
      where: { skuValue: { equals: wanted, mode: 'insensitive' }, product: { deletedAt: null } },
      select: { productId: true },
    });
    return alias?.productId ?? null;
  }

  /**
   * Products a researcher could work on, and whether each is ready.
   *
   * Read-only. "Ready" means the gather would accept a submission: identifiable exactly, and an eBay
   * category chosen. Whatever is not ready says why, so the researcher can tell the person what to
   * fix instead of trying and being refused one product at a time.
   */
  async researchCandidates(args: { companyIds: string[]; skus?: string[]; search?: string; onlyReady?: boolean; limit: number }) {
    const row = await this.ebayIntegration(undefined, args.companyIds);
    const skus = (args.skus ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 50);
    const search = args.search?.trim();

    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(skus.length
          ? { OR: skus.map((x) => ({ mainSku: { equals: x, mode: 'insensitive' as const } })) }
          : search
            ? {
              OR: [
                { mainSku: { contains: search, mode: 'insensitive' as const } },
                { title: { contains: search, mode: 'insensitive' as const } },
                { manufacturerSku: { contains: search, mode: 'insensitive' as const } },
              ],
            }
            : {}),
      },
      select: {
        id: true, mainSku: true, title: true, manufacturerSku: true, ean: true, upc: true,
        brand: { select: { name: true } },
        channelPlans: {
          where: { ...this.planKey(row), deletedAt: null },
          select: { categoryRef: true, categoryName: true },
          take: 1,
        },
      },
      orderBy: { mainSku: 'asc' },
      // Over-fetch when filtering to ready ones, so a page of unready products does not come back empty.
      take: Math.min(args.onlyReady ? args.limit * 4 : args.limit, 400),
    });

    const rows = products.map((p) => {
      const verdict = canGather({ manufacturerSku: p.manufacturerSku, ean: p.ean, upc: p.upc });
      const plan = p.channelPlans[0];
      const notReady = !verdict.ok
        ? verdict.reason
        : !plan?.categoryRef
          ? 'No eBay category chosen yet â€” a person picks it on the eBay content tab.'
          : null;
      return {
        sku: p.mainSku,
        title: p.title,
        brand: p.brand?.name ?? null,
        manufacturerSku: p.manufacturerSku,
        barcode: p.ean || p.upc || null,
        ebayCategory: plan?.categoryRef ? plan.categoryName ?? plan.categoryRef : null,
        ready: notReady === null,
        notReady,
      };
    });
    const out = args.onlyReady ? rows.filter((r) => r.ready) : rows;
    return {
      products: out.slice(0, args.limit),
      requestedSkusNotFound: skus.filter((x) => !products.some((p) => p.mainSku.toLowerCase() === x.toLowerCase())),
    };
  }

  /**
   * What a researcher needs to know before searching for one product. Read-only.
   *
   * Hands over the category's field names exactly as eBay spells them, the values eBay will accept
   * where it restricts them, and what is already answered â€” so the research comes back under names
   * that match, and nobody spends searches on a field a person already settled.
   */
  async researchBrief(productId: string, companyIds: string[]) {
    const ctx = await this.gatherContext(productId, undefined, companyIds);
    const categoryRef = ctx.plan?.categoryRef ?? null;
    const cat = categoryRef ? await this.integrations.ebayCategoryAspects(ctx.row.id, categoryRef) : null;
    const records = normaliseAspects(ctx.plan?.aspects);

    const refusal = !ctx.verdict.ok
      ? ctx.verdict.reason
      : !categoryRef
        ? 'No eBay category has been chosen for this product. A person picks it on the eBay content tab; it decides which fields exist.'
        : cat && !cat.ok
          ? `eBay would not describe this category right now: ${cat.message}`
          : null;

    return {
      sku: ctx.product.mainSku,
      title: ctx.product.title,
      brand: ctx.product.brand?.name ?? null,
      manufacturerSku: ctx.product.manufacturerSku,
      ean: ctx.product.ean,
      upc: ctx.product.upc,
      ready: refusal === null,
      refusal,
      ebayCategory: categoryRef ? { id: categoryRef, name: ctx.plan?.categoryName ?? null } : null,
      pagesNominatedByAPerson: ctx.product.manufacturerUrls,
      fields: cat?.ok
        ? cat.aspects.map((a) => {
          const rec = records[a.name];
          return {
            name: a.name,
            required: a.required,
            /** Brand, MPN and Model come from the product itself; research for them is discarded. */
            answeredByProduct: /^(brand|mpn|model)$/i.test(a.name),
            acceptedValues: a.mode === 'SELECTION_ONLY' ? (a.values ?? []).slice(0, 80) : null,
            acceptedValuesTotal: a.mode === 'SELECTION_ONLY' ? a.valueCount ?? 0 : null,
            /**
             * The words eBay's buyer filters use, for a field that accepts any text. Not a restriction â€”
             * eBay takes anything here â€” but a value outside this list matches no filter, so a listing
             * reading `Department: Wristwatches` is accepted and then never appears in a "Unisex Adults"
             * search. Handed to the researcher so it can report in eBay's vocabulary where a page states
             * the same thing in other words.
             */
            recommendedValues: a.mode !== 'SELECTION_ONLY' && (a.values ?? []).length ? (a.values ?? []).slice(0, 80) : null,
            current: rec
              ? { value: rec.value, basis: describeProvenance(rec).basis, heldBackForAPerson: !isPayloadEligible(rec) }
              : null,
          };
        })
        : [],
    };
  }

  /**
   * What eBay really charges this account, measured from orders it has already settled.
   *
   * Published rates are a starting point and rarely the truth â€” they vary by category, subscription
   * and whatever has been negotiated â€” and a wrong rate is wrong on every listing in the same
   * direction. The fee has the shape `percentage Ã— order + fixed per order`, so a line fitted
   * through real orders recovers both.
   *
   * Aggregated to the ORDER, not the line: eBay's fixed fee is charged once per order, and fitting
   * per line would find a fixed fee on every line and overstate it several times over.
   *
   * Returns `null` when the orders cannot support a measurement, and the caller falls back to the
   * published rates rather than pricing off a number derived from a handful of sales.
   */
  private async measuredFeeModel(integration: { targetSalesChannelId: string | null }): Promise<FeeModel | null> {
    if (!integration.targetSalesChannelId) return null;

    /** A year: long enough to gather orders, recent enough that a rate change shows through. */
    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.salesTransaction.findMany({
      where: {
        salesChannelId: integration.targetSalesChannelId,
        deletedAt: null,
        status: 'submitted',
        date: { gte: since },
        // A refunded fee is not what the sale cost us, and would drag the line down.
        feeRefunded: false,
      },
      select: {
        currency: true,
        feeCurrency: true,
        items: {
          select: {
            netSalesAmount: true, vatAmount: true, shippingAmount: true, shippingAmountVat: true,
            salesChannelSalesFeeAmount: true,
          },
        },
      },
      take: 2000,
    });

    const orders: SettledOrder[] = rows
      /**
       * The fee and the order total must be in the SAME currency, or their ratio is an exchange rate
       * with a fee rate hidden inside it. eBay bills most accounts in the marketplace's currency, so
       * this drops the exceptions rather than converting them.
       */
      .filter((tx) => !tx.feeCurrency || !tx.currency || tx.feeCurrency === tx.currency)
      .map((tx) => {
      const sum = (pick: (i: (typeof tx.items)[number]) => number | null) =>
        tx.items.reduce((total, item) => total + (pick(item) ?? 0), 0);
      // What the buyer paid in total â€” eBay charges its fee on the goods, the postage and the tax.
      const gross = sum((i) => i.netSalesAmount) + sum((i) => i.vatAmount)
        + sum((i) => i.shippingAmount) + sum((i) => i.shippingAmountVat);
      return { grossCents: Math.round(gross * 100), feeCents: Math.round(sum((i) => i.salesChannelSalesFeeAmount) * 100) };
    });

    return fitFeeModel(orders);
  }

  /**
   * What this product should sell for on eBay UK, and what it earns.
   *
   * Three things a person needs on one screen before publishing: what others charge for the same
   * model, what our own costs and eBay's fees imply, and what any price they type would actually
   * earn. The arithmetic lives in `ebay-pricing` and the matching in `competitor-match`; this fetches
   * the facts and puts them together.
   *
   * The competitor half is deliberately cautious. eBay's catalogue does not carry our barcodes, so
   * the search is by words and returns neighbouring models as readily as this one â€” everything that
   * does not carry the part number is set aside, with the reason, rather than quietly averaged in.
   */
  async pricing(
    productId: string,
    args: { companyIds: string[]; atPriceCents?: number; targetMarginPct?: number },
  ) {
    const row = await this.ebayIntegration(undefined, args.companyIds);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true, mainSku: true, title: true, ebayTitle: true, manufacturerSku: true,
        brand: { select: { name: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const plan = await this.prisma.productChannelPlan.findFirst({
      where: { productId, ...this.planKey(row) },
      select: { offerPriceCents: true, handlingTimeDays: true },
    });

    /**
     * Priced exactly as every other listing screen prices: the platform's economics on the sales
     * channel this connection feeds — its fee, its VAT rules (the UK £135 line), the product's cost and
     * the shipping into its country. eBay had its own model here (published fee, VAT always taken, no
     * shipping, margin on net), and suggested £155 for IT33248 where OnBuy, set up identically,
     * suggested another figure entirely. One model, one answer.
     */
    const settings = await this.prisma.platformSettings.findFirst({ select: { launchMarginPct: true } });
    const targetMarginPct = args.targetMarginPct ?? (settings?.launchMarginPct != null ? Number(settings.launchMarginPct) : 20);
    const channelId = row.targetSalesChannelId;

    /**
     * eBay's fee measured from this account's settled orders, shown BESIDE the channel's fee rather
     * than used: the channel's fee is what every other screen and every booked sale uses, and a
     * measurement that disagrees with it is a reason to correct the channel, not to price differently.
     */
    const measured = await this.measuredFeeModel(row);

    let currency = 'GBP';
    let costCents: number | null = null;
    let suggestion: EbayPriceSuggestion;
    let at: EbayPriceOutcome | null = null;
    let current: EbayPriceOutcome | null = null;
    let basis: { channelName: string | null; feePct: number; vatPct: number; shippingServiceName: string | null } | null = null;

    if (!channelId) {
      suggestion = { ok: false, reason: 'This eBay connection is not linked to a sales channel, so there is no fee or VAT rule to price with. Link one in Setup → Integrations.' };
    } else {
      const r = await this.prices.priceForMargin(productId, channelId, targetMarginPct);
      currency = r.currency;
      const wanted = [r.priceNative != null ? Math.round(r.priceNative * 100) : null, args.atPriceCents ?? null, plan?.offerPriceCents ?? null];
      const econ = await this.prices.listingEconomics(
        [...new Set(wanted.filter((c): c is number => c != null && c > 0))]
          .map((cents) => ({ key: String(cents), productId, salesChannelId: channelId, grossNative: cents / 100, currency })),
      );
      const outcome = (cents: number | null): EbayPriceOutcome | null => (cents != null ? toEbayOutcome(cents, econ.get(String(cents))) : null);
      const suggested = outcome(wanted[0]);
      suggestion = suggested
        ? { ok: true, outcome: suggested, targetMarginPct }
        : { ok: false, reason: r.problems.length ? `Cannot suggest a price: ${r.problems.join('; ')}.` : 'No price reaches that margin once fees and tax are taken.' };
      at = outcome(wanted[1]);
      current = outcome(wanted[2]);
      const shown = suggested ?? at ?? current;
      costCents = shown?.costCents ?? null;
      const channel = await this.prisma.salesChannel.findFirst({ where: { id: channelId }, select: { name: true } });
      basis = { channelName: channel?.name ?? null, feePct: r.inputs.feePct, vatPct: r.inputs.vatPct, shippingServiceName: r.inputs.shippingServiceName };
      if (r.problems.length && suggested) suggestion = { ...suggestion, problems: r.problems } as EbayPriceSuggestion;
    }

    const assumptions = {
      basis,
      /** eBay's fee as fitted to this account's own settled orders, for comparison with the channel's. */
      measured: measured?.ok ? { feePct: measured.feePct, fixedFeeCents: measured.fixedFeeCents, sampleSize: measured.sampleSize } : null,
      measuredWhyNot: measured && !measured.ok ? measured.reason : null,
    };

    /** Words, because the probe showed eBay's catalogue does not carry these barcodes. */
    const query = [product.brand?.name, product.manufacturerSku].filter(Boolean).join(' ').trim();
    let competitors: {
      searchedFor: string; available: boolean; message?: string;
      matched: ReturnType<typeof matchCompetitors>['matched'];
      rejected: ReturnType<typeof matchCompetitors>['rejected'];
      summary: ReturnType<typeof matchCompetitors>['summary'];
    } = { searchedFor: query, available: true, matched: [], rejected: [], summary: null };

    if (!query) {
      competitors = { ...competitors, available: false, message: 'Without a brand and a part number there is nothing precise enough to search for.' };
    } else {
      const res = await this.integrations.ebayCompetingOffers(row.id, '', { query, limit: 30 });
      if (!res.ok) competitors = { ...competitors, available: res.available, message: res.message };
      else competitors = { ...competitors, ...matchCompetitors(res.offers, { mpn: product.manufacturerSku }) };
    }

    return {
      sku: product.mainSku,
      title: product.ebayTitle ?? product.title,
      manufacturerSku: product.manufacturerSku,
      /** The currency the LISTING sells in â€” every figure below is in it. */
      currency,
      /** The platform costs in EUR, so the cost below is converted into the listing's currency. */
      costCurrency: 'EUR',
      costCents,
      assumptions,
      targetMarginPct,
      suggestion,
      at,
      current,
      handlingTimeDays: plan?.handlingTimeDays ?? null,
      competitors,
    };
  }

  /**
   * The buyer-facing words: the eBay title, an introduction and the feature lines.
   *
   * Stored as PROSE, not markup. The eBay description is rendered from this at publish through one
   * house template, so a writer supplies what the product is and the platform supplies how it looks
   * â€” which is the only way every listing can share a design.
   *
   * Shared with the Content tab rather than kept for eBay alone: it is the same sentence about the
   * same product wherever it sells, and a second copy would drift from the first.
   *
   * Refuses to overwrite existing words unless asked. Content somebody wrote is theirs, and silently
   * replacing it is the one thing a research pass must never do.
   */
  async submitProductContent(
    productId: string,
    args: {
      companyIds: string[]; userId?: string; title?: string | null; intro?: string | null; features?: string[]; replaceExisting?: boolean;
      /** The description's other per-product parts. Stored on the eBay plan, not the product. */
      extras?: {
        series?: string | null; inTheBox?: string | null; care?: string | null;
        faq?: { q: string; a: string }[];
        glance?: { aspect: string; label: string; value: string }[];
        specGroups?: Record<string, string>;
      };
    },
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true, mainSku: true, ebayTitle: true, descriptionHtml: true, keyFeatures: true,
        aliases: { select: { skuValue: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    /** Whitespace collapsed: a title is one line, and eBay counts every stray space against the 80. */
    const title = args.title?.replace(/\s+/g, ' ').trim() ?? '';
    const intro = args.intro?.trim() ?? '';
    const features = (args.features ?? []).map((f) => f.trim()).filter(Boolean);
    const x = args.extras ?? {};
    const hasExtras = !!(x.series?.trim() || x.inTheBox?.trim() || x.care?.trim() || x.faq?.length || x.glance?.length
      || (x.specGroups && Object.keys(x.specGroups).length));
    if (!title && !intro && features.length === 0 && !hasExtras) {
      throw new BadRequestException('Nothing to write: send a title, a description, feature lines, or the other description parts.');
    }

    const forbidden = [product.mainSku, ...product.aliases.map((a) => a.skuValue)];
    const problems = checkBuyerText({ title, intro, features }, forbidden);
    /**
     * Every other part a buyer reads is held to the same rules â€” no internal SKU, contact details,
     * links or markup. Checked one piece at a time so the reply names the piece to rewrite.
     */
    const pieces: [string, string | null | undefined][] = [
      ['series', x.series], ['in the box', x.inTheBox], ['care', x.care],
      ...(x.faq ?? []).flatMap((f, i): [string, string][] => [[`question ${i + 1}`, f.q], [`answer ${i + 1}`, f.a]]),
      ...(x.glance ?? []).flatMap((g, i): [string, string][] => [[`at-a-glance ${i + 1} label`, g.label], [`at-a-glance ${i + 1} value`, g.value]]),
      ...Object.values(x.specGroups ?? {}).map((g, i): [string, string] => [`group name ${i + 1}`, g]),
    ];
    for (const [where, text] of pieces) {
      if (!text?.trim()) continue;
      for (const p of checkBuyerText({ intro: text }, forbidden)) problems.push({ where, problem: p.problem });
    }
    if (problems.length > 0) {
      throw new BadRequestException(
        `That text cannot go on a listing â€” ${problems.map((p) => `${p.where} ${p.problem}`).join('; ')}`,
      );
    }

    /**
     * Judged on the WORDS, not the markup: an editor that was opened and closed can leave `<p></p>`
     * behind, and treating that as an existing description would refuse to fill an empty one.
     */
    const hadTitle = !!product.ebayTitle?.trim();
    const hadIntro = !!htmlToPlainText(product.descriptionHtml);
    const hadFeatures = Array.isArray(product.keyFeatures) && (product.keyFeatures as unknown[]).length > 0;
    const skipped: string[] = [];

    /**
     * Into the full Description, never `shortDescription`. That field is the two-sentence blurb under
     * the price on the B2B store â€” "deliberately short and plain" â€” and this used to fill it with
     * several paragraphs of eBay copy.
     */
    const data: { ebayTitle?: string; descriptionHtml?: string; keyFeatures?: string[]; updatedById?: string } = {};
    if (title) {
      if (hadTitle && !args.replaceExisting) skipped.push('title (one is already written â€” ask for it to be replaced)');
      else data.ebayTitle = title;
    }
    if (intro) {
      if (hadIntro && !args.replaceExisting) skipped.push('description (one is already written â€” ask for it to be replaced)');
      else data.descriptionHtml = proseToHtml(intro);
    }
    if (features.length) {
      if (hadFeatures && !args.replaceExisting) skipped.push('features (they are already written â€” ask for them to be replaced)');
      else data.keyFeatures = features;
    }

    if (Object.keys(data).length > 0) {
      if (args.userId) data.updatedById = args.userId;
      await this.prisma.product.update({ where: { id: productId }, data });

      /**
       * Recorded in the product's History like any other change. It was not, and that made the
       * lost-description incident look like somebody had deliberately emptied the fields: the only
       * entry was the person's card save that overwrote it, and nothing showed the research had
       * written anything first.
       */
      await this.activity.record({
        entityType: 'product',
        entityId: productId,
        entityLabel: product.mainSku,
        action: 'update',
        source: 'system',
        actorId: args.userId,
        changes: diffRecords(
          { ebayTitle: product.ebayTitle, descriptionHtml: product.descriptionHtml, keyFeatures: product.keyFeatures },
          {
            ...(data.ebayTitle !== undefined ? { ebayTitle: data.ebayTitle } : {}),
            ...(data.descriptionHtml !== undefined ? { descriptionHtml: data.descriptionHtml } : {}),
            ...(data.keyFeatures !== undefined ? { keyFeatures: data.keyFeatures } : {}),
          },
          { labels: PRODUCT_FIELD_LABELS },
        ),
      });
      this.logger.log(`Content written for ${product.mainSku}: ${Object.keys(data).filter((k) => k !== 'updatedById').join(', ')}`);
    }

    const wroteExtras: string[] = [];
    const notShown: string[] = [];
    if (hasExtras) {
      const row = await this.ebayIntegration(undefined, args.companyIds);
      const plan = await this.prisma.productChannelPlan.findFirst({
        where: { productId, ...this.planKey(row) },
        select: { id: true, aspects: true, descriptionExtras: true },
      });
      if (!plan) {
        skipped.push('the other description parts (this product has no eBay category yet, so there is nowhere to keep them)');
      } else {
        const current = normaliseExtras(plan.descriptionExtras);
        const incoming = normaliseExtras({
          series: x.series, inTheBox: x.inTheBox, care: x.care, faq: x.faq, glance: x.glance, groups: x.specGroups,
        });
        const next: DescriptionExtras = { ...current, groups: { ...current.groups } };
        // Same courtesy as the words above: something already there stays unless replacing was asked for.
        const take = <K extends 'series' | 'inTheBox' | 'care' | 'faq' | 'glance'>(key: K, label: string) => {
          const value = incoming[key];
          const present = Array.isArray(value) ? value.length > 0 : !!value;
          if (!present) return;
          const had = Array.isArray(current[key]) ? (current[key] as unknown[]).length > 0 : !!current[key];
          if (had && !args.replaceExisting) { skipped.push(`${label} (already written â€” ask for it to be replaced)`); return; }
          (next as any)[key] = value;
          wroteExtras.push(label);
        };
        take('series', 'series');
        take('inTheBox', 'in the box');
        take('care', 'care');
        take('faq', 'questions');
        take('glance', 'at-a-glance');
        if (Object.keys(incoming.groups).length) {
          // Groups merge: a group a person set stays, unless replacing was asked for.
          next.groups = args.replaceExisting ? incoming.groups : { ...incoming.groups, ...current.groups };
          wroteExtras.push('spec groups');
        }
        if (wroteExtras.length) {
          await this.prisma.productChannelPlan.update({ where: { id: plan.id }, data: { descriptionExtras: next as never } });
          this.logger.log(`Description parts written for ${product.mainSku}: ${wroteExtras.join(', ')}`);
        }
        // Stored as sent, shown only while backed by a verified value â€” said now, so it can be fixed.
        const verified = eligibleValues(normaliseAspects(plan.aspects));
        const shown = new Set(resolveGlance(next.glance, verified).map((g) => `${g.label}|${g.value}`));
        for (const g of next.glance) {
          if (!shown.has(`${g.label}|${g.value}`)) {
            notShown.push(`"${g.label}: ${g.value}" is not shown â€” "${g.aspect}" has no verified value containing it`);
          }
        }
      }
    }

    return {
      ok: true as const,
      sku: product.mainSku,
      wrote: [...Object.keys(data).filter((k) => k !== 'updatedById'), ...wroteExtras],
      skipped,
      ...(notShown.length ? { notShown } : {}),
    };
  }

  /**
   * Evidence a researcher brought back â€” screened, then folded exactly as a gather's would be.
   *
   * Screening first: a finding reaches the provenance rules only if the page it came from was
   * declared, states which product it describes, and that product is this one. Then the same fold
   * and the same save as the gather button, so there is one set of rules, not two.
   *
   * What this cannot do is as deliberate as what it can: it cannot confirm a held-back value, cannot
   * overwrite anything a person entered, and cannot publish. Those stay with a person in maSquare.
   */
  async submitResearch(
    productId: string,
    args: { companyIds: string[]; userId?: string; sources: ResearchedSource[]; findings: ResearchedFinding[] },
  ) {
    const ctx = await this.gatherContext(productId, undefined, args.companyIds);
    const { plan, cat, aspectNames } = await this.requireGatherable(ctx);

    const screened = screenResearch(
      { brand: ctx.product.brand?.name ?? null, brandWebsite: ctx.product.brand?.website ?? null, mpn: ctx.product.manufacturerSku },
      args.sources,
      args.findings,
    );
    const saved = await this.foldAndSave(plan, cat, aspectNames, screened.accepted, args.userId);

    this.logger.log(
      `Research submitted for ${ctx.product.mainSku}: ${screened.accepted.length} findings accepted, `
      + `${screened.rejectedSources.length} pages rejected, ${saved.filled} usable, ${saved.heldBack} held back`,
    );
    return {
      ok: true as const,
      sku: ctx.product.mainSku,
      acceptedPages: screened.acceptedSources,
      rejectedPages: screened.rejectedSources,
      droppedFindings: screened.dropped,
      ...saved,
    };
  }

  /**
   * A person has read where a value came from and accepted it.
   *
   * The one way a held-back suggestion becomes something that can be published. It changes no value
   * â€” that would be an edit, and an edit already records itself as one â€” it records that somebody
   * looked. Deliberately per aspect: "I checked the wattage" is a claim a person can honestly make
   * about one field and rarely about fourteen at once.
   */
  async confirmAspect(
    productId: string,
    args: { name: string; integrationId?: string; companyIds?: string[]; userId?: string },
  ) {
    const row = await this.ebayIntegration(args.integrationId, args.companyIds);
    const plan = await this.prisma.productChannelPlan.findFirst({
      where: { productId, ...this.planKey(row) },
      select: { id: true, aspects: true },
    });
    if (!plan) throw new NotFoundException('This product has no eBay plan yet.');

    const records = normaliseAspects(plan.aspects);
    const rec = records[args.name];
    // Confirming something that is not stored would write a value nobody supplied.
    if (!rec) throw new NotFoundException(`Nothing is stored for "${args.name}".`);

    const next = { ...records, [args.name]: verifyAspect(rec, new Date().toISOString(), args.userId) };
    await this.prisma.productChannelPlan.update({
      where: { id: plan.id },
      data: { aspects: toJson(next), ...(args.userId ? { updatedById: args.userId } : {}) },
    });
    this.logger.log(`eBay aspect confirmed for ${productId}: ${args.name}`);
    return { ok: true as const, name: args.name, provenance: describeProvenance(next[args.name]) };
  }

  /** Assemble the payload from the product, so preview and publish cannot disagree. */
  private async buildInput(productId: string, args: PublishArgs): Promise<{
    input: EbayOfferInput; productSku: string; integrationId: string; categoryName: string | null;
    planned: Record<string, string>; facts: { brand: string | null; mpn: string | null };
    /** What THIS product overrides, so a form can show which answers are its own. */
    overrides: EbayListingDefaults;
    /** The description's per-product parts as stored, for section 3 to edit. */
    extras: DescriptionExtras;
  }> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: {
        brand: { select: { name: true } },
        /**
         * In the platform's order, so the featured image leads.
         *
         * eBay makes the first image the listing's main one. This read them by upload time, while the
         * product page â€” and every other screen â€” orders by sortOrder, which is what "Make featured"
         * rewrites. So a product whose featured image was chosen after upload went to eBay led by
         * whichever picture happened to be uploaded first. Upload time stays as the tie-breaker.
         */
        media: { where: { deletedAt: null }, select: { url: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
      // `manufacturerSku` is already selected by `include`'s implicit scalar set; named here only
      // so the aspect resolution below is obviously reading a real column.
    });
    if (!product) throw new NotFoundException('Product not found');

    /**
     * The saved plan is the default for everything a category decides. Arguments still win, so a
     * preview can try a different category without disturbing what was agreed â€” but a publish with
     * no arguments sends what somebody chose, rather than nothing.
     */
    const row = await this.ebayIntegration(args.integrationId);
    const plan = await this.prisma.productChannelPlan.findFirst({
      where: { productId, ...this.planKey(row) },
      select: {
        categoryRef: true, categoryName: true, aspects: true, condition: true, handlingTimeDays: true, offerPriceCents: true,
        merchantLocationKey: true, fulfillmentPolicyId: true, paymentPolicyId: true, returnPolicyId: true,
        descriptionExtras: true,
      },
    });
    const extras = normaliseExtras(plan?.descriptionExtras);
    const store = descriptionStore(row.config);
    /**
     * Where an offer's location and policies come from: this product, else the channel's defaults.
     * They are the same for almost every listing, so they are answered once on the channel and only
     * overridden where a product genuinely differs â€” otherwise every product would ask four
     * questions whose answer never changes.
     */
    const defaults = ebayListingDefaults(row.config);
    /**
     * What we will actually offer for sale: the availability maSquare already broadcasts to every
     * channel. Not typed in per listing, so the number eBay is given and the number the quantity
     * push maintains are the same number and cannot drift apart.
     */
    const availability = await this.prisma.productAvailability.findUnique({
      where: { productId },
      select: { quantity: true },
    });
    /**
     * Read through the provenance rules, not straight out of the column. The column now holds
     * records rather than strings, and â€” more importantly â€” a value nothing vouches for must not
     * reach a payload just because it is stored.
     */
    const planned = eligibleValues(normaliseAspects(plan?.aspects));

    return {
      productSku: product.mainSku,
      integrationId: row.id,
      /** So the eBay content tab can show the saved category's fields without it being chosen again. */
      categoryName: plan?.categoryName ?? null,
      planned,
      facts: { brand: product.brand?.name ?? null, mpn: product.manufacturerSku ?? null },
      extras,
      overrides: {
        merchantLocationKey: plan?.merchantLocationKey ?? null,
        fulfillmentPolicyId: plan?.fulfillmentPolicyId ?? null,
        paymentPolicyId: plan?.paymentPolicyId ?? null,
        returnPolicyId: plan?.returnPolicyId ?? null,
      },
      input: {
        sku: ebaySafeSku(product.mainSku),
        // eBay's own title field, falling back to the catalogue title.
        title: product.ebayTitle ?? product.title ?? null,
        /**
         * Rendered here rather than stored, so every listing shares one design and restyling them
         * all is an edit to the template. The specification table is built from `planned` â€” the
         * answers that already passed identity checks and the two-source rule â€” so nothing
         * unverified can appear in a table that reads as authoritative.
         */
        descriptionHtml: renderEbayDescription({
          title: product.ebayTitle ?? product.title ?? '',
          brand: product.brand?.name ?? null,
          mpn: product.manufacturerSku ?? null,
          series: extras.series,
          storeName: store.storeName,
          conditionLabel: store.conditionLabel,
          /**
           * Only figures still backed by a verified item specific: a value held back for a person,
           * or changed since research, drops out of the strip on its own.
           */
          glance: resolveGlance(extras.glance, planned),
          /**
           * The full Description first. `shortDescription` is the two-sentence blurb under the price
           * on the B2B store; preferring it put that blurb on eBay in place of the real description
           * for every product carrying both. It is kept only as a fallback for a product with no
           * description at all.
           */
          intro: htmlToPlainText(product.descriptionHtml) || htmlToPlainText(product.shortDescription),
          features: Array.isArray(product.keyFeatures) ? (product.keyFeatures as string[]) : [],
          /**
           * Built from `planned` â€” the answers that already passed identity checks and the
           * two-source rule â€” so nothing unverified can appear in a table that reads as
           * authoritative. The groups only arrange it.
           */
          specGroups: groupSpecs({ brand: product.brand?.name ?? null, mpn: product.manufacturerSku ?? null }, planned, extras.groups),
          inTheBox: extras.inTheBox,
          conditionNote: store.conditionNote,
          care: extras.care,
          shipping: store.shipping,
          faq: extras.faq,
        }) || null,
        keyFeatures: Array.isArray(product.keyFeatures) ? (product.keyFeatures as string[]) : [],
        imageUrls: product.media.map((m) => m.url).filter(Boolean),
        brand: product.brand?.name ?? null,
        mpn: product.manufacturerSku ?? null,
        ean: product.ean ?? null,
        condition: args.condition ?? ebayCondition(plan?.condition) ?? 'NEW',
        // Availability only. A quantity passed in the request would be a figure no person set in
        // Availability, reaching a live listing â€” which only Push to channels and orders may do.
        quantity: availability?.quantity ?? null,
        priceValue: args.priceValue ?? (plan?.offerPriceCents != null ? plan.offerPriceCents / 100 : null),
        currency: args.currency ?? 'GBP',
        marketplaceId: args.marketplaceId ?? 'EBAY_GB',
        categoryId: args.categoryId ?? plan?.categoryRef ?? null,
        merchantLocationKey: args.merchantLocationKey ?? plan?.merchantLocationKey ?? defaults.merchantLocationKey,
        fulfillmentPolicyId: args.fulfillmentPolicyId ?? plan?.fulfillmentPolicyId ?? defaults.fulfillmentPolicyId,
        paymentPolicyId: args.paymentPolicyId ?? plan?.paymentPolicyId ?? defaults.paymentPolicyId,
        returnPolicyId: args.returnPolicyId ?? plan?.returnPolicyId ?? defaults.returnPolicyId,
        handlingTimeDays: args.handlingTimeDays ?? plan?.handlingTimeDays ?? null,
        /**
         * The plan stores one value per aspect; the payload wants a list. Converted here rather than
         * stored as lists, because a form that can only ever set one value should not pretend
         * otherwise â€” and an explicit argument still overrides the whole aspect.
         */
        extraAspects: {
          ...Object.fromEntries(
            Object.entries(planned)
              .filter(([, v]) => typeof v === 'string' && v.trim())
              .map(([k, v]) => [k, [String(v).trim()]]),
          ),
          ...(args.aspects ?? {}),
        },
      },
    };
  }

  /**
   * What we WOULD send, and everything that would stop it. Sends nothing to eBay.
   *
   * Item specifics are part of "missing" even though `missingForPublish` cannot see them: which
   * aspects a category demands is only knowable by asking eBay, so the answer is fetched here and
   * folded in. Without it the gate could read READY on a listing eBay would refuse â€” which is the
   * one thing a preview must never do.
   */
  async preview(productId: string, args: PublishArgs) {
    const { input, productSku, integrationId, planned, facts, categoryName, overrides, extras } = await this.buildInput(productId, args);
    const missing = missingForPublish(input);

    /**
     * Whether this product is already on eBay, and so what a publish would actually do.
     *
     * The panel is the same one before and after a listing exists, so without this it could not tell
     * the two apart â€” it offered "Publish" on a product that had been live for an hour, and would
     * have made a second listing of any product already on eBay by hand.
     */
    const row = await this.ebayIntegration(args.integrationId);
    const { identity, listedAt } = await this.identityFor(productId, row, productSku);
    if (identity.action !== 'refuse') input.sku = identity.sku;
    const listed = identity.action === 'update'
      ? { itemId: identity.itemId, listedAt, url: ebayItemUrl(identity.itemId), adopted: identity.adopted }
      : null;

    if (input.categoryId) {
      const res = await this.integrations.ebayCategoryAspects(integrationId, input.categoryId);
      /**
       * A failed lookup is not an empty one. If eBay could not be asked, the aspects are unknown and
       * saying "nothing missing" would be inventing an answer â€” so it says so instead.
       */
      if (!res.ok) missing.push({ key: 'aspects', label: `Could not check item specifics (${res.message})` });
      else {
        const resolved = resolveAspects(res.aspects, planned, facts);
        for (const name of missingAspects(resolved)) missing.push({ key: `aspect:${name}`, label: name });
      }
    }

    return {
      productSku,
      ebaySku: input.sku,
      /** Set once this product has been published here. Null means it has not. */
      listed,
      /** What pressing Publish would do: create, update the listing above, or refuse to duplicate. */
      action: identity.action,
      refusal: identity.action === 'refuse' ? identity.reason : null,
      categoryId: input.categoryId ?? null,
      categoryName,
      missing,
      /**
       * What this listing would actually carry, and which of it this product decided for itself.
       * Shown rather than left implicit: four identifiers that "come from somewhere" are exactly
       * the sort of thing nobody checks until a listing ships from the wrong address.
       */
      listing: {
        merchantLocationKey: input.merchantLocationKey ?? null,
        fulfillmentPolicyId: input.fulfillmentPolicyId ?? null,
        paymentPolicyId: input.paymentPolicyId ?? null,
        returnPolicyId: input.returnPolicyId ?? null,
        quantity: input.quantity ?? null,
        /** As publish will send it â€” the stored value read through the same rule, NEW if unset. */
        condition: input.condition,
      },
      overrides,
      /** The description's per-product parts, and the verified item specifics they may draw on. */
      descriptionExtras: extras,
      verifiedSpecifics: planned,
      inventoryItem: buildInventoryItem(input),
      offer: buildOffer(input),
    };
  }

  /**
   * Create the listing for real.
   *
   * Refuses unless every gate is open and says which one is shut. Steps one and two are private and
   * reversible; step three is not, so it happens last and only after the first two have succeeded.
   */
  /**
   * What a publish of this product would be: a first listing, an update, or a refusal.
   *
   * Reads the plan (what we published and recorded) and the eBay UK listings the last sync saw for
   * this product. Only eBay UK and listings whose market could not be told: eBaymag republishes each
   * UK listing to other markets under the same SKU, and those copies are not second listings to
   * refuse over. An unresolved row is counted because it might BE the UK listing â€” it errs towards
   * refusing, which is the safe direction.
   */
  private async identityFor(productId: string, row: { id: string; marketplace: string | null }, mainSku: string) {
    const plan = await this.prisma.productChannelPlan.findFirst({
      where: { productId, ...this.planKey(row) },
      select: { status: true, channelSku: true, externalListingId: true, listedAt: true },
    });

    /**
     * Found by SKU as well as by product link. A listing our own code published with its SKU
     * stripped is exactly the kind of row the sync may not have linked â€” LAGA158WEA9EF sat unlinked
     * on eBay UK and Italy â€” and a guard that only asked "which listings belong to this product"
     * could not see the very case it was written for.
     */
    const aliases = await this.prisma.productSkuAlias.findMany({ where: { productId, deletedAt: null }, select: { skuValue: true } });
    const stripped = mainSku.replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);
    const forms = [...new Set([mainSku, stripped, ...aliases.map((a) => a.skuValue)])];
    const rows = await this.prisma.channelListing.findMany({
      where: {
        integrationId: row.id,
        marketplace: { in: ['GB', ''] },
        OR: [{ productId }, { channelSku: { in: forms } }],
      },
      select: { channelSku: true, externalListingId: true },
    });
    const existing = rows.map((l) => ({ channelSku: l.channelSku, itemId: l.externalListingId }));

    /**
     * And eBay itself, for the one shape the database cannot be relied on for: a listing we published
     * stripped that no sync has pulled in yet. LE-83306 was on eBay as LE83306 and nowhere in the
     * platform. Asked only when there is something to find â€” a product whose SKU has punctuation,
     * with no listing of ours recorded.
     */
    let unknown: string | null = null;
    if (plan?.status !== 'LISTED' && stripped !== mainSku) {
      const res = await this.integrations.ebayOffersForSku(row.id, stripped);
      if (!res.ok) unknown = res.message;
      else {
        for (const o of res.offers) {
          if (!o.listingId || existing.some((e) => e.itemId === o.listingId)) continue;
          existing.push({ channelSku: stripped, itemId: o.listingId });
        }
      }
    }

    const identity = publishIdentity({ mainSku, plan, existing });
    return { identity, listedAt: plan?.listedAt ?? null, unknown };
  }

  async publish(productId: string, args: PublishArgs & { confirm?: boolean }) {
    if (!(await this.liveWritesEnabled())) {
      throw new BadRequestException(
        process.env.LISTING_LIVE_WRITES === 'false'
          ? 'Listing writes are disabled on this server by configuration. Nothing was sent to eBay.'
          : 'Creating listings is switched off. Turn on "Create real marketplace listings" in Settings â†’ General first. Nothing was sent to eBay.',
      );
    }
    if (!args.confirm) throw new BadRequestException('Publishing a real listing needs an explicit confirmation.');

    const row = await this.ebayIntegration(args.integrationId);
    const { input, productSku, integrationId, planned, facts } = await this.buildInput(productId, args);

    /**
     * Decided before anything is sent. A listing we made is updated under the SKU it was made with;
     * anything else already on eBay for this product is refused rather than listed a second time.
     * See publish-identity.ts.
     */
    const { identity, unknown } = await this.identityFor(productId, row, productSku);
    if (identity.action === 'refuse') throw new BadRequestException(identity.reason);
    // Could not ask eBay whether we already listed this under its old SKU. Not knowing is not "no":
    // publishing on a guess is exactly how the duplicate this guards against gets made.
    if (unknown && identity.action === 'create') {
      throw new BadRequestException(`Could not confirm with eBay that this product is not already listed (${unknown}). Nothing was sent; try again.`);
    }
    input.sku = identity.sku;

    const missing = missingForPublish(input);
    if (missing.length > 0) throw new BadRequestException(`Not ready to list: ${missing.map((m) => m.label).join(', ')}`);

    /**
     * The same aspect check the preview makes, repeated here rather than trusted from it. A preview
     * can be minutes old and a category's demands are eBay's to change; publishing on a stale pass
     * would fail at the marketplace, which is the expensive place to find out.
     */
    if (input.categoryId) {
      const res = await this.integrations.ebayCategoryAspects(integrationId, input.categoryId);
      if (!res.ok) throw new BadRequestException(`Could not check the category's item specifics: ${res.message}`);
      const resolved = resolveAspects(res.aspects, planned, facts);
      const gaps = missingAspects(resolved);
      if (gaps.length) throw new BadRequestException(`Not ready to list â€” item specifics: ${gaps.join(', ')}`);
      input.extraAspects = { ...aspectsForPayload(resolved), ...(args.aspects ?? {}) };
    }

    const item = await this.integrations.ebayPutInventoryItem(row.id, input.sku, buildInventoryItem(input));
    if (!item.ok) throw new BadRequestException(`eBay refused the inventory item: ${item.message}`);

    const offerBody = buildOffer(input);
    const offer = await this.integrations.ebayCreateOffer(row.id, offerBody);
    if (!offer.ok) throw new BadRequestException(`eBay refused the offer: ${offer.message}`);
    /**
     * An offer eBay already held is brought up to date before it is published. Otherwise the publish
     * sends what the first attempt stored â€” the old description, price and policies â€” however much
     * the product has been corrected since.
     */
    if (offer.reused) {
      const updated = await this.integrations.ebayUpdateOffer(row.id, offer.offerId, offerUpdateBody(offerBody));
      if (!updated.ok) throw new BadRequestException(`eBay refused to update its existing offer ${offer.offerId}: ${updated.message}`);
    }

    // Everything above this line is private and deletable. Everything below is public.
    const published = await this.integrations.ebayPublishOffer(row.id, offer.offerId);
    if (!published.ok) {
      // The offer survives a failed publish, so say so â€” otherwise a retry creates a second one.
      throw new BadRequestException(`eBay refused to publish offer ${offer.offerId}: ${published.message}`);
    }

    this.logger.log(`eBay listing published: ${productSku} -> ${input.sku} listing ${published.listingId}`);

    /**
     * Remember that it is listed, and as what.
     *
     * The listing id used to reach the browser in a toast and nowhere else. The product then reopened
     * exactly as it looked before â€” the same checks, the same live Publish button â€” and nothing on
     * screen said the listing existed until the next eBay sync happened to pull it in. Amazon's
     * listings have said "Submitted" for weeks from these same columns, which exist for exactly this
     * ("Set once the channel confirms the listing: ASIN, eBay ItemID, OnBuy OPC") and were simply
     * never written for eBay.
     *
     * LISTED rather than SUBMITTED, because eBay's publish is synchronous: an item id back means a
     * buyable listing, not a request still being considered. A failure to record it is logged and
     * does not fail the publish â€” the listing is live either way, and a publish reported as failed
     * would invite a second one.
     */
    try {
      await this.prisma.productChannelPlan.updateMany({
        where: { productId, ...this.planKey(row) },
        // channelSku is what makes the next publish an update: it is the SKU eBay knows this listing by.
        data: { status: 'LISTED', externalListingId: published.listingId ?? null, listedAt: new Date(), channelSku: input.sku },
      });
    } catch (e: any) {
      this.logger.error(`eBay listing ${published.listingId} is live but could not be recorded on the plan: ${e?.message ?? e}`);
    }

    /**
     * And on the channel's own list, so the listing cards know it at once.
     *
     * Those cards read only what the channel sync has pulled, so a listing made here showed "not
     * listed" — with no Edit price — until the next sync. Written as the sync would write it; the
     * sync overwrites it with eBay's own figures when it next runs.
     */
    try {
      const integration = await this.prisma.channelIntegration.findUnique({ where: { id: row.id }, select: { targetCompanyId: true } });
      await this.prisma.channelListing.upsert({
        where: { integrationId_channelSku_marketplace: { integrationId: row.id, channelSku: input.sku, marketplace: 'GB' } },
        create: {
          integrationId: row.id, companyId: integration?.targetCompanyId ?? null, channelSku: input.sku, marketplace: 'GB',
          productId, externalListingId: published.listingId ?? null, listedPrice: input.priceValue ?? null,
          listedQuantity: input.quantity ?? null, currency: input.currency ?? 'GBP', listingStatus: 'ACTIVE', lastPushedAt: new Date(),
        },
        update: {
          productId, externalListingId: published.listingId ?? null, listedPrice: input.priceValue ?? null,
          listedQuantity: input.quantity ?? null, currency: input.currency ?? 'GBP', listingStatus: 'ACTIVE', lastPushedAt: new Date(),
        },
      });
    } catch (e: any) {
      this.logger.warn(`eBay listing ${published.listingId} is live but could not be added to the channel listings: ${e?.message ?? e}`);
    }

    return {
      ok: true,
      productSku,
      ebaySku: input.sku,
      offerId: offer.offerId,
      offerReused: offer.reused,
      listingId: published.listingId,
      url: ebayItemUrl(published.listingId),
    };
  }

  /**
   * Find out WHICH part of an inventory item eBay is rejecting.
   *
   * eBay answers a malformed inventory item with "A system error has occurred. Core Inventory
   * Service internal error" â€” the same message whatever the cause, naming no field. Guessing costs
   * a deploy and a round trip each time, so this tries a ladder of progressively plainer payloads
   * against a throwaway SKU and reports where the boundary is: the first rung that succeeds tells
   * you what the rung below it was carrying that eBay would not take.
   *
   * Everything here is private. An inventory item is not a listing, nothing is visible to buyers,
   * and the throwaway SKU is deleted afterwards whatever happens.
   */
  async diagnoseInventoryItem(productId: string, args: PublishArgs) {
    if (!(await this.liveWritesEnabled())) {
      throw new BadRequestException('Listing writes are switched off, so nothing can be tried against eBay.');
    }
    const row = await this.ebayIntegration(args.integrationId);
    const { input } = await this.buildInput(productId, args);
    const full = buildInventoryItem(input) as any;
    // Always a throwaway SKU, so a failure says something about the PAYLOAD. It could once use the
    // real SKU â€” which wrote that live SKU's quantity and then DELETED its inventory item.
    const DIAG_SKU = 'MASQDIAG' + input.sku;

    const strip = (obj: any, keys: string[]) => {
      const next = JSON.parse(JSON.stringify(obj));
      for (const k of keys) delete next.product[k];
      return next;
    };

    const rungs: Array<{ label: string; body: any }> = [
      { label: 'full payload', body: full },
      { label: 'without bulletPoints', body: strip(full, ['bulletPoints']) },
      { label: 'without bulletPoints + aspects', body: strip(full, ['bulletPoints', 'aspects']) },
      { label: 'without bulletPoints + aspects + ean/mpn/brand', body: strip(full, ['bulletPoints', 'aspects', 'ean', 'mpn', 'brand']) },
      { label: 'title + description + images only', body: strip(full, ['bulletPoints', 'aspects', 'ean', 'mpn', 'brand', 'subtitle']) },
      { label: 'title + description, NO images', body: strip(full, ['bulletPoints', 'aspects', 'ean', 'mpn', 'brand', 'imageUrls']) },
    ];

    const results: Array<{ rung: string; ok: boolean; status?: number; message?: string }> = [];
    for (const r of rungs) {
      const res = await this.integrations.ebayPutInventoryItem(row.id, DIAG_SKU, r.body);
      results.push({ rung: r.label, ok: res.ok, ...(res.ok ? {} : { status: res.status, message: res.message }) });
      // Clean up between rungs so each is judged on its own, not on what a previous one left behind.
      await this.integrations.ebayDeleteInventoryItem(row.id, DIAG_SKU);
      if (res.ok) break; // the first rung that works is the answer; plainer ones tell us nothing more
    }

    const firstOk = results.find((r) => r.ok);
    return {
      diagnosticSku: DIAG_SKU,
      results,
      verdict: !firstOk
        ? 'Even the plainest payload was refused â€” the problem is not a field in the product.'
        : results.length === 1
          // The full payload went through under a throwaway SKU. Nothing is wrong with the fields,
          // so what publish refused was the SKU itself â€” eBay will not let the Inventory API adopt
          // a SKU already carried by a listing created outside it.
          ? 'The full payload is fine under a different SKU. The rejection is about the SKU, not the content â€” most likely it already belongs to a listing created outside the Inventory API.'
          : `eBay accepts "${firstOk.rung}". What the previous rung carried is what it refuses.`,
    };
  }

  /** End a published listing. The way back. */
  async withdraw(offerId: string, integrationId?: string) {
    const row = await this.ebayIntegration(integrationId);
    const res = await this.integrations.ebayWithdrawOffer(row.id, offerId);
    if (!res.ok) throw new BadRequestException(`eBay refused to withdraw: ${res.message}`);
    this.logger.log(`eBay offer withdrawn: ${offerId}`);
    return { ok: true, offerId };
  }
}

/**
 * The plan's condition column is free text, and eBay accepts three values.
 *
 * Narrowed rather than cast: a row holding something else â€” typed by hand, or left over from a
 * channel with a different vocabulary â€” falls back to NEW instead of being sent and refused.
 */
function ebayCondition(value: string | null | undefined): 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD' | null {
  const v = (value ?? '').trim().toUpperCase();
  return v === 'NEW' || v === 'USED_EXCELLENT' || v === 'USED_GOOD' ? v : null;
}

/**
 * The evidence, flattened for the wire.
 *
 * `basis` and `heldBack` are derived here rather than stored, so a rule change applies to values
 * written before it existed â€” the whole reason the origins are kept instead of a trust stamp.
 */
/** Same page written twice â€” trailing slash, different case â€” is one page. */
function dedupeUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url) continue;
    const key = url.toLowerCase().replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/**
 * The host, for labelling a finding with where it came from.
 *
 * A full URL is too long to sit beside a value and the host is what tells somebody whether to trust
 * it â€” `beurer.com` reads differently from a marketplace nobody recognises.
 */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'that page';
  }
}

/**
 * A numeric setting from the environment, with a default when it is unset or nonsense.
 *
 * `Number('')` is 0, which for a VAT rate or a fee would silently produce a confident wrong price â€”
 * so anything that does not parse as a finite number falls back rather than being believed.
 */
/**
 * What each eBay marketplace sells in. Used to price a listing in the currency a buyer will pay,
 * rather than in whatever currency the product's cost happens to be recorded in.
 */
const EBAY_CURRENCY: Record<string, string> = {
  GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR',
  US: 'USD', CA: 'CAD', AU: 'AUD', CH: 'CHF', PL: 'PLN',
};

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function describeProvenance(rec: AspectRecord) {
  return {
    basis: classifyAspect(rec),
    /** What is stored. For a held-back aspect this is a suggestion, not the value in use. */
    value: rec.value,
    heldBack: !isPayloadEligible(rec),
    verifiedAt: rec.verifiedAt ?? null,
    origins: rec.origins.map((o) => ({
      kind: o.kind,
      value: o.value,
      url: o.url ?? null,
      label: o.label ?? null,
      at: o.at ?? null,
    })),
  };
}

export interface PublishArgs {
  integrationId?: string;
  marketplaceId?: string;
  categoryId?: string | null;
  merchantLocationKey?: string | null;
  fulfillmentPolicyId?: string | null;
  paymentPolicyId?: string | null;
  returnPolicyId?: string | null;
  priceValue?: number | null;
  currency?: string;
  condition?: 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD';
  handlingTimeDays?: number | null;
  /** Item specifics the chosen category requires, e.g. { Model: ['NBP003NBL'] }. */
  aspects?: Record<string, string[]>;
}

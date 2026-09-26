import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductFactsService } from '../gather/product-facts.service';
import { byCanonicalName, canonicalFactName } from '../gather/fact-names';
import { hasCopy, readProductCopy, renderTitle, type ProductCopy } from '../gather/product-copy';
import { classifyAspect, isPayloadEligible, normaliseAspects } from '../gather/provenance';
import { CHANNEL_CONTENT_RULES, contentRulesFor } from './content-rules';
import { chooseCategory, type CategoryCandidate, type CategoryChoice } from './category-choice';
import { EbayListingService } from './ebay/ebay-listing.service';
import { OnbuyContentService } from './onbuy/onbuy-content.service';
import { OnbuyListingService } from './onbuy/onbuy-listing.service';

/** The channels whose words and fields this brief covers, in the order a person thinks of them. */
const COVERED = ['ebay', 'onbuy', 'jinius'] as const;

/**
 * Everything every channel wants of one product, asked once.
 *
 * Research was per channel and so was its cost: a researcher was sent out for eBay's item specifics,
 * then sent out again for OnBuy's fields, over the same pages, about the same product. Half those
 * fields are the same fact under a different name, and the halves that differ are not worth a second
 * trip. Every channel added multiplied the trips.
 *
 * So one brief unions what every channel is waiting for, deduplicated by what the fact IS rather
 * than by what each marketplace calls it, and says which channels each one serves — a researcher can
 * then see that answering "colour" once settles it in three places.
 *
 * The words are asked for once too. A title is stored as parts and assembled per channel, so what a
 * researcher supplies is the brand, the model, what the thing is and the facts buyers filter on —
 * and the tightest channel's limit is stated, because parts that fit eBay's 80 fit everywhere.
 */
@Injectable()
export class ProductContentService {
  private readonly logger = new Logger(ProductContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: ProductFactsService,
    private readonly ebay: EbayListingService,
    private readonly onbuy: OnbuyContentService,
    /** OnBuy's category search lives here; it stands in for the taxonomy suggestion eBay has. */
    private readonly onbuyListing: OnbuyListingService,
  ) {}

  private async product(productId: string) {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true, mainSku: true, title: true, manufacturerSku: true, ean: true, upc: true, copy: true,
        manufacturerUrls: true, brand: { select: { name: true, website: true } },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  /**
   * What our own products of the same internal category went in, on one channel.
   *
   * A person's judgement, already made, repeatedly. It is the second opinion the marketplace's own
   * suggestion is weighed against - and where the two agree there is nothing left to decide.
   */
  private async categoryHistory(productId: string, channelType: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId }, select: { categoryId: true } });
    if (!product?.categoryId) return null;
    const used = await this.prisma.productChannelPlan.findMany({
      where: {
        deletedAt: null, productId: { not: productId }, categoryRef: { not: null },
        integration: { channelType, deletedAt: null },
        product: { categoryId: product.categoryId, deletedAt: null },
      },
      select: { categoryRef: true, categoryName: true },
      take: 500,
    });
    const by = new Map<string, { id: string; name: string; uses: number }>();
    for (const u of used) {
      const id = (u.categoryRef ?? '').trim();
      if (!id) continue;
      const e = by.get(id) ?? { id, name: u.categoryName ?? id, uses: 0 };
      e.uses += 1;
      by.set(id, e);
    }
    return [...by.values()].sort((a, b) => b.uses - a.uses)[0] ?? null;
  }

  /** What the marketplace itself suggests for this product, in its own taxonomy. */
  private async marketplaceSuggestions(productId: string, channelType: string, companyIds: string[]): Promise<CategoryCandidate[]> {
    try {
      if (channelType === 'ebay') {
        const r = await this.ebay.categorySuggestions(productId, undefined, undefined, companyIds);
        return (r.suggestions ?? []).map((sg: any) => ({ id: String(sg.categoryId), name: String(sg.categoryName ?? ''), path: sg.path ?? null, relevancy: sg.relevancy ?? null }));
      }
      if (channelType === 'onbuy') {
        /**
         * OnBuy has no equivalent of eBay's taxonomy suggestion, so its own search stands in: the
         * words a buyer would use to find the thing are the words its categories are named for.
         */
        const p = await this.product(productId);
        const words = [p.brand?.name, p.title].filter(Boolean).join(' ').trim();
        if (words.length < 2) return [];
        const integration = await this.onbuy.integrationFor(undefined, companyIds);
        const r = await this.onbuyListing.searchCategories(integration.id, words, companyIds);
        return (r.categories ?? []).map((c: any) => ({ id: String(c.id ?? c.categoryId ?? ''), name: String(c.name ?? c.tree ?? ''), path: c.tree ?? null }));
      }
    } catch {
      // A marketplace that will not answer leaves the history to decide on its own, which it can.
    }
    return [];
  }

  /**
   * Choose the categories nobody has chosen, and apply the ones that are not in doubt.
   *
   * Picking a category was the last compulsory human step before a product could be listed, asked
   * once per channel per product, and usually obvious. It is applied here rather than suggested,
   * because a suggestion somebody still has to accept is the same interruption with an extra click.
   *
   * The one case left alone is a real disagreement between the marketplace and our own history -
   * see `category-choice.ts` for why that one is worth a person.
   */
  async ensureCategories(productId: string, companyIds: string[], actorId?: string) {
    const decided: { channel: string; choice: CategoryChoice; applied: boolean }[] = [];

    for (const channel of COVERED) {
      const rules = contentRulesFor(channel)!;
      if (!rules.needsCategory) continue;

      const integrations = await this.prisma.channelIntegration.findMany({
        where: { deletedAt: null, status: 'active', channelType: channel, targetCompanyId: { in: companyIds } },
        select: { id: true, marketplace: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!integrations.length) continue;

      const existing = await this.prisma.productChannelPlan.findFirst({
        where: { productId, deletedAt: null, categoryRef: { not: null }, integration: { channelType: channel, deletedAt: null } },
        select: { categoryRef: true },
      });
      if ((existing?.categoryRef ?? '').trim()) continue; // Somebody has already decided.

      const [suggestions, history] = await Promise.all([
        this.marketplaceSuggestions(productId, channel, companyIds),
        this.categoryHistory(productId, channel),
      ]);
      const choice = chooseCategory(suggestions, history);

      let applied = false;
      if (choice.confident && choice.id) {
        for (const intg of integrations) {
          await this.prisma.productChannelPlan.upsert({
            where: { productId_integrationId_marketplace: { productId, integrationId: intg.id, marketplace: intg.marketplace ?? '' } },
            create: {
              productId, integrationId: intg.id, marketplace: intg.marketplace ?? '',
              categoryRef: choice.id, categoryName: choice.name, createdById: actorId ?? null,
            },
            update: { categoryRef: choice.id, categoryName: choice.name, updatedById: actorId ?? null },
          });
        }
        applied = true;
        this.logger.log(`Category chosen for ${productId} on ${channel}: ${choice.name} (${choice.basis})`);
      }
      decided.push({ channel, choice, applied });
    }
    return decided;
  }

  /**
   * What each channel is waiting to be told, as far as it can be known.
   *
   * A channel with no category chosen cannot say which fields exist — that is the marketplace's
   * answer and the category is what unlocks it. Reported as exactly that rather than as an empty
   * list, because "nothing is needed" and "nobody has said yet" are different answers and only one
   * of them means a researcher can stop.
   */
  private async fieldsByChannel(productId: string, companyIds: string[]) {
    const out: { channel: string; label: string; fields: string[]; problem: string | null }[] = [];

    const plans = await this.prisma.productChannelPlan.findMany({
      where: { productId, deletedAt: null },
      select: { categoryRef: true, integration: { select: { channelType: true } } },
    });
    const categoryFor = (type: string) =>
      plans.find((pl) => pl.integration.channelType === type && (pl.categoryRef ?? '').trim())?.categoryRef ?? null;

    for (const channel of COVERED) {
      const rules = contentRulesFor(channel)!;
      const category = categoryFor(channel);
      if (rules.needsCategory && !category) {
        out.push({ channel, label: rules.label, fields: [], problem: `No ${rules.label} category is chosen, so its fields are not knowable yet.` });
        continue;
      }
      try {
        if (channel === 'ebay') {
          const res = await this.ebay.categoryAspects(productId, category!, undefined, companyIds);
          out.push({ channel, label: rules.label, fields: (res.aspects ?? []).map((a: { name: string }) => a.name), problem: null });
        } else if (channel === 'onbuy') {
          const integration = await this.onbuy.integrationFor(undefined, companyIds);
          const fields = await this.onbuy.categoryFields(integration.id, category!);
          out.push({ channel, label: rules.label, fields: fields.map((f) => f.name), problem: null });
        } else {
          /**
           * Jinius attaches an offer to a product its catalogue already holds, so it asks nothing of
           * a researcher until we create a product there. Said plainly rather than left out, so a
           * reader does not wonder whether it was forgotten.
           */
          out.push({ channel, label: rules.label, fields: [], problem: 'Jinius asks for no researched fields when an offer attaches to a product it already carries.' });
        }
      } catch (e: any) {
        out.push({ channel, label: rules.label, fields: [], problem: e?.message ?? `${rules.label} could not be asked about its fields.` });
      }
    }
    return out;
  }

  /**
   * One brief for every channel.
   *
   * `wanted` is the union, deduplicated by what a fact IS. Each entry names the channels it serves
   * and whether anything is already known, so a researcher spends its trips on what is genuinely
   * missing rather than on re-finding what eBay's research settled last week.
   */
  async brief(productId: string, companyIds: string[], actorId?: string) {
    const p = await this.product(productId);
    /**
     * Categories first, because a category decides which fields exist.
     *
     * Asking what a channel wants before it has one gets "no category chosen" - which was the answer
     * the whole brief used to give for every channel nobody had got round to. Choosing here means
     * the fields below are the real ones.
     */
    const categories = await this.ensureCategories(productId, companyIds, actorId);
    const [known, byChannel] = await Promise.all([
      this.facts.facts(productId),
      this.fieldsByChannel(productId, companyIds),
    ]);

    /** Every field every channel wants, folded to one entry per fact. */
    const wanted = new Map<string, { fact: string; askedBy: { channel: string; name: string }[]; known: string | null; heldBack: boolean }>();
    for (const c of byChannel) {
      for (const name of c.fields) {
        const key = canonicalFactName(name);
        if (!key) continue;
        const entry = wanted.get(key) ?? { fact: name, askedBy: [], known: null, heldBack: false };
        entry.askedBy.push({ channel: c.channel, name });
        wanted.set(key, entry);
      }
    }
    const knownByFact = byCanonicalName(known);
    for (const [key, entry] of wanted) {
      const hit = knownByFact.get(key);
      if (!hit) continue;
      entry.known = hit.value.value;
      entry.heldBack = !isPayloadEligible(hit.value);
    }

    const copy = readProductCopy(p.copy);
    /** The tightest limit any covered channel imposes: parts that fit it fit everywhere. */
    const tightest = Math.min(...COVERED.map((c) => CHANNEL_CONTENT_RULES[c].titleMax ?? Infinity));

    return {
      productId: p.id,
      sku: p.mainSku,
      internalTitle: p.title,
      brand: p.brand?.name ?? null,
      manufacturerSku: p.manufacturerSku,
      ean: p.ean,
      upc: p.upc,
      pagesNominatedByAPerson: p.manufacturerUrls,
      /** What is already known about the product, however any channel named it. */
      alreadyKnown: Object.fromEntries(
        [...knownByFact].map(([key, v]) => [key, { value: v.value.value, basis: classifyAspect(v.value), heldBackForAPerson: !isPayloadEligible(v.value) }]),
      ),
      channels: byChannel.map((c) => ({ channel: c.channel, label: c.label, fieldCount: c.fields.length, problem: c.problem })),
      /** Categories chosen just now, and any left for a person because the evidence disagreed. */
      categoriesChosen: categories.map((d) => ({
        channel: d.channel, applied: d.applied, basis: d.choice.basis,
        category: d.choice.name, because: d.choice.because,
        alternatives: d.choice.alternatives.map((a) => ({ id: a.id, name: a.name })),
      })),
      wanted: [...wanted.values()].sort((a, b) => b.askedBy.length - a.askedBy.length),
      copy: {
        current: hasCopy(copy) ? copy : null,
        /** What each channel's title would come out as from the parts we hold. */
        renders: COVERED
          .filter((c) => CHANNEL_CONTENT_RULES[c].titleMax != null)
          .map((c) => ({ channel: c, limit: CHANNEL_CONTENT_RULES[c].titleMax!, title: renderTitle(copy.title, CHANNEL_CONTENT_RULES[c].titleMax!) })),
        titleLimitToWriteFor: Number.isFinite(tightest) ? tightest : null,
      },
    };
  }

  /**
   * The words, once, as parts.
   *
   * Deliberately not a finished title: a finished title belongs to one channel's limit, and storing
   * one would put us back where we started. What is stored is what the title is MADE of, so every
   * channel's version is assembled from the same decision.
   */
  async submitCopy(
    productId: string,
    args: { title?: { brand?: string; model?: string; whatItIs?: string; attributes?: string[] }; paragraphs?: string[]; features?: string[]; userId?: string },
  ) {
    const p = await this.product(productId);
    const next: ProductCopy = readProductCopy({
      title: args.title ?? readProductCopy(p.copy).title,
      paragraphs: args.paragraphs ?? readProductCopy(p.copy).paragraphs,
      features: args.features ?? readProductCopy(p.copy).features,
    });
    if (!hasCopy(next)) throw new BadRequestException('Nothing to save — give at least a title part, a paragraph or a feature line.');

    await this.prisma.product.update({
      where: { id: p.id },
      data: { copy: next as unknown as object, ...(args.userId ? { updatedById: args.userId } : {}) },
    });
    this.logger.log(`Product copy saved for ${p.mainSku}`);

    return {
      ok: true as const,
      sku: p.mainSku,
      /** What each channel will show, so a writer sees the consequence of the parts they chose. */
      renders: COVERED
        .filter((c) => CHANNEL_CONTENT_RULES[c].titleMax != null)
        .map((c) => {
          const limit = CHANNEL_CONTENT_RULES[c].titleMax!;
          const title = renderTitle(next.title, limit);
          return { channel: c, limit, title, fits: title.length <= limit };
        }),
    };
  }

  /**
   * Research findings, kept for every channel at once.
   *
   * The per-channel paths still exist and still fold into their own records; this is the one to use
   * when the research was done for the product rather than for a marketplace.
   */
  async rememberFindings(productId: string, accepted: readonly { field: string; value: string; kind: any; url?: string; label?: string }[], userId?: string) {
    const p = await this.product(productId);
    const learned = await this.facts.remember(p.id, accepted, new Date().toISOString(), userId);
    const store = await this.facts.facts(p.id);
    return {
      ok: true as const,
      sku: p.mainSku,
      learned,
      held: Object.values(normaliseAspects(store)).filter((r) => !isPayloadEligible(r)).length,
    };
  }
}

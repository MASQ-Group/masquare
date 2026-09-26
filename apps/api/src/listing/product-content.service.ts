import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductFactsService } from '../gather/product-facts.service';
import { byCanonicalName, canonicalFactName } from '../gather/fact-names';
import { hasCopy, readProductCopy, renderTitle, type ProductCopy } from '../gather/product-copy';
import { classifyAspect, isPayloadEligible, normaliseAspects } from '../gather/provenance';
import { CHANNEL_CONTENT_RULES, contentRulesFor } from './content-rules';
import { EbayListingService } from './ebay/ebay-listing.service';
import { OnbuyContentService } from './onbuy/onbuy-content.service';

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
  async brief(productId: string, companyIds: string[]) {
    const p = await this.product(productId);
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

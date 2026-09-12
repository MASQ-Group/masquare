import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { buildInventoryItem, buildOffer, ebaySafeSku, missingForPublish, type EbayOfferInput } from './offer-payload';
import { aspectsForPayload, missingAspects, resolveAspects } from './category-plan';

/**
 * Creating an eBay listing through the Inventory API.
 *
 * Unlike Amazon, where we attach an offer to a catalogue entry someone else already wrote, eBay
 * makes us supply the whole listing: title, description, images, category and aspects. That is why
 * the product card grew the Content tab.
 *
 * The immediate reason this exists is a question nobody can answer from documentation: does eBaymag
 * pick up a listing created through the Inventory API, or only ones made in Seller Central? The
 * account currently has ZERO inventory items — every one of its 5,150 listings came from the
 * Trading API or by hand — so the only way to find out is to publish one and look.
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
   * enough to reach a seller account — so a request that names one it may not see must fail here
   * rather than quietly act through the other company's token. Omitted only by callers with no user
   * behind them, which is background work and correctly unscoped.
   */
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
      // Stated rather than left for the caller to work out from four empty arrays.
      blockers: [
        ...(pre.locations.length === 0 ? ['No merchant location — every offer needs one'] : []),
        ...(pre.fulfillmentPolicies.length === 0 ? ['No postage policy'] : []),
        ...(pre.paymentPolicies.length === 0 ? ['No payment policy'] : []),
        ...(pre.returnPolicies.length === 0 ? ['No returns policy'] : []),
        ...pre.errors,
      ],
    };
  }

  /**
   * Create the merchant location the account is missing.
   *
   * A write, but it creates an address record rather than a listing — nothing public, nothing
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
   * derived from our taxonomy — only requested. Searched on the eBay title where there is one,
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
        where: { productId, integrationId: row.id },
        select: { aspects: true, categoryRef: true },
      }),
      this.integrations.ebayCategoryAspects(row.id, categoryId),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!res.ok) throw new BadRequestException(`eBay would not describe that category: ${res.message}`);

    const planned = (plan?.aspects && typeof plan.aspects === 'object' ? plan.aspects : {}) as Record<string, string>;
    const resolved = resolveAspects(res.aspects, planned, {
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
   * is the whole requirement here — there is no per-marketplace fan-out for us to store.
   */
  async savePlan(
    productId: string,
    args: { integrationId?: string; categoryId: string; categoryName?: string | null; aspects?: Record<string, string>; condition?: string; handlingTimeDays?: number | null; offerPriceCents?: number | null; companyIds?: string[] },
  ) {
    const row = await this.ebayIntegration(args.integrationId, args.companyIds);
    const existing = await this.prisma.productChannelPlan.findFirst({
      where: { productId, integrationId: row.id },
      select: { id: true },
    });
    const data = {
      categoryRef: args.categoryId,
      categoryName: args.categoryName ?? null,
      aspects: args.aspects ?? {},
      ...(args.condition ? { condition: args.condition } : {}),
      ...(args.handlingTimeDays !== undefined ? { handlingTimeDays: args.handlingTimeDays } : {}),
      ...(args.offerPriceCents !== undefined ? { offerPriceCents: args.offerPriceCents } : {}),
    };
    const saved = existing
      ? await this.prisma.productChannelPlan.update({ where: { id: existing.id }, data })
      : await this.prisma.productChannelPlan.create({ data: { productId, integrationId: row.id, marketplace: '', ...data } });
    this.logger.log(`eBay plan saved for ${productId}: category ${args.categoryId}`);
    return { ok: true as const, planId: saved.id, categoryId: saved.categoryRef };
  }

  /** Assemble the payload from the product, so preview and publish cannot disagree. */
  private async buildInput(productId: string, args: PublishArgs): Promise<{
    input: EbayOfferInput; productSku: string; integrationId: string;
    planned: Record<string, string>; facts: { brand: string | null; mpn: string | null };
  }> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: {
        brand: { select: { name: true } },
        media: { where: { deletedAt: null }, select: { url: true }, orderBy: { createdAt: 'asc' } },
      },
      // `manufacturerSku` is already selected by `include`'s implicit scalar set; named here only
      // so the aspect resolution below is obviously reading a real column.
    });
    if (!product) throw new NotFoundException('Product not found');

    /**
     * The saved plan is the default for everything a category decides. Arguments still win, so a
     * preview can try a different category without disturbing what was agreed — but a publish with
     * no arguments sends what somebody chose, rather than nothing.
     */
    const row = await this.ebayIntegration(args.integrationId);
    const plan = await this.prisma.productChannelPlan.findFirst({
      where: { productId, integrationId: row.id },
      select: { categoryRef: true, aspects: true, condition: true, handlingTimeDays: true, offerPriceCents: true },
    });
    const planned = (plan?.aspects && typeof plan.aspects === 'object' ? plan.aspects : {}) as Record<string, string>;

    return {
      productSku: product.mainSku,
      integrationId: row.id,
      planned,
      facts: { brand: product.brand?.name ?? null, mpn: product.manufacturerSku ?? null },
      input: {
        sku: ebaySafeSku(product.mainSku),
        // eBay's own title field, falling back to the catalogue title.
        title: product.ebayTitle ?? product.title ?? null,
        descriptionHtml: product.descriptionHtml ?? null,
        keyFeatures: Array.isArray(product.keyFeatures) ? (product.keyFeatures as string[]) : [],
        imageUrls: product.media.map((m) => m.url).filter(Boolean),
        brand: product.brand?.name ?? null,
        mpn: product.manufacturerSku ?? null,
        ean: product.ean ?? null,
        condition: args.condition ?? ebayCondition(plan?.condition) ?? 'NEW',
        quantity: args.quantity ?? null,
        priceValue: args.priceValue ?? (plan?.offerPriceCents != null ? plan.offerPriceCents / 100 : null),
        currency: args.currency ?? 'GBP',
        marketplaceId: args.marketplaceId ?? 'EBAY_GB',
        categoryId: args.categoryId ?? plan?.categoryRef ?? null,
        merchantLocationKey: args.merchantLocationKey ?? null,
        fulfillmentPolicyId: args.fulfillmentPolicyId ?? null,
        paymentPolicyId: args.paymentPolicyId ?? null,
        returnPolicyId: args.returnPolicyId ?? null,
        handlingTimeDays: args.handlingTimeDays ?? plan?.handlingTimeDays ?? null,
        /**
         * The plan stores one value per aspect; the payload wants a list. Converted here rather than
         * stored as lists, because a form that can only ever set one value should not pretend
         * otherwise — and an explicit argument still overrides the whole aspect.
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
   * folded in. Without it the gate could read READY on a listing eBay would refuse — which is the
   * one thing a preview must never do.
   */
  async preview(productId: string, args: PublishArgs) {
    const { input, productSku, integrationId, planned, facts } = await this.buildInput(productId, args);
    const missing = missingForPublish(input);

    if (input.categoryId) {
      const res = await this.integrations.ebayCategoryAspects(integrationId, input.categoryId);
      /**
       * A failed lookup is not an empty one. If eBay could not be asked, the aspects are unknown and
       * saying "nothing missing" would be inventing an answer — so it says so instead.
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
      categoryId: input.categoryId ?? null,
      missing,
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
  async publish(productId: string, args: PublishArgs & { confirm?: boolean }) {
    if (!(await this.liveWritesEnabled())) {
      throw new BadRequestException(
        process.env.LISTING_LIVE_WRITES === 'false'
          ? 'Listing writes are disabled on this server by configuration. Nothing was sent to eBay.'
          : 'Creating listings is switched off. Turn on "Create real marketplace listings" in Settings → General first. Nothing was sent to eBay.',
      );
    }
    if (!args.confirm) throw new BadRequestException('Publishing a real listing needs an explicit confirmation.');

    const row = await this.ebayIntegration(args.integrationId);
    const { input, productSku, integrationId, planned, facts } = await this.buildInput(productId, args);
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
      if (gaps.length) throw new BadRequestException(`Not ready to list — item specifics: ${gaps.join(', ')}`);
      input.extraAspects = { ...aspectsForPayload(resolved), ...(args.aspects ?? {}) };
    }

    const item = await this.integrations.ebayPutInventoryItem(row.id, input.sku, buildInventoryItem(input));
    if (!item.ok) throw new BadRequestException(`eBay refused the inventory item: ${item.message}`);

    const offer = await this.integrations.ebayCreateOffer(row.id, buildOffer(input));
    if (!offer.ok) throw new BadRequestException(`eBay refused the offer: ${offer.message}`);

    // Everything above this line is private and deletable. Everything below is public.
    const published = await this.integrations.ebayPublishOffer(row.id, offer.offerId);
    if (!published.ok) {
      // The offer survives a failed publish, so say so — otherwise a retry creates a second one.
      throw new BadRequestException(`eBay refused to publish offer ${offer.offerId}: ${published.message}`);
    }

    this.logger.log(`eBay listing published: ${productSku} -> ${input.sku} listing ${published.listingId}`);
    return {
      ok: true,
      productSku,
      ebaySku: input.sku,
      offerId: offer.offerId,
      offerReused: offer.reused,
      listingId: published.listingId,
      url: `https://www.ebay.co.uk/itm/${published.listingId}`,
    };
  }

  /**
   * Find out WHICH part of an inventory item eBay is rejecting.
   *
   * eBay answers a malformed inventory item with "A system error has occurred. Core Inventory
   * Service internal error" — the same message whatever the cause, naming no field. Guessing costs
   * a deploy and a round trip each time, so this tries a ladder of progressively plainer payloads
   * against a throwaway SKU and reports where the boundary is: the first rung that succeeds tells
   * you what the rung below it was carrying that eBay would not take.
   *
   * Everything here is private. An inventory item is not a listing, nothing is visible to buyers,
   * and the throwaway SKU is deleted afterwards whatever happens.
   */
  async diagnoseInventoryItem(productId: string, args: PublishArgs & { useRealSku?: boolean }) {
    if (!(await this.liveWritesEnabled())) {
      throw new BadRequestException('Listing writes are switched off, so nothing can be tried against eBay.');
    }
    const row = await this.ebayIntegration(args.integrationId);
    const { input } = await this.buildInput(productId, args);
    const full = buildInventoryItem(input) as any;
    // Normally a throwaway SKU, so a failure says something about the PAYLOAD. With useRealSku it
    // uses the actual one, which is how you tell a bad payload apart from a SKU eBay will not take —
    // still only an inventory item, still private, still deleted afterwards.
    const DIAG_SKU = args.useRealSku ? input.sku : 'MASQDIAG' + input.sku;

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
        ? 'Even the plainest payload was refused — the problem is not a field in the product.'
        : results.length === 1
          // The full payload went through under a throwaway SKU. Nothing is wrong with the fields,
          // so what publish refused was the SKU itself — eBay will not let the Inventory API adopt
          // a SKU already carried by a listing created outside it.
          ? 'The full payload is fine under a different SKU. The rejection is about the SKU, not the content — most likely it already belongs to a listing created outside the Inventory API.'
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
 * Narrowed rather than cast: a row holding something else — typed by hand, or left over from a
 * channel with a different vocabulary — falls back to NEW instead of being sent and refused.
 */
function ebayCondition(value: string | null | undefined): 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD' | null {
  const v = (value ?? '').trim().toUpperCase();
  return v === 'NEW' || v === 'USED_EXCELLENT' || v === 'USED_GOOD' ? v : null;
}

export interface PublishArgs {
  integrationId?: string;
  marketplaceId?: string;
  categoryId?: string | null;
  merchantLocationKey?: string | null;
  fulfillmentPolicyId?: string | null;
  paymentPolicyId?: string | null;
  returnPolicyId?: string | null;
  quantity?: number | null;
  priceValue?: number | null;
  currency?: string;
  condition?: 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD';
  handlingTimeDays?: number | null;
  /** Item specifics the chosen category requires, e.g. { Model: ['NBP003NBL'] }. */
  aspects?: Record<string, string[]>;
}

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { PricingService } from '../../pricing/pricing.service';
import { OnbuyImagesService } from './onbuy-images.service';
import {
  buildOnbuyProductBody, missingForOnbuyProduct, parseOnbuyCategories, readOnbuyProductSubmit, readOnbuyQueue,
  requiredOnbuyFeatures, suggestOnbuyCategory, type OnbuyProductInput,
} from './onbuy-product';
import {
  ONBUY_BOOST_LEVELS, buildOnbuyActivateBody, buildOnbuyCreateBody, missingForOnbuyListing, onbuyErrorMessage, onbuyIdentity,
  parseOnbuyDeliveryTemplates, parseOnbuySearch, readOnbuyCreateResult, type OnbuyListingInput,
} from './onbuy-listing';

/**
 * Listing a product on OnBuy UK against a product already in OnBuy's catalogue.
 *
 * The steps mirror Amazon's, because the shape is the same — attach to a catalogue entry found by
 * barcode — and the result is recorded the way eBay's is:
 *
 *   1. Find it: search OnBuy by our EAN/UPC; a person picks the product (its OPC), saved on the plan.
 *   2. Price: a suggestion at the platform's launch margin, from the same cost model as everywhere.
 *   3. Terms: an OnBuy delivery template from the seller account, handling time, boost.
 *   4. Check and list: create the listing, then the price and stock update that makes it live, and
 *      record the plan as LISTED against the OPC.
 *
 * Creating a product OnBuy does not have yet is a later step, and nothing here attempts it.
 */
@Injectable()
export class OnbuyListingService {
  private readonly logger = new Logger(OnbuyListingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly prices: PricingService,
    private readonly images: OnbuyImagesService,
  ) {}

  /** Same gate as eBay and Amazon: the environment overrules the setting. */
  async liveWritesEnabled(): Promise<boolean> {
    if (process.env.LISTING_LIVE_WRITES === 'false') return false;
    const settings = await this.prisma.platformSettings.findFirst({ select: { listingLiveWrites: true } });
    return settings?.listingLiveWrites ?? false;
  }

  /** The OnBuy connection this request may use — one of the caller's companies, or refused. */
  private async onbuyIntegration(integrationId: string, companyIds?: string[]) {
    const scope = companyIds ? { targetCompanyId: { in: companyIds } } : {};
    const row = await this.prisma.channelIntegration.findFirst({
      where: { id: integrationId, deletedAt: null, channelType: 'onbuy', ...scope },
      select: { id: true, name: true, marketplace: true, targetSalesChannelId: true },
    });
    if (!row) throw new NotFoundException('OnBuy integration not found');
    return row;
  }

  /** The plan row, keyed as ListingService keys it — on the integration's own marketplace. */
  private plan(productId: string, integration: { id: string; marketplace: string | null }) {
    return this.prisma.productChannelPlan.findFirst({
      where: { productId, integrationId: integration.id, marketplace: integration.marketplace ?? '', deletedAt: null },
    });
  }

  private static opcOf(plan: { aspects: unknown } | null): string | null {
    const opc = ((plan?.aspects as Record<string, unknown> | null) ?? {}).opc;
    return typeof opc === 'string' && opc.trim() ? opc.trim() : null;
  }

  /** Step 1: OnBuy catalogue products carrying this product's barcodes. */
  async candidates(productId: string, integrationId: string, companyIds?: string[]) {
    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { ean: true, upc: true } });
    if (!product) throw new NotFoundException('Product not found');
    const codes = [product.ean, product.upc].map((c) => (c ?? '').trim()).filter(Boolean);
    if (!codes.length) {
      return { codes, candidates: [], message: 'This product has no EAN or UPC, so it cannot be found on OnBuy. Add one on the product first.' };
    }
    const r = await this.integrations.onbuySearchByCodes(integration.id, codes);
    if (!r.ok) return { codes, candidates: [], message: `OnBuy refused the search: ${onbuyErrorMessage(r.json, r.status)}` };
    const candidates = parseOnbuySearch(r.json, codes);
    return {
      codes,
      candidates,
      message: candidates.length ? null : 'OnBuy has no product with this barcode yet. Creating new OnBuy products is not built yet.',
      mode: r.mode,
    };
  }

  /** The seller account's delivery templates, for step 3. */
  async deliveryTemplates(integrationId: string, companyIds?: string[]) {
    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const r = await this.integrations.onbuyDeliveryRows(integration.id);
    if (!r.ok) throw new BadRequestException(`OnBuy refused the delivery templates: ${onbuyErrorMessage(r.json, r.status)}`);
    return { templates: parseOnbuyDeliveryTemplates(r.json), boostLevels: ONBUY_BOOST_LEVELS };
  }

  /**
   * Step 2: the price that earns the platform's launch margin on OnBuy UK.
   *
   * Costed against the OnBuy sales channel the connection feeds — its currency, its VAT rules, its
   * own fee %. A suggestion: a person accepts it or types another, and the plan keeps what they chose.
   */
  async pricing(productId: string, integrationId: string, companyIds?: string[]) {
    const integration = await this.onbuyIntegration(integrationId, companyIds);
    if (!integration.targetSalesChannelId) {
      return { suggestion: null, problems: ['This OnBuy connection is not linked to a sales channel, so there is no fee or currency to price with. Link one in Setup → Integrations.'] };
    }
    const settings = await this.prisma.platformSettings.findFirst({ select: { launchMarginPct: true } });
    const target = settings?.launchMarginPct != null ? Number(settings.launchMarginPct) : 20;
    const r = await this.prices.priceForMargin(productId, integration.targetSalesChannelId, target);
    return { suggestion: { ...r, targetMarginPct: target }, problems: r.problems };
  }

  /** Everything a listing needs, resolved once, so preview and publish cannot build different requests. */
  private async buildInput(productId: string, integration: { id: string; marketplace: string | null }) {
    const [product, plan, availability] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, mainSku: true, ean: true, upc: true } }),
      this.plan(productId, integration),
      this.prisma.productAvailability.findUnique({ where: { productId }, select: { quantity: true } }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    const input: OnbuyListingInput = {
      opc: OnbuyListingService.opcOf(plan),
      sku: (plan?.channelSku ?? product.mainSku ?? '').trim() || null,
      condition: plan?.condition ?? 'NEW',
      price: plan?.offerPriceCents != null ? plan.offerPriceCents / 100 : null,
      stock: availability?.quantity ?? 0,
      deliveryTemplateId: plan?.deliveryTemplate?.trim() || null,
      handlingTimeDays: plan?.handlingTimeDays ?? null,
      boostPct: Number(plan?.boostPct ?? 0),
    };
    return { product, plan, input };
  }

  /** Step 4, read-only: what would be sent, what is missing, and whether it would create. */
  async preview(productId: string, integrationId: string, companyIds?: string[]) {
    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const { plan, input } = await this.buildInput(productId, integration);
    const missing = missingForOnbuyListing(input);

    let identity: ReturnType<typeof onbuyIdentity> | null = null;
    let identityNote: string | null = null;
    if (input.sku && input.opc) {
      const r = await this.integrations.onbuyListingsBySku(integration.id, [input.sku]);
      if (r.ok) {
        const existing = (Array.isArray(r.json?.results) ? r.json.results : []).map((l: any) => ({ sku: String(l?.sku ?? ''), opc: l?.opc ? String(l.opc) : null }));
        identity = onbuyIdentity({ sku: input.sku, opc: input.opc, planStatus: plan?.status ?? null, existing });
      } else {
        identityNote = `Could not ask OnBuy whether SKU ${input.sku} is already in use: ${onbuyErrorMessage(r.json, r.status)}`;
      }
    }

    return {
      input,
      missing,
      action: identity?.action ?? null,
      refusal: identity?.action === 'refuse' ? identity.reason : null,
      listed: identity?.action === 'listed' ? identity.reason : plan?.status === 'LISTED' ? 'This plan is recorded as listed on OnBuy.' : null,
      identityNote,
      liveWritesEnabled: await this.liveWritesEnabled(),
      create: missing.length ? null : buildOnbuyCreateBody(input),
      activate: missing.length ? null : buildOnbuyActivateBody(input),
    };
  }

  /**
   * Step 4: create the listing and make it live.
   *
   * Refused, in order, unless: live writes are on, a person confirmed, nothing is missing, the OPC
   * still carries this product's barcode, and the SKU is not already on OnBuy. Then the create, the
   * price and stock update, and the plan recorded as LISTED. A failed activation after a successful
   * create is reported as such — the listing exists and only needs its price and stock sent again.
   */
  async publish(productId: string, integrationId: string, opts: { confirm?: boolean }, actorId?: string, companyIds?: string[]) {
    if (!(await this.liveWritesEnabled())) throw new ConflictException('Live listing is switched off on this platform.');
    if (opts.confirm !== true) throw new BadRequestException('Confirm the listing to send it to OnBuy.');

    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const { product, plan, input } = await this.buildInput(productId, integration);
    const missing = missingForOnbuyListing(input);
    if (missing.length) throw new BadRequestException(`Cannot list on OnBuy yet — still needed: ${missing.join(', ')}.`);

    // The OPC must still be this product: a plan matched weeks ago on a barcode since corrected would
    // otherwise attach our SKU to somebody else's item.
    const codes = [product.ean, product.upc].map((c) => (c ?? '').trim()).filter(Boolean);
    const search = await this.integrations.onbuySearchByCodes(integration.id, codes);
    if (!search.ok) throw new BadRequestException(`Could not confirm the product on OnBuy: ${onbuyErrorMessage(search.json, search.status)}`);
    if (!parseOnbuySearch(search.json, codes).some((c) => c.opc === input.opc)) {
      throw new ConflictException(`OnBuy product ${input.opc} no longer carries this product's barcode. Find it on OnBuy again (step 1).`);
    }

    const existing = await this.integrations.onbuyListingsBySku(integration.id, [input.sku!]);
    if (!existing.ok) throw new BadRequestException(`Could not check whether SKU ${input.sku} is in use on OnBuy: ${onbuyErrorMessage(existing.json, existing.status)}`);
    const identity = onbuyIdentity({
      sku: input.sku!, opc: input.opc!, planStatus: plan?.status ?? null,
      existing: (Array.isArray(existing.json?.results) ? existing.json.results : []).map((l: any) => ({ sku: String(l?.sku ?? ''), opc: l?.opc ? String(l.opc) : null })),
    });
    if (identity.action === 'refuse') throw new ConflictException(identity.reason);
    if (identity.action === 'listed') throw new ConflictException(identity.reason);

    const created = await this.integrations.onbuyCreateListings(integration.id, buildOnbuyCreateBody(input));
    const result = created.ok ? readOnbuyCreateResult(created.json, input.sku!) : null;
    if (!created.ok || !result?.ok) {
      const why = created.ok ? result?.message : onbuyErrorMessage(created.json, created.status);
      this.logger.warn(`OnBuy listing refused for ${input.sku} on ${input.opc}: ${why}`);
      return { ok: false as const, message: `OnBuy refused the listing: ${why}`, mode: created.mode };
    }

    const activated = await this.integrations.onbuyUpdateBySku(integration.id, buildOnbuyActivateBody(input));
    const activationMessage = activated.ok ? null : `The listing was created, but setting its price and stock failed (${onbuyErrorMessage(activated.json, activated.status)}). The next stock push, or listing again, will send them.`;

    // Recorded after OnBuy has the listing, never instead of it: a failure here is logged, and the
    // next channel sync still finds the listing by its SKU.
    try {
      await this.prisma.productChannelPlan.updateMany({
        where: { productId, integrationId: integration.id, marketplace: integration.marketplace ?? '', deletedAt: null },
        data: { status: 'LISTED', externalListingId: input.opc, channelSku: input.sku, listedAt: new Date(), updatedById: actorId ?? null },
      });
    } catch (e: any) {
      this.logger.error(`OnBuy listing ${input.sku} created but the plan could not be updated: ${e?.message ?? e}`);
    }
    this.logger.log(`OnBuy listing created: ${input.sku} on ${input.opc} (${created.mode})`);

    return {
      ok: true as const,
      mode: created.mode,
      sku: input.sku,
      opc: input.opc,
      listingId: result.listingId,
      activated: activated.ok,
      message: activationMessage,
      url: `https://www.onbuy.com/gb/search/?query=${encodeURIComponent(input.opc!)}`,
    };
  }

  // ------------------------------------------------------------------ creating a new OnBuy product

  /** OnBuy categories matching what a person typed, that can take products. */
  async searchCategories(integrationId: string, q: string, companyIds?: string[]) {
    const integration = await this.onbuyIntegration(integrationId, companyIds);
    if ((q ?? '').trim().length < 2) return { categories: [] };
    const r = await this.integrations.onbuySearchCategories(integration.id, q);
    if (!r.ok) throw new BadRequestException(`OnBuy refused the category search: ${onbuyErrorMessage(r.json, r.status)}`);
    return { categories: parseOnbuyCategories(r.json) };
  }

  /** What a category asks for that we cannot supply — its required features. */
  private async requiredFeatures(integrationId: string, categoryId: string | null): Promise<{ features: string[]; note: string | null }> {
    if (!categoryId || !/^\d+$/.test(categoryId)) return { features: [], note: null };
    const r = await this.integrations.onbuyCategory(integrationId, categoryId);
    if (!r.ok) return { features: [], note: `Could not read OnBuy category ${categoryId}: ${onbuyErrorMessage(r.json, r.status)}` };
    return { features: requiredOnbuyFeatures(r.json), note: null };
  }

  /** The OnBuy category most used by products in the same internal category — "search, then remember". */
  async categorySuggestion(productId: string, integrationId: string, companyIds?: string[]) {
    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { categoryId: true } });
    if (!product?.categoryId) return { suggestion: null };
    const used = await this.prisma.productChannelPlan.findMany({
      where: {
        integrationId: integration.id, deletedAt: null, productId: { not: productId },
        categoryRef: { not: null }, product: { categoryId: product.categoryId, deletedAt: null },
      },
      select: { categoryRef: true, categoryName: true, updatedAt: true },
      take: 500,
    });
    return { suggestion: suggestOnbuyCategory(used) };
  }

  /** The new product, from the marketplace content and the plan. Images are counted, not converted. */
  private async buildProductInput(productId: string, plan: { categoryRef: string | null } | null) {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        mainSku: true, ean: true, upc: true, manufacturerSku: true,
        ebayTitle: true, descriptionHtml: true, keyFeatures: true,
        brand: { select: { name: true } },
        media: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, url: true } },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    const text = (v: string | null | undefined) => (v ?? '').trim() || null;
    const input: OnbuyProductInput = {
      categoryId: text(plan?.categoryRef),
      name: text(p.ebayTitle),
      description: text(p.descriptionHtml),
      summaryPoints: (p.keyFeatures ?? []).map((f) => f.trim()).filter(Boolean),
      brandName: text(p.brand?.name),
      productCode: text(p.ean) ?? text(p.upc),
      mpn: text(p.manufacturerSku),
      // Placeholders until submit converts them: a count is enough to say whether any exist.
      images: p.media.map((m) => m.url),
      uid: p.mainSku,
    };
    return { input, media: p.media, codes: [p.ean, p.upc].map((c) => (c ?? '').trim()).filter(Boolean) };
  }

  /** Whether OnBuy has since gained a product with our barcode — then it is a listing, not a creation. */
  private async existingOnbuyProduct(integrationId: string, codes: string[]) {
    if (!codes.length) return null;
    const r = await this.integrations.onbuySearchByCodes(integrationId, codes);
    return r.ok ? parseOnbuySearch(r.json, codes)[0] ?? null : null;
  }

  /** Read-only: what the new product would be, and what still stops it. */
  async createPreview(productId: string, integrationId: string, companyIds?: string[]) {
    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const { plan, input: listing } = await this.buildInput(productId, integration);
    const { input, codes } = await this.buildProductInput(productId, plan);
    const required = await this.requiredFeatures(integration.id, input.categoryId);
    const missing = missingForOnbuyProduct(input, listing, { requiredFeatures: required.features });
    const existing = await this.existingOnbuyProduct(integration.id, codes);
    const queue = OnbuyListingService.queueOf(plan);
    return {
      product: { ...input, images: undefined, imageCount: input.images.length },
      listing,
      missing,
      requiredFeatures: required.features,
      note: required.note,
      // OnBuy now has it: listing against it is the right move, and creating would be refused anyway.
      existing,
      queue,
      liveWritesEnabled: await this.liveWritesEnabled(),
    };
  }

  /** The queue state kept on the plan, if a product was submitted. */
  private static queueOf(plan: { aspects: unknown; status: string } | null) {
    const a = ((plan?.aspects as Record<string, any> | null) ?? {});
    return {
      queueId: typeof a.onbuyQueueId === 'string' ? a.onbuyQueueId : null,
      submittedAt: typeof a.onbuySubmittedAt === 'string' ? a.onbuySubmittedAt : null,
      error: typeof a.onbuyQueueError === 'string' ? a.onbuyQueueError : null,
      activationError: typeof a.onbuyActivationError === 'string' ? a.onbuyActivationError : null,
      productUrl: typeof a.onbuyProductUrl === 'string' ? a.onbuyProductUrl : null,
      status: plan?.status ?? null,
    };
  }

  private async mergeAspects(planId: string, patch: Record<string, unknown>, data: Record<string, unknown> = {}) {
    const current = await this.prisma.productChannelPlan.findUnique({ where: { id: planId }, select: { aspects: true } });
    const aspects = { ...((current?.aspects as Record<string, unknown> | null) ?? {}), ...patch };
    for (const [k, v] of Object.entries(aspects)) if (v === undefined) delete aspects[k];
    await this.prisma.productChannelPlan.update({ where: { id: planId }, data: { aspects: aspects as any, ...data } });
  }

  /**
   * Send the new product to OnBuy's queue, with our listing inside it.
   *
   * Refused, in order, unless: live writes are on, a person confirmed, nothing is missing, OnBuy still
   * has no product with our barcode, the SKU is free, and at least one image could be prepared. The
   * plan is then SUBMITTED with the queue id; checkProgress takes it from there.
   */
  async createSubmit(productId: string, integrationId: string, opts: { confirm?: boolean }, actorId?: string, companyIds?: string[]) {
    if (!(await this.liveWritesEnabled())) throw new ConflictException('Live listing is switched off on this platform.');
    if (opts.confirm !== true) throw new BadRequestException('Confirm to send the product to OnBuy.');

    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const { plan, input: listing } = await this.buildInput(productId, integration);
    if (!plan) throw new BadRequestException('Save the OnBuy plan first.');
    const queue = OnbuyListingService.queueOf(plan);
    if (plan.status === 'SUBMITTED' && queue.queueId) throw new ConflictException('This product is already in OnBuy’s queue. Check its progress instead.');

    const { input, media, codes } = await this.buildProductInput(productId, plan);
    const required = await this.requiredFeatures(integration.id, input.categoryId);
    const missing = missingForOnbuyProduct(input, listing, { requiredFeatures: required.features });
    if (missing.length) throw new BadRequestException(`Cannot create on OnBuy yet — still needed: ${missing.join(', ')}.`);

    const existing = await this.existingOnbuyProduct(integration.id, codes);
    if (existing) throw new ConflictException(`OnBuy already has this product (${existing.opc}). Choose it in step 1 and list against it instead.`);

    const skuCheck = await this.integrations.onbuyListingsBySku(integration.id, [listing.sku!]);
    if (!skuCheck.ok) throw new BadRequestException(`Could not check whether SKU ${listing.sku} is in use on OnBuy: ${onbuyErrorMessage(skuCheck.json, skuCheck.status)}`);
    const inUse = (Array.isArray(skuCheck.json?.results) ? skuCheck.json.results : []).find((l: any) => String(l?.sku ?? '') === listing.sku);
    if (inUse) throw new ConflictException(`SKU ${listing.sku} is already listed on OnBuy${inUse.opc ? ` (${inUse.opc})` : ''}. Use another SKU.`);

    const images = await this.images.prepare(media);
    if (!images.urls.length) throw new BadRequestException(`No image could be prepared for OnBuy. ${images.problems.join(' ')}`);

    const body = buildOnbuyProductBody({ ...input, images: images.urls }, listing);
    const sent = await this.integrations.onbuyCreateProduct(integration.id, body);
    const submit = sent.ok ? readOnbuyProductSubmit(sent.json) : { ok: false, queueId: null, message: onbuyErrorMessage(sent.json, sent.status) };
    if (!submit.ok || !submit.queueId) {
      this.logger.warn(`OnBuy refused product ${listing.sku}: ${submit.message}`);
      return { ok: false as const, message: `OnBuy refused the product: ${submit.message}`, imageProblems: images.problems, mode: sent.mode };
    }

    await this.mergeAspects(plan.id, {
      onbuyMode: 'create',
      onbuyQueueId: submit.queueId,
      onbuySubmittedAt: new Date().toISOString(),
      onbuyQueueError: undefined,
      onbuyActivationError: undefined,
    }, { status: 'SUBMITTED', channelSku: listing.sku, updatedById: actorId ?? null });
    this.logger.log(`OnBuy product queued: ${listing.sku} as ${submit.queueId} (${sent.mode})`);

    return { ok: true as const, queueId: submit.queueId, imageProblems: images.problems, mode: sent.mode };
  }

  /**
   * Where a submitted product has got to, and the next step when it has one.
   *
   *   pending   nothing to do yet.
   *   failed    the plan goes back to READY with OnBuy's reason, so it can be corrected and resent.
   *   success   the OPC is recorded, and the price and stock update that makes the listing live is
   *             sent. If that update fails the plan stays SUBMITTED with the OPC, and the next check
   *             sends it again rather than asking OnBuy to create the product twice.
   */
  async checkProgress(productId: string, integrationId: string, companyIds?: string[]) {
    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const plan = await this.plan(productId, integration);
    if (!plan) throw new NotFoundException('No OnBuy plan for this product');
    return this.advance(plan, integration);
  }

  private async advance(plan: { id: string; productId: string; status: string; aspects: unknown }, integration: { id: string; marketplace: string | null }) {
    const queue = OnbuyListingService.queueOf(plan);
    const opcSoFar = OnbuyListingService.opcOf(plan);
    if (plan.status !== 'SUBMITTED' || (!queue.queueId && !opcSoFar)) {
      return { status: plan.status, queue, message: 'Nothing is waiting on OnBuy for this product.' };
    }

    let opc = opcSoFar;
    if (!opc && queue.queueId) {
      const r = await this.integrations.onbuyQueue(integration.id, queue.queueId);
      if (!r.ok) return { status: plan.status, queue, message: `Could not ask OnBuy about the queue: ${onbuyErrorMessage(r.json, r.status)}` };
      const state = readOnbuyQueue(r.json, queue.queueId);
      if (state.status === 'pending' || state.status === 'unknown') {
        return { status: plan.status, queue, message: state.status === 'pending' ? 'Still in OnBuy’s queue — usually under 30 minutes.' : state.message };
      }
      if (state.status === 'failed') {
        await this.mergeAspects(plan.id, { onbuyQueueId: undefined, onbuyQueueError: state.message }, { status: 'READY' });
        this.logger.warn(`OnBuy product creation failed for plan ${plan.id}: ${state.message}`);
        return { status: 'READY', queue: { ...queue, queueId: null, error: state.message }, message: `OnBuy could not create the product: ${state.message}` };
      }
      opc = state.opc;
      if (!opc) return { status: plan.status, queue, message: 'OnBuy reported success without a product code. Check again shortly.' };
      await this.mergeAspects(plan.id, { opc, onbuyProductUrl: state.productUrl ?? undefined }, { externalListingId: opc });
    }

    // The product exists: make the listing live with its price and stock.
    const { input } = await this.buildInput(plan.productId, integration);
    const activate = await this.integrations.onbuyUpdateBySku(integration.id, buildOnbuyActivateBody({ ...input, opc }));
    if (!activate.ok) {
      const why = onbuyErrorMessage(activate.json, activate.status);
      await this.mergeAspects(plan.id, { onbuyActivationError: why });
      return { status: 'SUBMITTED', queue: { ...queue, activationError: why }, message: `The product was created (${opc}), but setting its price and stock failed: ${why}. It is tried again on the next check.` };
    }
    await this.mergeAspects(plan.id, { onbuyQueueId: undefined, onbuyActivationError: undefined }, { status: 'LISTED', externalListingId: opc, listedAt: new Date() });
    this.logger.log(`OnBuy product created and listed: plan ${plan.id} as ${opc}`);
    return { status: 'LISTED', queue: { ...queue, queueId: null }, opc, message: `Created on OnBuy as ${opc} and listed.` };
  }

  /**
   * Every 15 minutes, move submitted products along — so a product sent at the end of the day is
   * live by morning without anybody pressing "Check progress". Skipped while live writes are off,
   * because the step after success is a write.
   */
  @Cron('*/15 * * * *')
  async sweepSubmitted() {
    if (!(await this.liveWritesEnabled())) return;
    const plans = await this.prisma.productChannelPlan.findMany({
      where: { status: 'SUBMITTED', deletedAt: null, integration: { channelType: 'onbuy', deletedAt: null } },
      select: { id: true, productId: true, status: true, aspects: true, integration: { select: { id: true, marketplace: true } } },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    for (const p of plans) {
      try {
        await this.advance(p, p.integration);
      } catch (e: any) {
        this.logger.warn(`OnBuy sweep: plan ${p.id} not advanced: ${e?.message ?? e}`);
      }
    }
  }
}

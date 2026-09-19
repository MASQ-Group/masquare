import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { PricingService } from '../../pricing/pricing.service';
import { profitEntry, type ProfitEntry } from '../price/listing-price';
import { OnbuyImagesService } from './onbuy-images.service';
import { OnbuyContentService } from './onbuy-content.service';
import { parseOnbuyWinning, priceToBeat } from './onbuy-winning';
import {
  buildOnbuyProductBody, missingForOnbuyProduct, parseOnbuyCategories, readOnbuyProductSubmit, readOnbuyQueue,
  suggestOnbuyCategory, type OnbuyProductInput,
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
    private readonly content: OnbuyContentService,
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

  /**
   * Put a listing that has just gone live onto the channel's own list, so the listing cards — which
   * read only what the channel sync has pulled — know it straight away and offer Edit price. The
   * sync overwrites it with OnBuy's own figures when it next runs. Never fails the listing.
   */
  private async recordChannelListing(integrationId: string, productId: string, l: { sku: string; opc: string; price: number | null; stock: number | null }) {
    try {
      const integration = await this.prisma.channelIntegration.findUnique({ where: { id: integrationId }, select: { targetCompanyId: true } });
      const data = {
        productId, externalListingId: l.opc, listedPrice: l.price, listedQuantity: l.stock, currency: 'GBP',
        listingStatus: 'ACTIVE', lastPushedAt: new Date(),
      };
      await this.prisma.channelListing.upsert({
        where: { integrationId_channelSku_marketplace: { integrationId, channelSku: l.sku, marketplace: '' } },
        create: { integrationId, companyId: integration?.targetCompanyId ?? null, channelSku: l.sku, marketplace: '', ...data },
        update: data,
      });
    } catch (e: any) {
      this.logger.warn(`OnBuy listing ${l.sku} is live but could not be added to the channel listings: ${e?.message ?? e}`);
    }
  }

  /** Placed on OnBuy at stock 0 to see the price to beat, and not yet listed for sale. */
  private static stagedOf(plan: { aspects: unknown; status?: string } | null): boolean {
    const staged = ((plan?.aspects as Record<string, unknown> | null) ?? {}).onbuyStaged;
    return !!staged && plan?.status !== 'LISTED';
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
   * Step 2: the price that earns the platform's launch margin on OnBuy UK — and, when a price is
   * typed, what that price earns, with the breakeven beside it, as the Amazon and eBay steps show.
   *
   * Costed against the OnBuy sales channel the connection feeds — its currency, its VAT rules, its
   * own fee %. A suggestion: a person accepts it or types another, and the plan keeps what they chose.
   */
  async pricing(productId: string, integrationId: string, companyIds?: string[], atPriceCents?: number) {
    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const channelId = integration.targetSalesChannelId;
    if (!channelId) {
      return { suggestion: null, breakevenNative: null, at: null, problems: ['This OnBuy connection is not linked to a sales channel, so there is no fee or currency to price with. Link one in Setup → Integrations.'] };
    }
    const settings = await this.prisma.platformSettings.findFirst({ select: { launchMarginPct: true } });
    const target = settings?.launchMarginPct != null ? Number(settings.launchMarginPct) : 20;
    const [r, breakeven] = await Promise.all([
      this.prices.priceForMargin(productId, channelId, target),
      this.prices.priceForMargin(productId, channelId, 0),
    ]);
    let at: ProfitEntry | null = null;
    if (atPriceCents != null) {
      const econ = await this.prices.listingEconomics([{ key: 'at', productId, salesChannelId: channelId, grossNative: atPriceCents / 100, currency: r.currency }]);
      at = profitEntry(atPriceCents, econ.get('at'));
    }
    return { suggestion: { ...r, targetMarginPct: target }, breakevenNative: breakeven.priceNative, at, problems: r.problems };
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

    // Held at stock 0 for the price check: the listing exists, and listing it means sending price and stock.
    const staged = OnbuyListingService.stagedOf(plan);
    const action = staged && identity?.action === 'listed' ? 'activate' : identity?.action ?? null;
    return {
      input,
      missing,
      action,
      staged,
      refusal: identity?.action === 'refuse' ? identity.reason : null,
      listed: action === 'listed' ? identity!.reason : plan?.status === 'LISTED' ? 'This plan is recorded as listed on OnBuy.' : null,
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
    const staged = OnbuyListingService.stagedOf(plan);
    if (identity.action === 'listed' && !staged) throw new ConflictException(identity.reason);

    // Held at stock 0 for the price check: it already exists, so only its price and stock are sent.
    const created = staged && identity.action === 'listed'
      ? { ok: true, status: 200, json: { results: [{ success: true, sku: input.sku, opc: input.opc }] }, mode: existing.mode, siteId: existing.siteId }
      : await this.integrations.onbuyCreateListings(integration.id, buildOnbuyCreateBody(input));
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
      if (plan && staged) await this.mergeAspects(plan.id, { onbuyStaged: undefined });
      await this.recordChannelListing(integration.id, productId, { sku: input.sku!, opc: input.opc!, price: input.price, stock: input.stock });
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

  // ------------------------------------------------------------------ the price to beat

  /** Our SKUs for this product on this OnBuy connection: the plan's, and any the channel sync found. */
  private async ourSkus(productId: string, integration: { id: string; marketplace: string | null }) {
    const [plan, listings] = await Promise.all([
      this.plan(productId, integration),
      this.prisma.channelListing.findMany({ where: { productId, integrationId: integration.id }, select: { channelSku: true } }),
    ]);
    const skus = new Set(listings.map((l) => l.channelSku).filter(Boolean));
    if (plan?.channelSku && (plan.status === 'LISTED' || OnbuyListingService.stagedOf(plan))) skus.add(plan.channelSku);
    return { plan, skus: [...skus] };
  }

  /**
   * Whether our OnBuy listings for this product are winning, the price to beat, and what we would earn
   * at each price — so the decision is made with the margin in view, not just the number.
   */
  async competition(productId: string, integrationId: string, companyIds?: string[]) {
    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const { plan, skus } = await this.ourSkus(productId, integration);
    if (!skus.length) return { rows: [], staged: false, message: 'This product has no listing on OnBuy yet, so there is nothing to compare.', liveWritesEnabled: await this.liveWritesEnabled() };

    const r = await this.integrations.onbuyCheckWinning(integration.id, skus);
    if (!r.ok) throw new BadRequestException(`OnBuy refused the price check: ${onbuyErrorMessage(r.json, r.status)}`);
    const winning = parseOnbuyWinning(r.json);

    // What each candidate price earns, from the same economics as everywhere else.
    const cells: Array<{ key: string; productId: string; salesChannelId: string; grossNative: number | null; currency: string }> = [];
    for (const w of winning) {
      const t = priceToBeat(w);
      for (const [k, v] of [['price', w.price], ['beat', t.beat], ['match', t.match]] as const) {
        if (integration.targetSalesChannelId && v != null) {
          cells.push({ key: `${w.sku}|${k}`, productId, salesChannelId: integration.targetSalesChannelId, grossNative: v, currency: 'GBP' });
        }
      }
    }
    const econ = cells.length ? await this.prices.listingEconomics(cells) : new Map();
    const at = (sku: string, k: string) => {
      const e = econ.get(`${sku}|${k}`);
      return e ? { profitEur: e.profitEur, marginPct: e.marginPct } : null;
    };

    return {
      rows: winning.map((w) => {
        const t = priceToBeat(w);
        return { ...w, beat: t.beat, match: t.match, reason: t.reason, economics: { price: at(w.sku, 'price'), beat: at(w.sku, 'beat'), match: at(w.sku, 'match') } };
      }),
      staged: OnbuyListingService.stagedOf(plan),
      message: winning.length ? null : 'OnBuy returned nothing for these SKUs yet — a new listing can take a few minutes to appear.',
      liveWritesEnabled: await this.liveWritesEnabled(),
      noEconomics: !integration.targetSalesChannelId,
    };
  }

  /** Send a new price for one of our OnBuy listings of this product. Stock is left as it is. */
  async setPrice(productId: string, integrationId: string, opts: { sku?: string; price?: number; confirm?: boolean }, actorId?: string, companyIds?: string[]) {
    if (!(await this.liveWritesEnabled())) throw new ConflictException('Live listing is switched off on this platform.');
    if (opts.confirm !== true) throw new BadRequestException('Confirm the new price to send it to OnBuy.');
    const price = Math.round(Number(opts.price) * 100) / 100;
    if (!(price > 0)) throw new BadRequestException('A price above zero is needed.');

    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const { plan, skus } = await this.ourSkus(productId, integration);
    if (!opts.sku || !skus.includes(opts.sku)) throw new BadRequestException('That SKU is not one of this product’s OnBuy listings.');

    const r = await this.integrations.onbuyUpdateBySku(integration.id, { listings: [{ sku: opts.sku, price }] });
    const row = (Array.isArray(r.json?.results) ? r.json.results : [])[0];
    if (!r.ok || row?.success === false) {
      return { ok: false as const, message: `OnBuy refused the price: ${r.ok ? String(row?.message ?? 'no reason given') : onbuyErrorMessage(r.json, r.status)}` };
    }
    if (plan && plan.channelSku === opts.sku) {
      await this.prisma.productChannelPlan.update({ where: { id: plan.id }, data: { offerPriceCents: Math.round(price * 100), updatedById: actorId ?? null } });
    }
    await this.prisma.channelListing.updateMany({ where: { productId, integrationId: integration.id, channelSku: opts.sku }, data: { listedPrice: price } });
    this.logger.log(`OnBuy price set: ${opts.sku} → GBP ${price.toFixed(2)}`);
    return { ok: true as const, sku: opts.sku, price };
  }

  /**
   * Place our listing on OnBuy at stock 0 — inactive, nobody can buy it — so Check Winning can say
   * what price to beat before we go live.
   *
   * OnBuy has no call that shows other sellers' prices on a product we do not list, so the listing
   * has to exist first. It is marked as held on the plan: every stock push skips it, and "List on
   * OnBuy" sends only its final price and stock rather than creating it again.
   */
  async stageForPriceCheck(productId: string, integrationId: string, opts: { confirm?: boolean }, actorId?: string, companyIds?: string[]) {
    if (!(await this.liveWritesEnabled())) throw new ConflictException('Live listing is switched off on this platform.');
    if (opts.confirm !== true) throw new BadRequestException('Confirm to place the listing on OnBuy at stock 0.');

    const integration = await this.onbuyIntegration(integrationId, companyIds);
    const { product, plan, input } = await this.buildInput(productId, integration);
    if (!plan) throw new BadRequestException('Save the OnBuy plan first.');
    // Everything a listing needs except stock (held at zero on purpose) and the delivery template
    // (OnBuy uses the account default until the one chosen in step 3 is sent at listing).
    const missing = missingForOnbuyListing(input, { forPriceCheck: true });
    if (missing.length) throw new BadRequestException(`Cannot check the price yet — still needed: ${missing.join(', ')}. A provisional price is enough; it is changed before going live.`);

    const codes = [product.ean, product.upc].map((c) => (c ?? '').trim()).filter(Boolean);
    const search = await this.integrations.onbuySearchByCodes(integration.id, codes);
    if (!search.ok || !parseOnbuySearch(search.json, codes).some((c) => c.opc === input.opc)) {
      throw new ConflictException(`Could not confirm OnBuy product ${input.opc} still carries this product's barcode. Find it on OnBuy again (step 1).`);
    }

    const existing = await this.integrations.onbuyListingsBySku(integration.id, [input.sku!]);
    if (!existing.ok) throw new BadRequestException(`Could not check whether SKU ${input.sku} is in use on OnBuy: ${onbuyErrorMessage(existing.json, existing.status)}`);
    const identity = onbuyIdentity({
      sku: input.sku!, opc: input.opc!, planStatus: plan.status,
      existing: (Array.isArray(existing.json?.results) ? existing.json.results : []).map((l: any) => ({ sku: String(l?.sku ?? ''), opc: l?.opc ? String(l.opc) : null })),
    });
    if (identity.action === 'refuse') throw new ConflictException(identity.reason);
    if (plan.status === 'LISTED') throw new ConflictException('This product is already listed on OnBuy — check the winning price on the listing instead.');

    if (identity.action === 'create') {
      const created = await this.integrations.onbuyCreateListings(integration.id, buildOnbuyCreateBody({ ...input, stock: 0 }));
      const result = created.ok ? readOnbuyCreateResult(created.json, input.sku!) : null;
      if (!created.ok || !result?.ok) {
        return { ok: false as const, message: `OnBuy refused the listing: ${created.ok ? result?.message : onbuyErrorMessage(created.json, created.status)}` };
      }
      // Zero again by SKU, in case OnBuy applied the stock sent with the create.
      await this.integrations.onbuyUpdateBySku(integration.id, { listings: [{ sku: input.sku, stock: 0 }] });
    }
    await this.mergeAspects(plan.id, { onbuyStaged: new Date().toISOString() }, { channelSku: input.sku, updatedById: actorId ?? null });
    this.logger.log(`OnBuy listing held at stock 0 for a price check: ${input.sku} on ${input.opc}`);

    return { ok: true as const, competition: await this.competition(productId, integrationId, companyIds) };
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

  /**
   * The new product, from its OnBuy content and the plan. Images are counted, not converted.
   * `contentGaps` is what the OnBuy content still lacks — a required feature with no usable answer.
   */
  private async buildProductInput(productId: string, integration: { id: string; marketplace: string | null }, plan: { categoryRef: string | null } | null) {
    const content = await this.content.createParts(productId, integration, plan?.categoryRef ?? null);
    const p = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        mainSku: true, ean: true, upc: true, manufacturerSku: true,
        brand: { select: { name: true } },
        media: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, url: true } },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    const text = (v: string | null | undefined) => (v ?? '').trim() || null;
    const input: OnbuyProductInput = {
      categoryId: text(plan?.categoryRef),
      name: content.name,
      description: content.description,
      summaryPoints: content.summaryPoints,
      brandName: text(p.brand?.name),
      productCode: text(p.ean) ?? text(p.upc),
      mpn: text(p.manufacturerSku),
      // Placeholders until submit converts them: a count is enough to say whether any exist.
      images: p.media.map((m) => m.url),
      uid: p.mainSku,
      features: content.features,
      technical: content.technical,
      productData: content.productData,
      safety: content.safety,
      safetyDocuments: content.safetyDocuments,
      aiModel: content.aiModel,
    };
    return {
      input, media: p.media, codes: [p.ean, p.upc].map((c) => (c ?? '').trim()).filter(Boolean),
      contentGaps: content.missing, cannotSend: content.rejected,
    };
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
    const { input, codes, contentGaps, cannotSend } = await this.buildProductInput(productId, integration, plan);
    const missing = missingForOnbuyProduct(input, listing, { contentGaps });
    const existing = await this.existingOnbuyProduct(integration.id, codes);
    const queue = OnbuyListingService.queueOf(plan);
    return {
      product: {
        ...input, images: undefined, imageCount: input.images.length,
        features: undefined, technical: undefined, productData: undefined, safetyDocuments: undefined,
        featureCount: input.features.length, technicalCount: input.technical.length,
        productDataCount: input.productData.length, safetyDocumentCount: input.safetyDocuments.length,
      },
      listing,
      missing,
      /** Researched answers OnBuy cannot take (off its option list, or a unit it does not use). Not sent. */
      cannotSend,
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

    const { input, media, codes, contentGaps } = await this.buildProductInput(productId, integration, plan);
    const missing = missingForOnbuyProduct(input, listing, { contentGaps });
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
    if (input.sku && opc) await this.recordChannelListing(integration.id, plan.productId, { sku: input.sku, opc, price: input.price, stock: input.stock });
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

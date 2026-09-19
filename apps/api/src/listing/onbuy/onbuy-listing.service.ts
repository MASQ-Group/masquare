import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { PricingService } from '../../pricing/pricing.service';
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
}

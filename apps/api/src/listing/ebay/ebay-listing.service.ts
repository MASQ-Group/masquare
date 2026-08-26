import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { buildInventoryItem, buildOffer, ebaySafeSku, missingForPublish, type EbayOfferInput } from './offer-payload';

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

  private async ebayIntegration(integrationId?: string) {
    const row = integrationId
      ? await this.prisma.channelIntegration.findFirst({ where: { id: integrationId, deletedAt: null, channelType: 'ebay' } })
      : await this.prisma.channelIntegration.findFirst({ where: { deletedAt: null, channelType: 'ebay', status: 'active' } });
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

  /** Assemble the payload from the product, so preview and publish cannot disagree. */
  private async buildInput(productId: string, args: PublishArgs): Promise<{ input: EbayOfferInput; productSku: string }> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: {
        brand: { select: { name: true } },
        media: { where: { deletedAt: null }, select: { url: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    return {
      productSku: product.mainSku,
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
        condition: args.condition ?? 'NEW',
        quantity: args.quantity ?? null,
        priceValue: args.priceValue ?? null,
        currency: args.currency ?? 'GBP',
        marketplaceId: args.marketplaceId ?? 'EBAY_GB',
        categoryId: args.categoryId ?? null,
        merchantLocationKey: args.merchantLocationKey ?? null,
        fulfillmentPolicyId: args.fulfillmentPolicyId ?? null,
        paymentPolicyId: args.paymentPolicyId ?? null,
        returnPolicyId: args.returnPolicyId ?? null,
        handlingTimeDays: args.handlingTimeDays ?? null,
      },
    };
  }

  /** What we WOULD send, and what is missing. Sends nothing to eBay. */
  async preview(productId: string, args: PublishArgs) {
    const { input, productSku } = await this.buildInput(productId, args);
    return {
      productSku,
      ebaySku: input.sku,
      missing: missingForPublish(input),
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
    const { input, productSku } = await this.buildInput(productId, args);
    const missing = missingForPublish(input);
    if (missing.length > 0) throw new BadRequestException(`Not ready to list: ${missing.map((m) => m.label).join(', ')}`);

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

  /** End a published listing. The way back. */
  async withdraw(offerId: string, integrationId?: string) {
    const row = await this.ebayIntegration(integrationId);
    const res = await this.integrations.ebayWithdrawOffer(row.id, offerId);
    if (!res.ok) throw new BadRequestException(`eBay refused to withdraw: ${res.message}`);
    this.logger.log(`eBay offer withdrawn: ${offerId}`);
    return { ok: true, offerId };
  }
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
}

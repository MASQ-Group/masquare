import { Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PricingService } from '../pricing/pricing.service';
import { RepricingAnalyticsService } from '../amazon-repricing/analytics/repricing-analytics.service';
import type { ProgressSink } from '../jobs/jobs.service';
import { syncDecision } from './sync-decision';
import { deriveListingStatus } from './listing-status';
import { zeroingVerdict } from './zeroing-guard';
import { PUSH_MAX_ATTEMPTS, RECHECK_LIMIT, recheckCutoff } from './push-queue-recheck';
import { planTransition } from './plan-transition';
import { fullScopeIntegrationWhere } from '../common/amazon-scope';
import { settlePushQueue, type PushResult } from './push-queue-settle';
import { buildLooseSkuIndex, buildSkuOwnerIndex, matchSku, normaliseSku, relinkAction, suggestOwnerBySuffix } from './sku-match';
import { pickLiveListing, pickLiveListingsByKey } from './pick-live-listing';
import { channelKey } from './channel-key';

const ACTIVE = { deletedAt: null };
// Per-channel accent dots (fallback palette; overridden by the SalesChannel chip colour if set).
const PALETTE = ['#F59B00', '#0064D2', '#6E56CF', '#7AB55C', '#E0447B', '#14A79D', '#C77B22', '#2FA8A0'];

export interface ListingsQuery {
  q?: string;
  channelId?: string;
  brandId?: string;
  vendorId?: string;
  productTypeId?: string;
  /** Enforced company isolation: the companies the caller may see. */
  companyIds?: string[];
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ChannelListingsService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly pricing: PricingService,
    private readonly analytics: RepricingAnalyticsService,
  ) {}

  /**
   * A price a sync found on the channel, recorded when it differs from the last one we knew.
   *
   * This is how a price changed in Seller Central, or by another tool, reaches the history at all —
   * without it the record would show only our own changes and read as though nothing else moved.
   */
  private async notePulledPrice(
    intg: { id: string; targetCompanyId?: string | null },
    l: { sku?: string | null; price?: number | null; currency?: string | null; marketplace?: string | null },
    productId: string | null,
    marketplaceId: string,
  ): Promise<void> {
    if (!l.sku || l.price == null || !Number.isFinite(l.price)) return;
    await this.analytics.recordPrice({
      channelSku: l.sku,
      marketplaceId,
      priceCents: Math.round(l.price * 100),
      currency: l.currency ?? 'EUR',
      source: 'listing_sync',
      integrationId: intg.id,
      companyId: intg.targetCompanyId ?? null,
      productId,
    });
  }

  /** Derive a listing status the UI colours by: live | low | oos | paused | error. */
  private deriveStatus(l: { listedQuantity: number | null; listingStatus: string | null; fulfilmentChannel: string | null }): string {
    return deriveListingStatus(l);
  }

  /** The connected channels (Amazon marketplaces) that can carry listings. */
  async channels(companyIds?: string[]) {
    const rows = await this.prisma.channelIntegration.findMany({
      where: { ...ACTIVE, status: 'active', channelType: { in: ChannelListingsService.LISTING_CHANNELS }, ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, marketplace: true, channelType: true, targetSalesChannelId: true, targetCompanyId: true },
    });
    const scopeCompany = companyIds ? { companyId: { in: companyIds } } : {};

    // Per-marketplace listing counts (eBay spans marketplaces on one integration → many columns).
    const mktRows = await this.prisma.channelListing.groupBy({
      by: ['integrationId', 'marketplace'], where: { marketplace: { not: '' }, ...scopeCompany },
      _max: { lastPulledAt: true }, _count: { _all: true },
    });
    const marketsByInt = new Map<string, Array<{ marketplace: string; count: number; lastPulledAt: Date | null }>>();
    for (const m of mktRows) {
      const arr = marketsByInt.get(m.integrationId) ?? [];
      arr.push({ marketplace: m.marketplace, count: m._count._all, lastPulledAt: m._max.lastPulledAt });
      marketsByInt.set(m.integrationId, arr);
    }
    // Single-column (marketplace '') listing counts, for Amazon / OnBuy.
    const agg = await this.prisma.channelListing.groupBy({ by: ['integrationId'], where: { marketplace: '', ...scopeCompany }, _max: { lastPulledAt: true }, _count: { _all: true } });
    const byInt = new Map(agg.map((a) => [a.integrationId, a]));

    // Each eBay column maps to the company's matching eBay sales channel (by ISO), exactly like
    // eBay order routing — that gives the column its flag, currency and economics.
    const ebayCompanyIds = [...new Set(rows.filter((r) => r.channelType === 'ebay').map((r) => r.targetCompanyId).filter((v): v is string => !!v))];
    const ebayScs = ebayCompanyIds.length ? await this.prisma.salesChannel.findMany({
      where: { deletedAt: null, companyId: { in: ebayCompanyIds }, name: { contains: 'ebay', mode: 'insensitive' } },
      select: { id: true, name: true, chipBgColor: true, nativeCurrency: true, companyId: true, nativeCountry: { select: { isoCode: true } } },
    }) : [];
    const ebayScByCompanyIso = new Map<string, (typeof ebayScs)[number]>();
    for (const sc of ebayScs) if (sc.nativeCountry?.isoCode) ebayScByCompanyIso.set(`${sc.companyId}:${sc.nativeCountry.isoCode}`, sc);

    // Target sales channel for single-column integrations.
    const scIds = [...new Set(rows.map((r) => r.targetSalesChannelId).filter((v): v is string => !!v))];
    const scs = scIds.length ? await this.prisma.salesChannel.findMany({ where: { id: { in: scIds } }, select: { id: true, chipBgColor: true, nativeCurrency: true, nativeCountry: { select: { isoCode: true } } } }) : [];
    const scById = new Map(scs.map((s) => [s.id, s]));

    const out: any[] = [];
    let colorIdx = 0;
    for (const r of rows) {
      const markets = marketsByInt.get(r.id);
      if (r.channelType === 'ebay' && markets?.length) {
        for (const m of markets.slice().sort((a, b) => a.marketplace.localeCompare(b.marketplace))) {
          const sc = r.targetCompanyId ? ebayScByCompanyIso.get(`${r.targetCompanyId}:${m.marketplace}`) : null;
          out.push({
            id: channelKey({ integrationId: r.id, marketplace: m.marketplace }),
            name: sc?.name ?? `${r.name} ${m.marketplace}`,
            marketplace: m.marketplace,
            channelType: r.channelType,
            salesChannelId: sc?.id ?? null,
            countryIso: sc?.nativeCountry?.isoCode ?? m.marketplace,
            currency: sc?.nativeCurrency ?? null,
            color: sc?.chipBgColor || PALETTE[colorIdx++ % PALETTE.length],
            listingCount: m.count,
            lastPulledAt: m.lastPulledAt,
          });
        }
        continue;
      }
      const sc = r.targetSalesChannelId ? scById.get(r.targetSalesChannelId) : null;
      const a = byInt.get(r.id);
      out.push({
        /** Keyed on the LISTING's marketplace (empty here), never the integration's own label. */
        id: channelKey({ integrationId: r.id, marketplace: '' }),
        name: r.name,
        marketplace: r.marketplace,
        channelType: r.channelType,
        salesChannelId: r.targetSalesChannelId ?? null,
        countryIso: sc?.nativeCountry?.isoCode ?? this.marketplaceIso(r.marketplace),
        currency: sc?.nativeCurrency ?? null,
        color: sc?.chipBgColor || PALETTE[colorIdx++ % PALETTE.length],
        listingCount: a?._count._all ?? 0,
        lastPulledAt: a?._max.lastPulledAt ?? null,
      });
    }
    return out;
  }

  /** Best-effort 2-letter flag ISO from an Amazon marketplace label (e.g. "Amazon.co.uk", "US", "DE"). */
  private marketplaceIso(marketplace: string | null): string | null {
    if (!marketplace) return null;
    const m = marketplace.toLowerCase();
    const map: Record<string, string> = {
      'co.uk': 'GB', uk: 'GB', com: 'US', us: 'US', ca: 'CA', 'com.mx': 'MX', mx: 'MX',
      'com.br': 'BR', br: 'BR', de: 'DE', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', se: 'SE',
      pl: 'PL', 'com.be': 'BE', be: 'BE', 'com.tr': 'TR', tr: 'TR', ae: 'AE', sa: 'SA',
      'com.au': 'AU', au: 'AU', 'co.jp': 'JP', jp: 'JP', in: 'IN', sg: 'SG', eg: 'EG',
    };
    for (const [k, v] of Object.entries(map)) if (m.endsWith(k) || m === k) return v;
    // Fallback: a bare 2-letter code
    const two = m.replace(/[^a-z]/g, '');
    return two.length === 2 ? two.toUpperCase() : null;
  }

  /**
   * After a COMPLETE account pull, settle every plan on that channel that was waiting.
   *
   * The listings for this integration have just been replaced wholesale from an answer we trust,
   * so a product with no row is genuinely not on this channel. Anything still sitting at SUBMITTED
   * therefore never became a listing, and the button should come back.
   *
   * Deliberately not called for an update-only or refused pull, where absence proves nothing.
   */
  private async settlePlansAfterCompletePull(integrationId: string) {
    const waiting = await this.prisma.productChannelPlan.findMany({
      where: { integrationId, status: 'SUBMITTED', deletedAt: null },
      select: { id: true, productId: true },
    });
    if (!waiting.length) return;

    // Keyed by product so a confirmed plan can carry the channel's own id, exactly as the
    // per-product path does — a plan marked LISTED without one is a confirmation missing its proof.
    const asinByProduct = new Map(
      (await this.prisma.channelListing.findMany({
        where: { integrationId, productId: { in: waiting.map((w) => w.productId) } },
        select: { productId: true, asin: true },
      })).map((r) => [r.productId as string, r.asin]),
    );

    for (const w of waiting) {
      await this.settleSubmittedPlan({
        productId: w.productId,
        integrationId,
        found: asinByProduct.has(w.productId),
        externalListingId: asinByProduct.get(w.productId) ?? null,
      });
    }
  }

  /**
   * Settle a plan that was submitted to a channel, now that a sync has looked.
   *
   * Submitting is not listing. Amazon accepts an offer and publishes it minutes later, so the plan
   * sits at SUBMITTED in between and the UI stops offering to list it again. Something has to end
   * that wait, and only a sync can: it is the one thing that has actually asked the channel.
   *
   *  - Found   -> the channel confirms it. The plan is LISTED, carrying the id the channel gave.
   *  - Missing -> the submission did not become a listing. The plan is released back to DRAFT so
   *               the button returns and a person can try again.
   *
   * Only ever called where absence is EVIDENCE — in both senses. A pull that came back short says
   * nothing about what it did not return, and neither does a pull made before Amazon has published.
   * The first is the caller's responsibility; the second is planTransition's, from listedAt.
   */
  private async settleSubmittedPlan(args: {
    productId: string;
    integrationId: string;
    found: boolean;
    externalListingId?: string | null;
  }) {
    const plan = await this.prisma.productChannelPlan.findFirst({
      where: { productId: args.productId, integrationId: args.integrationId, deletedAt: null },
      select: { id: true, status: true, listedAt: true },
    });
    if (!plan) return;

    // listedAt goes in because absence is only evidence once Amazon has had time to publish. A sync
    // run a minute after listing is asking about an offer Amazon has accepted and not yet made
    // visible; "not yet" must not be read as "never".
    const move = planTransition({ status: plan.status, found: args.found, listedAt: plan.listedAt });
    if (move === 'none') return;

    if (move === 'confirm') {
      await this.prisma.productChannelPlan.update({
        where: { id: plan.id },
        data: { status: 'LISTED', ...(args.externalListingId ? { externalListingId: args.externalListingId } : {}) },
      });
      return;
    }

    // release: the wait is over and it did not become a listing.
    await this.prisma.productChannelPlan.update({
      where: { id: plan.id },
      data: { status: 'DRAFT', listedAt: null },
    });
  }

  /**
   * Where is THIS product listed on Amazon, right now?
   *
   * The account-wide sync answers the same question for everything at once, which is minutes of
   * paging over thousands of listings when someone only wants to know about one product. This asks
   * Amazon about the product's own SKUs instead - one call per marketplace - and reconciles just
   * that product's records.
   *
   * Two things make the narrow query the more trustworthy of the two:
   *
   *  - Nothing is enumerated, so the 1,000-item paging ceiling cannot apply. A SKU missing from
   *    the reply is genuinely not listed on that marketplace.
   *  - Because absence is meaningful here, a stale record CAN be removed - which the account-wide
   *    sync may not do when its own pull came back short.
   *
   * A marketplace that errors is left exactly as it was. "We could not ask" and "it is not there"
   * are different answers, and only one of them justifies deleting a record.
   */
  async syncProduct(
    productId: string,
    companyIds?: string[],
    progress?: ProgressSink,
    opts: { allChannels?: boolean } = {},
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, ...ACTIVE },
      select: { id: true, mainSku: true, aliases: { where: ACTIVE, select: { skuValue: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Every SKU this product could be listed under. The account-wide sync matches pulled listings
    // to products by exactly this set, so asking by it gives the narrow query the same reach.
    //
    // SKUs we already hold a record under are asked about too. Without them, a record whose SKU is
    // no longer one of the product's own would never appear in Amazon's reply and would be deleted
    // as stale without anyone ever checking whether the listing is still there.
    const held = await this.prisma.channelListing.findMany({
      where: { productId: product.id, integration: { channelType: 'amazon' } },
      select: { channelSku: true },
    });
    const skus = [...new Set(
      [product.mainSku, ...product.aliases.map((a) => a.skuValue), ...held.map((h) => h.channelSku)]
        .map((v) => (v ?? '').trim())
        .filter(Boolean),
    )];

    const ints = await this.prisma.channelIntegration.findMany({
      where: {
        ...ACTIVE,
        status: 'active',
        channelType: 'amazon',
        ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
        ...(await fullScopeIntegrationWhere(this.prisma)),
      },
      select: { id: true, name: true, marketplace: true, targetCompanyId: true },
      orderBy: { name: 'asc' },
    });
    // eBay and OnBuy are asked too when every channel is, so the bar counts them.
    const ebayCount = opts.allChannels
      ? await this.prisma.channelIntegration.count({
          where: { ...ACTIVE, status: 'active', channelType: { in: ['ebay', 'onbuy'] }, ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}) },
        })
      : 0;
    progress?.setTotal(ints.length + ebayCount);

    const now = new Date();
    const results: Array<{ integrationId: string; name: string; marketplace: string | null; ok: boolean; listed: boolean; status?: string | null; message?: string }> = [];
    /** Channels we could not answer for per product, said plainly rather than left blank. */
    const skipped: string[] = [];
    let listedCount = 0;
    let removed = 0;

    for (const intg of ints) {
      progress?.note(intg.marketplace ?? intg.name);
      const res = await this.integrations.fetchAmazonListingsBySku(intg.id, skus);

      if (!res.ok) {
        // Left untouched on purpose - see the note above about absence versus ignorance.
        results.push({ integrationId: intg.id, name: intg.name, marketplace: intg.marketplace, ok: false, listed: false, message: res.message });
        progress?.tick(false);
        continue;
      }

      const found = res.rows.filter((r) => skus.some((s) => s.toLowerCase() === (r.sku ?? '').toLowerCase()));
      for (const l of found) {
        await this.prisma.channelListing.upsert({
          where: { integrationId_channelSku_marketplace: { integrationId: intg.id, channelSku: l.sku, marketplace: '' } },
          create: {
            integrationId: intg.id, companyId: intg.targetCompanyId, channelSku: l.sku, marketplace: '',
            productId: product.id, asin: l.asin, externalListingId: l.externalId ?? null, title: l.title,
            listedQuantity: l.quantity, listedPrice: l.price, currency: l.currency,
            fulfilmentChannel: l.fulfilmentChannel, listingStatus: l.status, lastPulledAt: now,
          },
          update: {
            productId: product.id, asin: l.asin, externalListingId: l.externalId ?? null, title: l.title,
            listedQuantity: l.quantity, listedPrice: l.price, currency: l.currency,
            fulfilmentChannel: l.fulfilmentChannel, listingStatus: l.status, lastPulledAt: now,
          },
        });
        await this.notePulledPrice(intg, l, product.id, intg.marketplace ?? '');
      }

      // Records for SKUs Amazon did not return are stale: the listing was deleted or moved. Scoped
      // to this product and this marketplace, so nothing else can be caught by it.
      const foundSkus = found.map((f) => f.sku);
      const stale = await this.prisma.channelListing.deleteMany({
        where: { integrationId: intg.id, productId: product.id, ...(foundSkus.length ? { channelSku: { notIn: foundSkus } } : {}) },
      });
      removed += stale.count;

      // The narrow query asked about this product by name, so its answer settles the plan either
      // way - this is exactly the evidence the wait was for.
      await this.settleSubmittedPlan({
        productId: product.id,
        integrationId: intg.id,
        found: found.length > 0,
        externalListingId: found[0]?.asin ?? null,
      });

      if (found.length) listedCount++;
      results.push({
        integrationId: intg.id, name: intg.name, marketplace: intg.marketplace,
        ok: true, listed: found.length > 0, status: found[0]?.status ?? null,
      });
      progress?.tick(true);
    }

    // ---- eBay ------------------------------------------------------------------------------
    //
    // Upsert only, never delete. The account pull merges the Inventory API with the Trading API
    // because classic listings are invisible to the first; a per-SKU lookup can only ask the
    // Inventory API and so inherits that blind spot. Absence there is not evidence of absence on
    // eBay, and acting on it is what deleted 4,709 records on 29 Aug 2026.
    if (opts.allChannels) {
      const ebayInts = await this.prisma.channelIntegration.findMany({
        where: {
          ...ACTIVE,
          status: 'active',
          channelType: 'ebay',
          ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
        },
        select: { id: true, name: true, targetCompanyId: true },
        orderBy: { name: 'asc' },
      });

      for (const intg of ebayInts) {
        progress?.note(intg.name);
        /**
         * eBay is also asked under the SKU's punctuation-free form, and any SKU our eBay plan holds.
         *
         * Listings made before SKUs kept their punctuation live on eBay as "LE83306", and publishing
         * adopts such a listing rather than making a second one — so the product's own SKUs alone
         * never found it, and a product live on eBay UK stayed "not listed" here.
         */
        const ebayPlanSkus = await this.prisma.productChannelPlan.findMany({
          where: { productId: product.id, integrationId: intg.id, deletedAt: null, channelSku: { not: null } },
          select: { channelSku: true },
        });
        const stripped = (product.mainSku ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);
        const ebaySkus = [...new Set([...skus, stripped, ...ebayPlanSkus.map((pl) => pl.channelSku ?? '')].map((v) => v.trim()).filter(Boolean))];
        const res = await this.integrations.fetchEbayListingsBySku(intg.id, ebaySkus);
        if (!res.ok) {
          results.push({ integrationId: intg.id, name: intg.name, marketplace: null, ok: false, listed: false, message: res.message });
          progress?.tick(false);
          continue;
        }
        for (const l of res.rows) {
          const marketplace = (l.marketplace ?? '').toString();
          await this.prisma.channelListing.upsert({
            where: { integrationId_channelSku_marketplace: { integrationId: intg.id, channelSku: l.sku, marketplace } },
            create: {
              integrationId: intg.id, companyId: intg.targetCompanyId, channelSku: l.sku, marketplace,
              productId: product.id, asin: null, externalListingId: l.externalId ?? null, title: l.title,
              listedQuantity: l.quantity, listedPrice: l.price, currency: l.currency,
              fulfilmentChannel: null, listingStatus: l.status, lastPulledAt: now,
            },
            update: {
              productId: product.id, externalListingId: l.externalId ?? null, title: l.title,
              listedQuantity: l.quantity, listedPrice: l.price, currency: l.currency,
              listingStatus: l.status, lastPulledAt: now,
            },
          });
        }
        if (res.rows.length) listedCount++;
        else {
          // Nothing came back, which on eBay does NOT mean nothing is there: classic listings are
          // invisible to the Inventory API. Reporting a bare "not listed" would contradict the
          // eBay rows already on the page and teach people to distrust the count.
          skipped.push(`${intg.name}: no Inventory-API listing found (classic listings are not visible per product)`);
        }
        results.push({
          integrationId: intg.id, name: intg.name, marketplace: null,
          ok: true, listed: res.rows.length > 0, status: res.rows[0]?.status ?? null,
        });
        progress?.tick(true);
      }

      /**
       * OnBuy, by SKU. Its listings call takes filter[sku] — this used to say OnBuy had no per-product
       * lookup, which left a product listed on OnBuy from here showing "not listed" until the next
       * account-wide sync.
       */
      const onbuyInts = await this.prisma.channelIntegration.findMany({
        where: { ...ACTIVE, status: 'active', channelType: 'onbuy', ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}) },
        select: { id: true, name: true, targetCompanyId: true },
      });
      for (const intg of onbuyInts) {
        progress?.note(intg.name);
        const res = await this.integrations.onbuyListingsBySku(intg.id, skus).catch((e: any) => ({ ok: false, status: 0, json: { message: e?.message } }) as any);
        if (!res.ok) {
          results.push({ integrationId: intg.id, name: intg.name, marketplace: null, ok: false, listed: false, message: `OnBuy ${res.status || ''} ${res.json?.message ?? ''}`.trim() });
          progress?.tick(false);
          continue;
        }
        const found: any[] = (Array.isArray(res.json?.results) ? res.json.results : []).filter((l: any) => skus.includes(String(l?.sku ?? '')));
        for (const l of found) {
          const data = {
            productId: product.id, externalListingId: l.opc ? String(l.opc) : null, title: l.name ?? null,
            listedQuantity: l.stock != null ? Number(l.stock) : null, listedPrice: l.price != null ? Number(l.price) : null,
            currency: 'GBP', listingStatus: l.condition ?? null, lastPulledAt: now,
          };
          await this.prisma.channelListing.upsert({
            where: { integrationId_channelSku_marketplace: { integrationId: intg.id, channelSku: String(l.sku), marketplace: '' } },
            create: { integrationId: intg.id, companyId: intg.targetCompanyId, channelSku: String(l.sku), marketplace: '', asin: null, fulfilmentChannel: null, ...data },
            update: data,
          });
        }
        if (found.length) listedCount++;
        results.push({ integrationId: intg.id, name: intg.name, marketplace: null, ok: true, listed: found.length > 0, status: null });
        progress?.tick(true);
      }
    }

    return {
      productId: product.id,
      mainSku: product.mainSku,
      checked: results.length,
      listed: listedCount,
      removed,
      failed: results.filter((r) => !r.ok).length,
      skipped,
      results,
    };
  }

  /** Pull listings from the given (or all active Amazon) channels into ChannelListing. */
  // Channel types we can pull listings from today.
  private static readonly LISTING_CHANNELS = ['amazon', 'ebay', 'onbuy', 'jinius'];

  async sync(integrationIds?: string[], companyIds?: string[], progress?: ProgressSink) {
    // "Sync all" (no explicit ids) syncs every channel type with a listings connector.
    // A selective sync may target any connected channel; types without a listings connector
    // yet are reported, not silently dropped.
    // The dashboard identifies an eBay column as `${integrationId}:${marketplace}`, because one eBay
    // connection spans many marketplaces and each gets its own column. Those ids reach here when the
    // operator syncs selected channels, and Prisma rejected them against a uuid column with a parse
    // error rather than anything an operator could act on.
    //
    // The integration is the unit that can actually be synced — eBay's pull is account-wide and
    // returns every marketplace at once — so the marketplace suffix is dropped and the ids deduped.
    const ids = [...new Set((integrationIds ?? []).map((id) => id.split(':')[0]).filter(Boolean))];
    const selective = ids.length > 0;
    const where: Prisma.ChannelIntegrationWhereInput = {
      ...ACTIVE, status: 'active',
      ...(selective ? { id: { in: ids } } : { channelType: { in: ChannelListingsService.LISTING_CHANNELS } }),
      ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
    };
    const ints = await this.prisma.channelIntegration.findMany({ where, select: { id: true, name: true, channelType: true, targetCompanyId: true } });
    progress?.setTotal(ints.length);
    /**
     * The same two indexes `relinkListings` uses, because this sync REPLACES the rows it rebuilds.
     *
     * Linking here was exact-only while the relink pass matched punctuation as well, so every sync
     * quietly undid the pass: a row relink had claimed came back owned by nobody, and stayed that
     * way until someone ran relink again. `BE-BF600 WHITE` was unlinked on Jinius for exactly that
     * reason. Exact still wins and an ambiguous key still links to nothing — this is the identical
     * rule, applied where the rows are written rather than only after the fact.
     */
    const catalogue = await this.prisma.product.findMany({
      where: ACTIVE,
      select: { id: true, mainSku: true, aliases: { where: ACTIVE, select: { skuValue: true } } },
    });
    const ownerIndex = buildSkuOwnerIndex(catalogue);
    const looseIndex = buildLooseSkuIndex(catalogue);
    const now = new Date();
    const results: Array<{ integrationId: string; name: string; ok: boolean; pulled?: number; message?: string }> = [];
    for (const intg of ints) {
      progress?.note(intg.name);
      try {
        // Amazon reports whether its answer was complete; the others cannot, so they are assumed
        // complete and rely on the proportional guard below.
        const pull =
          intg.channelType === 'amazon' ? await this.integrations.fetchAmazonListings(intg.id)
          : intg.channelType === 'ebay' ? { rows: await this.integrations.fetchEbayListings(intg.id), reportedTotal: null, complete: true }
          : intg.channelType === 'onbuy' ? { rows: await this.integrations.fetchOnBuyListings(intg.id), reportedTotal: null, complete: true }
          // Mirakl answers with its own total, so the guard below compares like with like.
          : intg.channelType === 'jinius' ? { ...(await this.integrations.fetchJiniusListings(intg.id)), complete: true }
          : null;
        const listings = pull?.rows ?? null;
        if (!listings || !pull) {
          results.push({ integrationId: intg.id, name: intg.name, ok: false, message: `Listings sync for ${intg.channelType} isn't available yet` });
          continue;
        }
        // Build rows in memory, then REPLACE this integration's listings in bulk. Row-by-row
        // upserts don't scale to thousands of eBay listings (they time out mid-sync); a delete +
        // chunked createMany is a handful of queries. Since we pull the full set each time, a
        // full replace also drops delisted items and the old single-column ('') eBay rows.
        // eBay keys by marketplace (per-market columns); single-market channels use ''.
        const seen = new Set<string>();
        const data = [] as Prisma.ChannelListingCreateManyInput[];
        for (const l of listings) {
          if (!l.sku) continue;
          const marketplace = (l.marketplace ?? '').toString();
          const key = `${l.sku}|${marketplace}`;
          if (seen.has(key)) continue; // one row per (sku, marketplace) — avoids unique clashes
          seen.add(key);
          data.push({
            integrationId: intg.id, companyId: intg.targetCompanyId, channelSku: l.sku, marketplace,
            productId: matchSku(l.sku, ownerIndex, looseIndex).owner?.productId ?? null,
            asin: l.asin, externalListingId: l.externalId ?? null, title: l.title, listedQuantity: l.quantity, listedPrice: l.price,
            currency: l.currency, fulfilmentChannel: l.fulfilmentChannel, listingStatus: l.status, lastPulledAt: now,
          });
        }
        // A pull that collapses is not evidence the listings are gone.
        //
        // The sync replaces a channel's rows wholesale, which is right when the pull is complete and
        // catastrophic when it is not. On 29 Aug eBay's Inventory API returned one SKU where we held
        // 4,710, a partial answer was taken as the whole truth, and 4,709 listing records were
        // deleted. Marketplaces go quiet for their own reasons — a scope change, a partial outage, a
        // call that only ever saw a subset — and none of them mean the seller has stopped selling.
        //
        // So a replace that would remove most of what we hold refuses and leaves the records alone.
        // Going stale is recoverable by running it again; deleting is not.
        const held = await this.prisma.channelListing.count({ where: { integrationId: intg.id } });

        const decision = syncDecision({ received: data.length, reportedTotal: pull.reportedTotal, held });

        if (decision.mode === 'refuse') {
          results.push({
            integrationId: intg.id, name: intg.name, ok: false, pulled: data.length,
            message: `Refused: the pull returned ${data.length} listing(s) against ${held} on record. `
              + 'Nothing was changed — check the channel, then re-run.',
          });
          progress?.tick(false);
          continue;
        }

        if (decision.mode === 'update-only') {
          // Write what arrived, remove nothing. The rows we could not reach are still live on the
          // channel, and a record we keep is merely stale where a record we delete is a listing
          // the platform believes does not exist.
          for (let i = 0; i < data.length; i += 500) {
            await this.prisma.$transaction(
              data.slice(i, i + 500).map((d) =>
                this.prisma.channelListing.upsert({
                  where: { integrationId_channelSku_marketplace: { integrationId: d.integrationId, channelSku: d.channelSku, marketplace: d.marketplace ?? '' } },
                  create: d,
                  update: {
                    productId: d.productId, asin: d.asin, externalListingId: d.externalListingId, title: d.title,
                    listedQuantity: d.listedQuantity, listedPrice: d.listedPrice, currency: d.currency,
                    fulfilmentChannel: d.fulfilmentChannel, listingStatus: d.listingStatus, lastPulledAt: d.lastPulledAt,
                  },
                }),
              ),
            );
          }
          results.push({
            integrationId: intg.id, name: intg.name, ok: true, pulled: data.length,
            message: `${intg.name} reports ${pull.reportedTotal} listing(s) but would only return ${data.length}. `
              + `Those were updated and nothing was deleted, so the other ${decision.shortBy} are kept rather than lost.`,
          });
          progress?.tick(true);
          continue;
        }

        const ops: Prisma.PrismaPromise<unknown>[] = [this.prisma.channelListing.deleteMany({ where: { integrationId: intg.id } })];
        for (let i = 0; i < data.length; i += 1000) ops.push(this.prisma.channelListing.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true }));
        await this.prisma.$transaction(ops);

        // A complete pull is the only kind that can settle a submission, for the same reason it is
        // the only kind allowed to delete: absence in a truncated answer is not absence.
        await this.settlePlansAfterCompletePull(intg.id);

        results.push({ integrationId: intg.id, name: intg.name, ok: true, pulled: data.length });
        progress?.tick(true);
      } catch (e: any) {
        results.push({ integrationId: intg.id, name: intg.name, ok: false, message: (e?.message ?? 'failed').toString().slice(0, 160) });
        progress?.tick(false);
      }
    }
    return { channels: results, total: results.reduce((s, r) => s + (r.pulled ?? 0), 0) };
  }

  /** Push each product's Availability quantity to its channel listings (Amazon FBM/MFN + OnBuy;
   *  eBay later). `dryRun` validates without applying — Amazon uses VALIDATION_PREVIEW, a real
   *  call that confirms the write would succeed. A real run updates listedQuantity and writes a
   *  ChannelPush audit row per listing. Excludes Amazon FBA (Amazon owns that quantity). */
  /**
   * `allowIncrease` is the red line: a quantity may only be RAISED on a marketplace by a person
   * pressing Push to channels. Every automatic path leaves it false, so sell-through can lower a
   * figure but nothing can silently offer more.
   *
   * The asymmetry is deliberate. Pushing a number down too eagerly costs a sale; pushing one up
   * wrongly sells goods that do not exist, and a cancellation restoring units is exactly the case
   * that would otherwise do it automatically. The guard sits here rather than at the callers so a
   * future one cannot forget it.
   */
  async pushAvailability(
    productIds: string[],
    opts: { dryRun?: boolean; channelKeys?: string[]; allowIncrease?: boolean } = {},
    companyIds?: string[],
    actorId?: string,
  ) {
    const dryRun = opts.dryRun ?? false;
    const allowIncrease = opts.allowIncrease === true;
    // Optional channel restriction: keys are the dashboard column ids — `${integrationId}:${marketplace}`
    // for a per-marketplace (eBay) column, or the bare integrationId otherwise. Empty/undefined = all.
    const channelKeys = opts.channelKeys && opts.channelKeys.length ? new Set(opts.channelKeys) : null;
    if (!productIds.length) return { dryRun, count: 0, ok: 0, failed: 0, results: [] as any[] };
    const avails = await this.prisma.productAvailability.findMany({ where: { productId: { in: productIds } }, select: { productId: true, quantity: true } });
    const qtyByProduct = new Map(avails.map((a) => [a.productId, a.quantity]));
    const listings = await this.prisma.channelListing.findMany({
      where: {
        productId: { in: productIds },
        ...(companyIds ? { companyId: { in: companyIds } } : {}),
        // Amazon controls FBA quantity — never push it. Keep NULLs (eBay/OnBuy listings have no
        // fulfilmentChannel): both `NOT:{...}` and `{not:'FBA'}` drop NULLs in SQL, so be explicit.
        OR: [{ fulfilmentChannel: null }, { fulfilmentChannel: { not: 'FBA' } }],
      },
      select: { id: true, productId: true, integrationId: true, channelSku: true, externalListingId: true, marketplace: true, listedQuantity: true, companyId: true, integration: { select: { channelType: true, name: true, marketplace: true } } },
    });
    const channelKeyOf = (l: { integrationId: string; marketplace: string | null }) => (l.marketplace ? `${l.integrationId}:${l.marketplace}` : l.integrationId);
    // Marketplace country ISO for the client's group tree. eBay listings carry it per-market;
    // Amazon/OnBuy carry the region on the integration (connector id → ISO: UK→GB, AUS→AU).
    const ISO_ALIAS: Record<string, string> = { UK: 'GB', AUS: 'AU', UAE: 'AE' };
    const isoOf = (l: { marketplace: string | null; integration: { marketplace: string | null } }) => {
      const raw = (l.marketplace || l.integration.marketplace || '').toUpperCase();
      return ISO_ALIAS[raw] ?? raw;
    };
    // --- Two gates before anything leaves the building ------------------------------------------
    const settings = await this.prisma.platformSettings.findFirst({
      select: { channelQuantityPushEnabled: true, maxZeroingPushesPerRun: true },
    });
    if (!dryRun && settings?.channelQuantityPushEnabled === false) {
      return { dryRun, count: 0, ok: 0, failed: 0, skipped: 0, blocked: 'Quantity pushes are switched off in Settings.', results: [] as any[] };
    }

    // Blast radius. Work out what this run would take from a REAL quantity down to zero, and refuse
    // the whole run if it is more of the catalogue than the ceiling allows.
    //
    // Listings went out of stock across the catalogue and nothing stopped it or even remarked on
    // it. A push that empties shelves is never routine, whatever the reason — an empty availability
    // table, a bad filter, a default that reads as data. Refusing and showing the number is the only
    // response that cannot be missed.
    //
    // The ceiling counts PRODUCTS. It counted listings, and that unit refused a run for seven days
    // because two sold-out products were listed across forty-five marketplaces between them — while
    // those two stayed on sale advertising units nobody had. The rule, and the second ceiling that
    // still watches the listing count for a different fault, are in zeroing-guard.ts.
    //
    // Deliberately BEFORE the loop: a guard that trips halfway has already done the damage it
    // exists to prevent.
    const ceiling = settings?.maxZeroingPushesPerRun ?? 25;
    const candidates = listings.filter((l) => {
      if (l.integration.channelType === 'ebay' && !l.marketplace) return false;
      if (channelKeys && !channelKeys.has(channelKeyOf(l))) return false;
      if (l.productId == null || !qtyByProduct.has(l.productId)) return false; // skipped anyway
      return qtyByProduct.get(l.productId) === 0 && (l.listedQuantity ?? 0) > 0;
    }).map((l) => ({ productId: l.productId as string }));
    const verdict = zeroingVerdict(candidates, ceiling);
    if (!dryRun && !verdict.ok) {
      this.logger.error(
        'Push REFUSED: it would zero ' + verdict.products + ' products (' + verdict.listings
        + ' listings) that currently hold stock (ceiling ' + ceiling + ' products).',
      );
      return {
        dryRun,
        count: 0,
        ok: 0,
        failed: 0,
        skipped: 0,
        blocked: verdict.reason,
        wouldZeroProducts: verdict.products,
        wouldZeroReal: verdict.listings,
        results: [] as any[],
      };
    }

    /**
     * OnBuy listings held at stock 0 for a price check. They exist on OnBuy only so its Check Winning
     * can name the price to beat; sending them stock would put them on sale at a provisional price
     * nobody chose. They go live from the product's OnBuy step, never from a push.
     */
    const heldOnbuy = new Set(
      (await this.prisma.productChannelPlan.findMany({
        where: { deletedAt: null, status: { not: 'LISTED' }, channelSku: { not: null }, integration: { channelType: 'onbuy' } },
        select: { integrationId: true, channelSku: true, aspects: true },
      }))
        .filter((p) => !!((p.aspects as Record<string, unknown> | null) ?? {}).onbuyStaged)
        .map((p) => `${p.integrationId}|${p.channelSku}`),
    );

    const results: any[] = [];
    for (const l of listings) {
      if (l.integration.channelType === 'onbuy' && heldOnbuy.has(`${l.integrationId}|${l.channelSku}`)) {
        results.push({
          productId: l.productId, channelKey: channelKeyOf(l), channel: l.integration.name, channelType: l.integration.channelType,
          marketplace: l.marketplace, countryIso: isoOf(l), channelSku: l.channelSku,
          currentQty: l.listedQuantity, targetQty: null, ok: false, skipped: true,
          message: 'Held at stock 0 for an OnBuy price check — list it from the product’s OnBuy step',
        });
        continue;
      }
      // An eBay listing whose marketplace couldn't be resolved maps to no real sales channel — skip
      // it rather than surface a generic "eBay" push target. A re-sync resolves most (by currency /
      // item URL) into their proper per-market channel.
      if (l.integration.channelType === 'ebay' && !l.marketplace) continue;
      const channelKey = channelKeyOf(l);
      if (channelKeys && !channelKeys.has(channelKey)) continue; // caller chose specific channels
      // "We have no availability record" is not "we have none in stock". It is "we do not know",
      // and the honest answer to not knowing is to leave the channel alone.
      //
      // This defaulted to 0, so any product without an Availability row pushed ZERO to every
      // channel it was listed on. It stayed invisible for as long as the eBay token was read-only
      // and the pushes failed on auth; the morning write scope was enabled, ~1,900 matched eBay
      // listings went out of stock, and every later order sync pushed them back to zero again.
      //
      // A row that genuinely says 0 still pushes 0 — out of stock is a real state worth sending.
      const known = l.productId != null && qtyByProduct.has(l.productId);
      if (!known) {
        results.push({
          productId: l.productId, channelKey, channel: l.integration.name, channelType: l.integration.channelType,
          marketplace: l.marketplace, countryIso: isoOf(l), channelSku: l.channelSku,
          currentQty: l.listedQuantity, targetQty: null, ok: false, skipped: true,
          message: 'No availability record for this product — nothing pushed',
        });
        continue;
      }
      const target = qtyByProduct.get(l.productId as string) as number;
      // Raising a live quantity is a person's decision. An automatic run may lower a figure or
      // leave it alone; anything that would offer more waits for a deliberate push.
      if (!allowIncrease && l.listedQuantity != null && target > l.listedQuantity) {
        results.push({
          productId: l.productId, channelKey, channel: l.integration.name, channelType: l.integration.channelType,
          marketplace: l.marketplace, countryIso: isoOf(l), channelSku: l.channelSku,
          currentQty: l.listedQuantity, targetQty: target, ok: false, skipped: true,
          message: `Would raise ${l.listedQuantity} → ${target}. Increases are only sent from Push to channels.`,
        });
        continue;
      }
      const r =
        l.integration.channelType === 'amazon' ? await this.integrations.pushAmazonQuantity(l.integrationId, l.channelSku, target, dryRun)
        : l.integration.channelType === 'onbuy' ? await this.integrations.pushOnBuyQuantity(l.integrationId, l.channelSku, target, dryRun)
        : l.integration.channelType === 'ebay' ? await this.integrations.pushEbayQuantity(l.integrationId, l.channelSku, l.marketplace, target, dryRun, l.externalListingId)
        // Jinius takes the shop's own SKU, which is what its offers are keyed on here too.
        : l.integration.channelType === 'jinius' ? await this.integrations.pushJiniusQuantity(l.integrationId, l.channelSku, target, dryRun)
        : { ok: false, message: `Push for ${l.integration.channelType} not available yet` };
      if (!dryRun) {
        if (r.ok) await this.prisma.channelListing.update({ where: { id: l.id }, data: { listedQuantity: target, lastPushedAt: new Date() } });
        await this.prisma.channelPush.create({ data: { companyId: l.companyId, integrationId: l.integrationId, productId: l.productId, channelSku: l.channelSku, marketplace: l.marketplace, field: 'quantity', requestedValue: target, previousValue: l.listedQuantity, ok: r.ok, message: r.message.slice(0, 300), dryRun: false, createdById: actorId ?? null } });
      }
      results.push({ productId: l.productId, channelKey, channel: l.integration.name, channelType: l.integration.channelType, marketplace: l.marketplace, countryIso: isoOf(l), channelSku: l.channelSku, currentQty: l.listedQuantity, targetQty: target, ok: r.ok, message: r.message });
    }
    const skipped = results.filter((x) => x.skipped).length;
    return {
      dryRun,
      count: results.length,
      ok: results.filter((x) => x.ok).length,
      // A skip is not a failed push — nothing was sent. Counted apart so "0 failed" cannot be read
      // as "everything was updated".
      failed: results.filter((x) => !x.ok && !x.skipped).length,
      skipped,
      results,
    };
  }

  /**
   * What we have actually sent to a channel, newest first.
   *
   * Every push writes one of these rows with the value requested and the value it replaced, so a
   * question like "did we zero the eBay catalogue, and when did it start" is answerable from the
   * record instead of inferred from behaviour. Read-only, and it existed all along with nothing
   * exposing it.
   */
  async pushHistory(
    opts: { channelType?: string; field?: string; limit?: number; since?: string; before?: string; offset?: number } = {},
    companyIds?: string[],
  ) {
    // Resolve the channel type to integration ids and filter IN the query.
    //
    // This used to take the newest N rows and filter afterwards, which quietly lies whenever one
    // channel is noisy: a day of eBay restores filled the newest 500 rows, so asking for Amazon
    // pushes returned zero and read as "we never pushed to Amazon" when it meant "you cannot see
    // that far back". An empty answer must mean empty.
    const typeIds = opts.channelType
      ? (await this.prisma.channelIntegration.findMany({ where: { channelType: opts.channelType }, select: { id: true } })).map((i) => i.id)
      : null;

    const rows = await this.prisma.channelPush.findMany({
      where: {
        ...(companyIds ? { companyId: { in: companyIds } } : {}),
        ...(opts.field ? { field: opts.field } : {}),
        // A window rather than only a floor. Newest-first with a cap answers "what happened lately"
        // and cannot answer "how far back does this go" — the question that actually matters when
        // you are trying to date the start of something.
        ...(opts.since || opts.before
          ? { createdAt: { ...(opts.since ? { gte: new Date(opts.since) } : {}), ...(opts.before ? { lt: new Date(opts.before) } : {}) } }
          : {}),
        ...(typeIds ? { integrationId: { in: typeIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: Math.max(0, opts.offset ?? 0),
      take: Math.min(opts.limit ?? 100, 500),
      select: {
        id: true, createdAt: true, integrationId: true, channelSku: true, marketplace: true,
        field: true, requestedValue: true, previousValue: true, ok: true, message: true, dryRun: true,
      },
    });
    const ints = await this.prisma.channelIntegration.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.integrationId))] } },
      select: { id: true, name: true, channelType: true },
    });
    const byId = new Map(ints.map((i) => [i.id, i]));
    const withChannel = rows.map((r) => ({ ...r, channel: byId.get(r.integrationId)?.name ?? null, channelType: byId.get(r.integrationId)?.channelType ?? null }));
    const filtered = withChannel; // the channel type is now part of the query, not an afterthought

    // The total the FILTERS match, independent of the page. Without it a full page is
    // indistinguishable from the last page, which is how "0 Amazon pushes" got read as "we never
    // pushed to Amazon" when it meant "you cannot see that far back".
    const matching = await this.prisma.channelPush.count({
      where: {
        ...(companyIds ? { companyId: { in: companyIds } } : {}),
        ...(opts.field ? { field: opts.field } : {}),
        ...(opts.since || opts.before
          ? { createdAt: { ...(opts.since ? { gte: new Date(opts.since) } : {}), ...(opts.before ? { lt: new Date(opts.before) } : {}) } }
          : {}),
        ...(typeIds ? { integrationId: { in: typeIds } } : {}),
      },
    });
    const offset = Math.max(0, opts.offset ?? 0);

    return {
      count: filtered.length,
      matching,
      offset,
      hasMore: offset + filtered.length < matching,
      /** Feed this back as the before parameter to walk further into the past. */
      oldestOnPage: filtered.length ? filtered[filtered.length - 1].createdAt : null,
      // The shape of the damage at a glance: how many asked for zero, and when the run began.
      zeroPushes: filtered.filter((r) => r.requestedValue === 0 && !r.dryRun).length,
      earliest: filtered.length ? filtered[filtered.length - 1].createdAt : null,
      latest: filtered.length ? filtered[0].createdAt : null,
      rows: filtered,
    };
  }

  /*
   * There was a restore tool here. It wrote quantities to live listings from the last pulled figure,
   * the push audit or another marketplace — none of them a person's figure in Availability — and it
   * did so past the kill switch, the zeroing ceiling and the rule against raising quantities
   * automatically. A quantity reaches a channel only when a person presses Push to channels, or when
   * an order lowers availability (availability/order-availability-rules.ts). To put a listing back,
   * set its figure in Availability and push it.
   */

  private readonly logger = new Logger(ChannelListingsService.name);
  private pushTimer: NodeJS.Timeout | null = null;

  /** The debounce. Long enough to coalesce an ingest burst, short enough to feel immediate. */
  private static readonly PUSH_DEBOUNCE_MS = 8_000;

  /**
   * A product that keeps failing stops being retried and starts being a worklist item.
   *
   * Without a ceiling a permanently rejected SKU is retried on every drain for ever, burning rate
   * limit that working products need. The row is KEPT rather than deleted, because a push we owe
   * and cannot make is exactly the thing somebody has to see.
   *
   * The number itself lives in push-queue-recheck.ts, beside the rule that decides when such a row
   * is worth another look, so the limit and the reprieve cannot disagree about where the limit is.
   */

  /**
   * Record that these products owe their channels a quantity, then drain shortly after.
   *
   * The debt is written to `channel_push_queue` BEFORE the timer is armed, and that ordering is the
   * whole point. The queue used to be a `Set` and a `setTimeout`: a restart inside the eight-second
   * window dropped the push and left no trace it had ever been owed - and this deploys on every
   * push to main, so that window gets hit in earnest. Worse, only ATTEMPTS were recorded anywhere,
   * so a schedule that never fired was indistinguishable from one that fired and was refused. The
   * two need different fixes.
   *
   * Still fire-and-forget for the caller: a sale never waits on the network and never fails because
   * a push did. It just can no longer lose the fact that it owes one.
   */
  schedulePush(productIds: string[], reason = 'sell_through') {
    const ids = [...new Set(productIds.filter(Boolean))];
    if (!ids.length) return;

    void this.enqueuePush(ids, reason)
      .then(() => this.armPushTimer())
      .catch((e) => this.logger.error(`Could not record a push debt: ${e?.message ?? e}`));
  }

  private async enqueuePush(productIds: string[], reason: string) {
    await Promise.all(productIds.map((productId) =>
      this.prisma.channelPushQueue.upsert({
        where: { productId },
        create: { productId, reason },
        /**
         * An existing debt is refreshed, not duplicated and not reset.
         *
         * `attempts` is deliberately left alone: a product that has failed four times and sells
         * again is still on its fifth attempt, and zeroing the count here would let a permanently
         * broken SKU retry for ever simply because it keeps selling.
         */
        update: { enqueuedAt: new Date(), reason },
      }),
    ));
  }

  private armPushTimer() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.drainPushQueue();
    }, ChannelListingsService.PUSH_DEBOUNCE_MS);
    this.pushTimer.unref?.();
  }

  /**
   * Pay whatever the queue says we owe.
   *
   * Rows are deleted only on success, so the table holds outstanding work and nothing else -
   * "is anything stuck?" becomes a SELECT rather than a question about production logs.
   */
  async drainPushQueue(): Promise<{ products: number; ok: number; failed: number; stuck: number }> {
    const owed = await this.prisma.channelPushQueue.findMany({
      where: { attempts: { lt: PUSH_MAX_ATTEMPTS } },
      orderBy: { enqueuedAt: 'asc' },
      take: 500,
      select: { id: true, productId: true, attempts: true },
    });

    /**
     * Rows the queue had given up on, brought back for one look a day.
     *
     * The attempt limit was permanent: a row at it was never read again, so an error that had
     * stopped being true stayed the last word for ever and nothing anywhere showed it. Seven rows
     * sat like that for a week holding a refusal that a fix on 15 September had already made
     * obsolete — and two genuine marketplace failures hid among them.
     *
     * The cadence and the cap are in push-queue-recheck.ts, with tests. Rarely, because a product
     * that really is broken must not hammer a marketplace; and capped, because a thousand abandoned
     * rows all coming back at once is its own incident.
     */
    const abandoned = await this.prisma.channelPushQueue.findMany({
      where: {
        attempts: { gte: PUSH_MAX_ATTEMPTS },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: recheckCutoff() } }],
      },
      orderBy: { lastAttemptAt: 'asc' },
      take: RECHECK_LIMIT,
      select: { id: true, productId: true, attempts: true },
    });
    if (abandoned.length) {
      this.logger.log(`Push queue: reconsidering ${abandoned.length} row(s) the attempt limit had abandoned.`);
    }

    const due = [...owed, ...abandoned];
    const stuck = await this.prisma.channelPushQueue.count({
      where: { attempts: { gte: PUSH_MAX_ATTEMPTS } },
    });
    if (!due.length) return { products: 0, ok: 0, failed: 0, stuck };

    let ok = 0;
    let failed = 0;
    try {
      const r = await this.pushAvailability(due.map((d) => d.productId), { dryRun: false });

      /**
       * A blocked run sent nothing, so nothing was paid. It used to fall through with no results,
       * which read as "every product settled" and deleted what each order still owed its channels.
       * The rows stay, untouched but for the reason, so the pushes go out once the block is lifted.
       */
      if ((r as { blocked?: string }).blocked) {
        const why = String((r as { blocked?: string }).blocked).slice(0, 300);
        await this.prisma.channelPushQueue.updateMany({
          where: { id: { in: due.map((d) => d.id) } },
          data: { lastAttemptAt: new Date(), lastError: why },
        });
        this.logger.warn(`Push queue: ${due.length} product(s) still owed — ${why}`);
        return { products: due.length, ok: 0, failed: due.length, stuck };
      }

      // Settled per PRODUCT rather than all-or-nothing; the rule and its reasoning live in
      // push-queue-settle.ts, with tests.
      const { settled, retry } = settlePushQueue(due, (r.results ?? []) as PushResult[]);
      ok = settled.length;
      failed = retry.length;

      if (settled.length) {
        await this.prisma.channelPushQueue.deleteMany({ where: { id: { in: settled.map((d) => d.id) } } });
      }
      for (const { row, why } of retry) {
        await this.prisma.channelPushQueue.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: why.slice(0, 300) },
        });
      }
      this.logger.log(`Push queue: ${r.ok}/${r.count} listing(s) across ${due.length} product(s), ${failed} product(s) still owed${stuck ? `, ${stuck} stuck` : ''}`);
    } catch (e: any) {
      /**
       * The whole drain fell over - a dead connection, a bad token. Nothing is settled, everything
       * keeps its debt, and the attempt is counted so a permanently broken drain cannot spin.
       */
      failed = due.length;
      await this.prisma.channelPushQueue.updateMany({
        where: { id: { in: due.map((d) => d.id) } },
        data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: String(e?.message ?? e).slice(0, 300) },
      });
      this.logger.error(`Push queue drain failed for ${due.length} product(s): ${e?.message ?? e}`);
    }
    return { products: due.length, ok, failed, stuck };
  }

  /**
   * Anything the last process still owed is paid on the way up.
   *
   * This is the restart case the in-memory queue could not survive, and it is not hypothetical:
   * deploying restarts the API, and a sale saved seconds earlier had its push sitting in a timer
   * that never fired. Delayed rather than immediate so a boot storm does not become a marketplace
   * storm.
   */
  onApplicationBootstrap() {
    const t = setTimeout(() => {
      void this.prisma.channelPushQueue
        // Abandoned rows count too: a queue holding nothing else would otherwise never wake, and
        // those are precisely the rows a deploy may have just made payable.
        .count({
          where: {
            OR: [
              { attempts: { lt: PUSH_MAX_ATTEMPTS } },
              { lastAttemptAt: null },
              { lastAttemptAt: { lte: recheckCutoff() } },
            ],
          },
        })
        .then((n) => {
          if (!n) return undefined;
          this.logger.log(`Resuming ${n} channel push(es) owed from before the restart.`);
          return this.drainPushQueue().then(() => undefined);
        })
        .catch((e) => this.logger.error(`Could not resume the push queue: ${e?.message ?? e}`));
    }, 20_000);
    t.unref?.();
  }

  private cellOf(l: any) {
    return {
      integrationId: l.integrationId,
      channelSku: l.channelSku,
      asin: l.asin,
      listed: true,
      price: l.listedPrice,
      currency: l.currency,
      quantity: l.listedQuantity,
      fulfilmentChannel: l.fulfilmentChannel,
      status: this.deriveStatus(l),
    };
  }

  /** Dashboard rows: products that are listed somewhere, each with its per-channel cells. */
  async dashboard(query: ListingsQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 25));
    const q = query.q?.trim();
    // Company isolation: only listings owned by a company the user may see.
    const listingScope: Prisma.ChannelListingWhereInput = {
      ...(query.companyIds ? { companyId: { in: query.companyIds } } : {}),
      ...(query.channelId ? { integrationId: query.channelId } : {}),
    };
    const where: Prisma.ProductWhereInput = {
      ...ACTIVE,
      channelListings: { some: listingScope },
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.productTypeId ? { productTypeId: query.productTypeId } : {}),
      ...(q ? { OR: [{ mainSku: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }, { aliases: { some: { skuValue: { contains: q, mode: 'insensitive' } } } }] } : {}),
    };
    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where, orderBy: { mainSku: 'asc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, mainSku: true, title: true,
          brand: { select: { name: true } },
          availability: { select: { quantity: true } },
          channelListings: { where: query.companyIds ? { companyId: { in: query.companyIds } } : undefined, // lastPulledAt so this screen breaks a tie on the same evidence the detail page has; without
            // it the two could pick different SKUs for one product.
            select: { integrationId: true, marketplace: true, channelSku: true, asin: true, listedPrice: true, currency: true, listedQuantity: true, fulfilmentChannel: true, listingStatus: true, lastPulledAt: true } },
        },
      }),
    ]);
    // A "column" is (integration × marketplace). eBay listings key by both so each marketplace
    // gets its own cell; single-marketplace channels (marketplace '') key by integration alone.
    const colId = (l: any) => (l.marketplace ? `${l.integrationId}:${l.marketplace}` : l.integrationId);
    const rows = products.map((p) => {
      const cells: Record<string, any> = {};
      /**
       * One cell per column, and the LISTING in it — not whichever row the loop happened to write
       * last. A marketplace can return a second SKU with no offer behind it, and assigning blindly
       * let that decide the cell: IT68277 showed no stock on Amazon UK while 19 units sat live.
       */
      for (const [key, l] of pickLiveListingsByKey(p.channelListings, colId)) cells[key] = this.cellOf(l);
      return {
        productId: p.id, sku: p.mainSku, title: p.title, brand: p.brand?.name ?? null,
        masterStock: p.availability?.quantity ?? null,
        listedCount: p.channelListings.length,
        cells,
      };
    });

    // Estimated profit/margin per listed cell, using the same economics as a booked sale.
    const channels = await this.channels(query.companyIds);
    const scByInt = new Map(channels.map((c) => [c.id, c.salesChannelId]));
    const econInputs: Array<{ key: string; productId: string; salesChannelId: string; grossNative: number | null; currency: string | null }> = [];
    for (const row of rows) {
      for (const [integrationId, cell] of Object.entries(row.cells)) {
        const salesChannelId = scByInt.get(integrationId);
        if (!salesChannelId || cell.price == null) continue;
        econInputs.push({ key: `${row.productId}:${integrationId}`, productId: row.productId, salesChannelId, grossNative: cell.price, currency: cell.currency });
      }
    }
    const econ = await this.pricing.listingEconomics(econInputs);
    for (const row of rows) {
      for (const [integrationId, cell] of Object.entries(row.cells)) {
        const e = econ.get(`${row.productId}:${integrationId}`);
        cell.profitEur = e?.profitEur ?? null;
        cell.marginPct = e?.marginPct ?? null;
        cell.loss = e?.loss ?? false;
      }
    }

    /**
     * Where a product is NOT listed but could be.
     *
     * The grid held one word — "Not listed" — for every empty cell, whether that meant a marketplace
     * we could open tomorrow or one Amazon does not stock the product in. We have the answer already:
     * the availability sweep and the manual check both file it, and a page load costs nothing to
     * read it. Leaving the cell blank threw away the entire point of collecting it.
     *
     * Only for the products on this page, so the query stays proportional to what is on screen
     * rather than to the catalogue.
     */
    const availability = await this.prisma.productChannelAvailability.findMany({
      where: {
        productId: { in: rows.map((r) => r.productId) },
        ...(query.companyIds ? { companyId: { in: query.companyIds } } : {}),
      },
      select: {
        productId: true, integrationId: true, found: true, restricted: true,
        restrictionReason: true, checkedAt: true,
        competitive: true, competitionCheckedAt: true, featuredPriceCents: true,
        featuredMarginPct: true, currency: true,
      },
    });
    for (const a of availability) {
      const row = rows.find((r) => r.productId === a.productId);
      // Never overwrite a real listing. A live cell answers the question this was asked to fill in,
      // and an availability row can outlive the moment the product was listed.
      if (!row || row.cells[a.integrationId]) continue;
      row.cells[a.integrationId] = {
        listed: false,
        availability: {
          found: a.found,
          restricted: a.restricted,
          restrictionReason: a.restrictionReason,
          checkedAt: a.checkedAt,
          /**
           * Whether we could actually SELL here, not merely list here.
           *
           * The cell said "Can be listed" on every eligible marketplace, including the ones where
           * the featured offer is below our break-even. Both facts were already known; only the
           * cheaper one reached the grid, so a screen full of green invited work on marketplaces we
           * would lose money on. Null stays null — never asked is not a yes.
           */
          competitive: a.competitive,
          competitionCheckedAt: a.competitionCheckedAt,
          featuredPriceCents: a.featuredPriceCents,
          featuredMarginPct: a.featuredMarginPct,
          currency: a.currency,
        },
      } as any;
    }

    return { items: rows, total, page, pageSize };
  }

  /** One product across all its channels (for the detail page). Real listing data only —
   *  performance analytics (units sold, buy box, revenue) are placeholders in the UI. */
  /** The marketplace's own identifier for every listing of a product — one row per (channel,
   *  marketplace): eBay ItemID, Amazon ASIN, OnBuy OPC. Shown on the product card. */
  async identifiers(productId: string, companyIds?: string[]) {
    const listings = await this.prisma.channelListing.findMany({
      where: { productId, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: {
        channelSku: true, asin: true, externalListingId: true, marketplace: true,
        integration: { select: { channelType: true, name: true } },
      },
      orderBy: [{ integration: { channelType: 'asc' } }, { marketplace: 'asc' }],
    });
    const idType = (ct: string) => (ct === 'amazon' ? 'ASIN' : ct === 'ebay' ? 'eBay ItemID' : ct === 'onbuy' ? 'OnBuy OPC' : 'ID');
    return listings.map((l) => ({
      channelType: l.integration.channelType,
      channelName: l.integration.name,
      marketplace: l.marketplace || null,
      countryIso: l.marketplace ? (this.marketplaceIso(l.marketplace) ?? l.marketplace) : null,
      channelSku: l.channelSku,
      identifierType: idType(l.integration.channelType),
      identifier: l.externalListingId ?? l.asin ?? null,
    }));
  }

  async detail(productId: string, companyIds?: string[]) {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, ...ACTIVE },
      select: {
        id: true, mainSku: true, title: true,
        brand: { select: { name: true } },
        availability: { select: { quantity: true, updatedAt: true } },
        // The featured image — first by sortOrder, as the product page defines it — for the header.
        media: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1, select: { url: true } },
        channelListings: {
          where: companyIds ? { companyId: { in: companyIds } } : undefined,
          select: { integrationId: true, marketplace: true, channelSku: true, asin: true, externalListingId: true, listedPrice: true, currency: true, listedQuantity: true, fulfilmentChannel: true, listingStatus: true, lastPulledAt: true },
          orderBy: { integration: { name: 'asc' } },
        },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    const channels = await this.channels(companyIds);

    /**
     * What Amazon last said about the marketplaces this product is NOT on.
     *
     * Stored by the background sweep and by the manual check, so a card that would otherwise say
     * nothing can say when it was last asked. Read here rather than fetched: the answer costs two
     * SP-API calls and changes on the order of months, and a page load is neither the time nor the
     * budget to ask again.
     */
    const availability = await this.prisma.productChannelAvailability.findMany({
      where: { productId, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
      select: {
        integrationId: true, found: true, asin: true, restricted: true,
        restrictionReason: true, error: true, checkedAt: true, source: true,
      },
    });
    const availabilityByInt = new Map(availability.map((a) => [a.integrationId, a]));
    // Keyed the way channels() identifies a column, not by integration.
    //
    // One eBay connection serves eight marketplaces, so an integration id names a column only for
    // Amazon and OnBuy. Keying by it meant every eBay lookup missed and the product page reported
    // "Not listed" on all eight — and even had it matched, eight rows sharing one integration id
    // would have collapsed to whichever came last.
    // Same collapse the note above warns about, and the same fix: where a column holds more than
    // one row, the one carrying an offer wins rather than the one that happened to come last.
    const byInt = pickLiveListingsByKey(
      p.channelListings,
      (l) => (l.marketplace ? `${l.integrationId}:${l.marketplace}` : l.integrationId),
    );
    const econInputs = channels
      .filter((ch) => ch.salesChannelId && byInt.get(ch.id)?.listedPrice != null)
      .map((ch) => ({ key: ch.id, productId: p.id, salesChannelId: ch.salesChannelId!, grossNative: byInt.get(ch.id)!.listedPrice, currency: byInt.get(ch.id)!.currency }));
    const econ = await this.pricing.listingEconomics(econInputs);
    const perChannel = channels.map((ch) => {
      const l = byInt.get(ch.id);
      const e = econ.get(ch.id);
      return {
        integrationId: ch.id, name: ch.name, color: ch.color, currency: ch.currency,
        countryIso: ch.countryIso,
        // Carried so the card can link to the listing itself. The channel's own identifier is the
        // only thing that resolves on its storefront - our SKU means nothing there.
        channelType: ch.channelType ?? null,
        asin: l?.asin ?? null,
        channelSku: l?.channelSku ?? null,
        // eBay's ItemID lives here; it is the only thing that resolves on an eBay URL.
        externalListingId: l?.externalListingId ?? null,
        listed: !!l,
        price: l?.listedPrice ?? null,
        priceCurrency: l?.currency ?? null,
        quantity: l?.listedQuantity ?? null,
        fulfilmentChannel: l?.fulfilmentChannel ?? null,
        status: l ? this.deriveStatus(l) : null,
        profitEur: e?.profitEur ?? null,
        marginPct: e?.marginPct ?? null,
        loss: e?.loss ?? false,
        lastPulledAt: l?.lastPulledAt ?? null,
        /**
         * The stored answer to "could we list this here", or null if nobody has asked yet.
         *
         * Null is deliberately distinct from a stored `found: false`. "Not checked" and "Amazon has
         * no catalogue entry" look identical on a card that only shows what it can offer, and they
         * call for completely different actions — wait, versus stop waiting.
         */
        availability: (() => {
          const a = availabilityByInt.get(ch.id);
          if (!a) return null;
          return {
            found: a.found,
            asin: a.asin,
            restricted: a.restricted,
            restrictionReason: a.restrictionReason,
            error: a.error,
            checkedAt: a.checkedAt,
            source: a.source,
          };
        })(),
      };
    });
    return {
      productId: p.id, sku: p.mainSku, title: p.title, brand: p.brand?.name ?? null,
      imageUrl: p.media[0]?.url ?? null,
      masterStock: p.availability?.quantity ?? null,
      listedCount: p.channelListings.length,
      channelCount: channels.length,
      unitsLive: perChannel.filter((c) => c.listed).reduce((s, c) => s + (c.quantity ?? 0), 0),
      lastSyncedAt: p.channelListings.map((l) => l.lastPulledAt).filter(Boolean).sort().slice(-1)[0] ?? null,
      channels: perChannel,
    };
  }

  /**
   * Link listing rows to the product that owns their SKU.
   *
   * Availability belongs to the product, and the push finds listings BY product — so a listing that
   * nothing has linked is a live offer whose stock we silently stop maintaining. Linking used to
   * happen only while a listing was being pulled, which meant an alias defined after its listing was
   * last synced never took effect. Fourteen rows on production sat like that.
   *
   * Call it for one product after its SKUs change, or with no product to sweep the backlog.
   *
   * @param productId limit to one product's SKUs; omit to examine every row the catalogue can claim.
   */
  async relinkListings(
    opts: { productId?: string; companyIds?: string[] } = {},
  ): Promise<{ examined: number; claimed: number; moved: number; unknownSku: number; byPunctuation: number; byProduct: Record<string, number> }> {
    const products = await this.prisma.product.findMany({
      where: { ...ACTIVE, ...(opts.productId ? { id: opts.productId } : {}) },
      select: { id: true, mainSku: true, aliases: { where: ACTIVE, select: { skuValue: true } } },
    });
    const index = buildSkuOwnerIndex(products);
    /**
     * Built from the SAME products as the exact index, so a single-product call can only ever loosely
     * match that product's own SKUs — and a key two different products claim resolves to nobody.
     */
    const loose = buildLooseSkuIndex(products);
    if (index.size === 0) return { examined: 0, claimed: 0, moved: 0, unknownSku: 0, byPunctuation: 0, byProduct: {} };

    /**
     * For one product, ask only about its own SKUs. For the sweep, read the rows that have no owner
     * and match them in memory — 17k rows against a map beats 17k case-insensitive comparisons in
     * SQL, and the collation of `channel_sku` is then not something this depends on.
     */
    const rows = opts.productId
      ? await this.prisma.channelListing.findMany({
        where: {
          AND: [
            {
              OR: [
                ...[...index.keys()].map((k) => ({ channelSku: { equals: k, mode: 'insensitive' as const } })),
                /**
                 * Every unlinked row, not only the ones spelling this product's SKU exactly.
                 *
                 * The rule now also matches on punctuation, and a SQL `equals` cannot see through a
                 * separator — so selecting by exact spelling would have left the widened rule with
                 * nothing new to decide about. Same trap as the VAT repair, whose candidate query
                 * kept a UK assumption the rule had already dropped.
                 *
                 * It costs reading the unlinked rows, which the sweep below does anyway, and the
                 * index here holds ONE product's SKUs so nothing else can be claimed by it.
                 */
                { productId: null },
              ],
            },
            /**
             * Spelt out because `{ not: id }` alone drops NULLs in SQL — and NULL is precisely the
             * case this exists to fix. The same trap the FBA filter documents further up.
             */
            { OR: [{ productId: null }, { productId: { not: opts.productId } }] },
            ...(opts.companyIds ? [{ companyId: { in: opts.companyIds } }] : []),
          ],
        },
        select: { id: true, channelSku: true, productId: true },
      })
      : await this.prisma.channelListing.findMany({
        where: { productId: null, ...(opts.companyIds ? { companyId: { in: opts.companyIds } } : {}) },
        select: { id: true, channelSku: true, productId: true },
      });

    const claimBy = new Map<string, string[]>();
    let claimed = 0;
    let moved = 0;
    let unknownSku = 0;
    let byPunctuation = 0;
    for (const r of rows) {
      const { action, productId, how } = relinkAction(r, index, loose);
      if (action === 'unknown-sku') { unknownSku += 1; continue; }
      if (action === 'none' || !productId) continue;
      if (action === 'claim') claimed += 1; else moved += 1;
      /** Counted separately: a claim made on a separator is the one worth being able to audit. */
      if (how === 'punctuation') byPunctuation += 1;
      claimBy.set(productId, [...(claimBy.get(productId) ?? []), r.id]);
    }

    const byProduct: Record<string, number> = {};
    for (const [productId, ids] of claimBy) {
      byProduct[productId] = ids.length;
      // Chunked: an `IN` list costs a parameter per id and the backlog is not small.
      for (let i = 0; i < ids.length; i += 500) {
        await this.prisma.channelListing.updateMany({
          where: { id: { in: ids.slice(i, i + 500) } },
          data: { productId },
        });
      }
    }

    if (claimed || moved) {
      this.logger.log(
        `Re-linked listings${opts.productId ? ` for ${opts.productId}` : ''}: `
        + `${claimed} claimed, ${moved} moved`
        + `${byPunctuation ? `, ${byPunctuation} of them on punctuation alone` : ''}`
        + `${unknownSku ? `, ${unknownSku} on unknown SKUs left alone` : ''}.`,
      );
    }
    return { examined: rows.length, claimed, moved, unknownSku, byPunctuation, byProduct };
  }

  /**
   * Every listing SKU the catalogue cannot name an owner for — the worklist behind `unknownSku`.
   *
   * Reported rather than guessed. Attaching a stock figure to a listing on a hunch is how a channel
   * gets told we hold units of something else.
   */
  async unknownListingSkus(companyIds?: string[]) {
    const [rows, products] = await Promise.all([
      this.prisma.channelListing.findMany({
        where: { productId: null, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
        select: {
          channelSku: true, title: true, listedQuantity: true, marketplace: true, lastPulledAt: true,
          listingStatus: true, fulfilmentChannel: true,
          integration: { select: { name: true } },
        },
      }),
      this.prisma.product.findMany({ where: ACTIVE, select: { id: true, mainSku: true, aliases: { where: ACTIVE, select: { skuValue: true } } } }),
    ]);
    const index = buildSkuOwnerIndex(products);
    const loose = buildLooseSkuIndex(products);
    /**
     * Asked through the same matcher the relink uses, so the worklist cannot go on naming SKUs that
     * would now be placed. A SKU two products claim stays here — it is a real question for a person,
     * and the honest place for it is the list of things nobody has answered.
     */
    const unknown = rows.filter((r) => !matchSku(r.channelSku, index, loose).owner);

    const byChannel: Record<string, number> = {};
    for (const r of unknown) byChannel[r.integration.name] = (byChannel[r.integration.name] ?? 0) + 1;

    /**
     * One entry per SKU, not per row. The flat list was two thousand rows for a thousand SKUs —
     * the same product on fourteen marketplaces, fourteen times over — which made the pile look
     * twice its size and put no two copies of the same question next to each other.
     */
    const bySku = new Map<string, {
      channelSku: string; title: string | null; quantity: number;
      channels: string[]; rows: number; buyable: number; lastPulledAt: Date | null;
    }>();
    for (const r of unknown) {
      const key = normaliseSku(r.channelSku);
      const e = bySku.get(key) ?? {
        channelSku: r.channelSku, title: null, quantity: 0, channels: [], rows: 0, buyable: 0, lastPulledAt: null,
      };
      e.rows += 1;
      e.quantity += r.listedQuantity ?? 0;
      /** The channel's own title is the only clue to what the thing IS. Any of them will do. */
      if (!e.title && r.title) e.title = r.title;
      const channel = r.marketplace ? `${r.integration.name} ${r.marketplace}` : r.integration.name;
      if (!e.channels.includes(channel)) e.channels.push(channel);
      if (this.deriveStatus(r) !== 'paused') e.buyable += 1;
      if (r.lastPulledAt && (!e.lastPulledAt || r.lastPulledAt > e.lastPulledAt)) e.lastPulledAt = r.lastPulledAt;
      bySku.set(key, e);
    }

    const items = [...bySku.values()].map((e) => {
      const suggestion = suggestOwnerBySuffix(e.channelSku, index, loose);
      return {
        ...e,
        channels: e.channels.sort(),
        /**
         * A suggestion, never a link. `IT40779-FBA` is almost certainly `IT40779` under a fulfilment
         * alias nobody defined; `BE-BS39 MIT` matches the same way and MIT may be a colour. Deciding
         * between those is the person's job and the reason this is offered rather than applied.
         */
        suggestion: suggestion
          ? { sku: suggestion.owner.sku, productId: suggestion.owner.productId, dropped: suggestion.dropped }
          : null,
      };
    })
      /**
       * Worst first, and "worst" is what it costs rather than how many rows it has. A SKU buyable on
       * nine marketplaces with 38 units behind it is stock being published and never maintained; one
       * that is paused everywhere is a dead listing, and a worklist that mixes them is one nobody can
       * triage.
       */
      .sort((a, b) =>
        b.buyable - a.buyable
        || b.quantity - a.quantity
        || b.channels.length - a.channels.length
        || a.channelSku.localeCompare(b.channelSku));

    return {
      /** Distinct SKUs — the size of the actual job. `rows` is what it looks like from the database. */
      total: items.length,
      rows: unknown.length,
      /** Buyable somewhere, or carrying stock. The rest are dead listings nobody can buy. */
      worthChasing: items.filter((i) => i.buyable > 0 || i.quantity > 0).length,
      withSuggestion: items.filter((i) => i.suggestion).length,
      byChannel,
      items,
    };
  }
}

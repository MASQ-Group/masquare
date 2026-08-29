import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PricingService } from '../pricing/pricing.service';
import type { ProgressSink } from '../jobs/jobs.service';

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

/**
 * A channel with fewer than this on record is too small to reason about — a genuine small catalogue
 * can legitimately halve between pulls, and refusing there would be noise.
 */
const MIN_LISTINGS_TO_GUARD = 50;
/** A pull holding less than this share of what we already have is treated as partial, not as truth. */
const KEEP_FRACTION = 0.5;

@Injectable()
export class ChannelListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly pricing: PricingService,
  ) {}

  /** Derive a listing status the UI colours by: live | low | oos | paused | error. */
  private deriveStatus(l: { listedQuantity: number | null; listingStatus: string | null; fulfilmentChannel: string | null }): string {
    if (l.fulfilmentChannel === 'FBA') return 'live'; // Amazon controls FBA quantity
    const s = (l.listingStatus ?? '').toUpperCase();
    if (l.listedQuantity != null && l.listedQuantity <= 0) return 'oos';
    if (s && !s.includes('BUYABLE')) return 'paused'; // e.g. DISCOVERABLE-only
    if (l.listedQuantity != null && l.listedQuantity <= 5) return 'low';
    return 'live';
  }

  /** The connected channels (Amazon marketplaces) that can carry listings. */
  async channels(companyIds?: string[]) {
    const rows = await this.prisma.channelIntegration.findMany({
      where: { ...ACTIVE, status: 'active', channelType: { in: ['amazon', 'ebay', 'onbuy'] }, ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}) },
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
            id: `${r.id}:${m.marketplace}`,
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
        id: r.id,
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

  /** SKU (main + alias, lowercased) → productId, for matching pulled listings to our catalogue. */
  private async buildSkuMap() {
    const products = await this.prisma.product.findMany({
      where: ACTIVE,
      select: { id: true, mainSku: true, aliases: { where: ACTIVE, select: { skuValue: true } } },
    });
    const m = new Map<string, string>();
    for (const p of products) {
      m.set(p.mainSku.trim().toLowerCase(), p.id);
      for (const a of p.aliases) m.set(a.skuValue.trim().toLowerCase(), p.id);
    }
    return m;
  }

  /** Pull listings from the given (or all active Amazon) channels into ChannelListing. */
  // Channel types we can pull listings from today.
  private static readonly LISTING_CHANNELS = ['amazon', 'ebay', 'onbuy'];

  async sync(integrationIds?: string[], companyIds?: string[], progress?: ProgressSink) {
    // "Sync all" (no explicit ids) syncs every channel type with a listings connector.
    // A selective sync may target any connected channel; types without a listings connector
    // yet are reported, not silently dropped.
    const selective = !!integrationIds?.length;
    const where: Prisma.ChannelIntegrationWhereInput = {
      ...ACTIVE, status: 'active',
      ...(selective ? { id: { in: integrationIds } } : { channelType: { in: ChannelListingsService.LISTING_CHANNELS } }),
      ...(companyIds ? { targetCompanyId: { in: companyIds } } : {}),
    };
    const ints = await this.prisma.channelIntegration.findMany({ where, select: { id: true, name: true, channelType: true, targetCompanyId: true } });
    progress?.setTotal(ints.length);
    const skuMap = await this.buildSkuMap();
    const now = new Date();
    const results: Array<{ integrationId: string; name: string; ok: boolean; pulled?: number; message?: string }> = [];
    for (const intg of ints) {
      progress?.note(intg.name);
      try {
        const listings =
          intg.channelType === 'amazon' ? await this.integrations.fetchAmazonListings(intg.id)
          : intg.channelType === 'ebay' ? await this.integrations.fetchEbayListings(intg.id)
          : intg.channelType === 'onbuy' ? await this.integrations.fetchOnBuyListings(intg.id)
          : null;
        if (!listings) {
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
            productId: skuMap.get(l.sku.trim().toLowerCase()) ?? null,
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
        if (held >= MIN_LISTINGS_TO_GUARD && data.length < held * KEEP_FRACTION) {
          results.push({
            integrationId: intg.id, name: intg.name, ok: false, pulled: data.length,
            message: `Refused: the pull returned ${data.length} listing(s) against ${held} on record. `
              + 'Nothing was changed — check the channel, then re-run.',
          });
          progress?.tick(false);
          continue;
        }
        const ops: Prisma.PrismaPromise<unknown>[] = [this.prisma.channelListing.deleteMany({ where: { integrationId: intg.id } })];
        for (let i = 0; i < data.length; i += 1000) ops.push(this.prisma.channelListing.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true }));
        await this.prisma.$transaction(ops);
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

    // Blast radius. Count what this run would take from a REAL quantity down to zero, and refuse
    // the whole run if that exceeds the configured ceiling.
    //
    // Listings went out of stock across the catalogue and nothing stopped it or even remarked on
    // it. A push that empties shelves is never routine, whatever the reason — an empty availability
    // table, a bad filter, a default that reads as data. Refusing and showing the number is the only
    // response that cannot be missed.
    //
    // Deliberately BEFORE the loop: a guard that trips halfway has already done the damage it
    // exists to prevent.
    const ceiling = settings?.maxZeroingPushesPerRun ?? 25;
    const wouldZeroReal = listings.filter((l) => {
      if (l.integration.channelType === 'ebay' && !l.marketplace) return false;
      if (channelKeys && !channelKeys.has(channelKeyOf(l))) return false;
      if (l.productId == null || !qtyByProduct.has(l.productId)) return false; // skipped anyway
      return qtyByProduct.get(l.productId) === 0 && (l.listedQuantity ?? 0) > 0;
    }).length;
    if (!dryRun && wouldZeroReal > ceiling) {
      this.logger.error('Push REFUSED: it would zero ' + wouldZeroReal + ' listings that currently hold stock (ceiling ' + ceiling + ').');
      return {
        dryRun,
        count: 0,
        ok: 0,
        failed: 0,
        skipped: 0,
        blocked:
          'Refused: this would take ' + wouldZeroReal + ' listings from a real quantity down to zero, over the limit of ' +
          ceiling + '. Nothing was sent. Raise the limit in Settings if this is genuinely intended.',
        wouldZeroReal,
        results: [] as any[],
      };
    }

    const results: any[] = [];
    for (const l of listings) {
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

  /**
   * Put back the quantities that were lost, from the last good record we hold.
   *
   * eBay listings went to zero. eBaymag cannot fix it — its sync runs one way, FROM the origin eBay
   * listing INTO eBaymag, so its own figures are a stale mirror rather than a source it can push
   * back. Left alone it will eventually re-read the zeros and carry them to every other site. The
   * restore therefore has to come from us, and it has to reach the ORIGIN listing, because that is
   * what eBaymag propagates from.
   *
   * The source is `channelListing.listedQuantity` as at the last sync (24 Aug, two days before the
   * incident) — untouched for every listing we never pushed to. Where our own push overwrote it, the
   * audit still holds what it replaced, so `ChannelPush.previousValue` fills those in.
   *
   * Deliberately NOT driven by ProductAvailability: that table is empty, and reading quantities from
   * it is what started this.
   *
   * Dry run by default. Nothing is sent without `confirm`.
   */
  async restoreQuantities(
    opts: { marketplace?: string; channelType?: string; confirm?: boolean; limit?: number; since?: string; fallbackQuantity?: number; onlyMissing?: boolean; onlyDamaged?: boolean; excludeSkus?: string[]; integrationId?: string } = {},
    companyIds?: string[],
    actorId?: string,
    ctx?: ProgressSink,
  ) {
    const channelType = opts.channelType ?? 'ebay';
    const dryRun = !opts.confirm;

    // eBay puts the marketplace on the LISTING (one token, many markets, per-market rows). Amazon
    // puts it on the INTEGRATION and leaves the listing's own column empty. Filtering the listing
    // column with a 'GB' default therefore matches nothing on Amazon — so an Amazon restore is
    // addressed by integration id, which is unambiguous for either shape.
    const marketplace = opts.integrationId ? undefined : (opts.marketplace ?? 'GB');

    const listings = await this.prisma.channelListing.findMany({
      where: {
        ...(marketplace !== undefined ? { marketplace } : {}),
        ...(opts.integrationId ? { integrationId: opts.integrationId } : {}),
        integration: { channelType, deletedAt: null },
        // Amazon owns FBA quantity: it holds the stock, it counts it, and a quantity we send is
        // accepted and discarded. pushAvailability has always excluded these; the restore did not,
        // so it reported success on writes that could never take effect.
        //
        // Both forms are spelt out because NOT and { not: 'FBA' } each drop NULLs in SQL, and an
        // eBay or OnBuy listing has no fulfilment channel at all.
        OR: [{ fulfilmentChannel: null }, { fulfilmentChannel: { not: 'FBA' } }],
        ...(companyIds ? { companyId: { in: companyIds } } : {}),
      },
      select: {
        id: true, integrationId: true, channelSku: true, marketplace: true, productId: true,
        listedQuantity: true, externalListingId: true, companyId: true,
        integration: { select: { name: true, channelType: true } },
      },
      take: Math.min(opts.limit ?? 2000, 5000),
    });

    // Where our push flattened our own copy, the audit remembers what it replaced.
    // Only pushes from the incident window. Reaching further back resurrects figures that were
    // true weeks ago, and a quantity restored too high oversells — a worse failure than the one
    // being repaired, and one eBay penalises.
    const since = opts.since ? new Date(opts.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const audit = await this.prisma.channelPush.findMany({
      where: {
        field: 'quantity',
        previousValue: { gt: 0 },
        createdAt: { gte: since },
        ...(marketplace !== undefined ? { marketplace } : {}),
        ...(opts.integrationId ? { integrationId: opts.integrationId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { channelSku: true, integrationId: true, previousValue: true },
    });
    const fromAudit = new Map<string, number>();
    for (const a of audit) {
      const key = a.integrationId + '|' + a.channelSku;
      // Earliest wins: the first push is the one that saw the real figure.
      if (!fromAudit.has(key)) fromAudit.set(key, a.previousValue as number);
    }

    // SKUs to leave entirely alone. They are already at zero on the channel, so "set these to 0"
    // means touching nothing — the quietest correct action, and it keeps a listing someone has
    // deliberately emptied from being refilled by an assumption.
    const excluded = new Set((opts.excludeSkus ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean));
    const excludedMatched = new Set<string>();

    const plan = listings
      .map((l) => {
        const stored = l.listedQuantity ?? 0;
        const recovered = fromAudit.get(l.integrationId + '|' + l.channelSku) ?? 0;
        // The last sync is the truth unless WE flattened it. Only then does the audit stand in, and
        // only from the incident window. Never the higher of the two: that would let a stale figure
        // beat a current one and put stock on sale that is not there.
        // A flat figure for the listings no record can speak for. Opt-in and conservative by
        // construction: too LOW only costs a sale, too high oversells, and only one of those is
        // recoverable. Never applied on top of a figure we actually hold.
        const key = l.channelSku.trim().toLowerCase();
        if (excluded.has(key)) { excludedMatched.add(key); return { l, target: 0, source: 'excluded' as const }; }
        // onlyMissing restricts the run to listings no record can speak for, so anything already
        // put back keeps the figure it was given rather than being pushed again.
        if (opts.onlyMissing && (stored > 0 || recovered > 0)) return { l, target: 0, source: 'already restored' as const };
        const target = stored > 0 ? stored : recovered > 0 ? recovered : (opts.fallbackQuantity ?? 0);
        const source = target === 0 ? 'none' : stored > 0 ? 'last sync' : recovered > 0 ? 'push audit' : 'fallback';
        return { l, target, source };
      })
      // Nothing to restore for a listing we have no positive figure for. Pushing 0 is what caused
      // this; the restore will not repeat it under another name.
      // onlyDamaged keeps just the listings we actually zeroed — the ones whose figure comes from
      // the push audit because our own copy was flattened. Everything else already holds the right
      // quantity, and re-sending it is thousands of pointless marketplace calls: ~10,000 to repair
      // 2,345 listings. Fewer writes is not only quicker, it is less to go wrong.
      .filter((p) => (opts.onlyDamaged ? p.source === 'push audit' : p.target > 0));

    // The ones we can do nothing for. Reported rather than silently dropped: after a restore they
    // are the listings still sitting at zero, and "they were not restored" reads as a failure when
    // it is actually the rule working — we hold no positive figure for them anywhere, and inventing
    // one is what the whole incident was about.
    const noFigure = listings
      .filter((l) => (l.listedQuantity ?? 0) === 0 && !fromAudit.has(l.integrationId + '|' + l.channelSku))
      .map((l) => ({ sku: l.channelSku, itemId: l.externalListingId }));

    if (dryRun) {
      return {
        dryRun: true,
        marketplace: marketplace ?? opts.integrationId,
        candidates: plan.length,
        noFigure: noFigure.length,
        noFigureSample: noFigure.slice(0, 40),
        totalUnits: plan.reduce((s, p) => s + p.target, 0),
        fromLastSync: plan.filter((p) => p.source === 'last sync').length,
        fromPushAudit: plan.filter((p) => p.source === 'push audit').length,
        fromFallback: plan.filter((p) => p.source === 'fallback').length,
        excludedByRequest: excludedMatched.size,
        // A pasted SKU matching no listing here is silence otherwise, and silence reads as "applied".
        excludeSkusUnmatched: [...excluded].filter((k) => !excludedMatched.has(k)),
        sample: plan.slice(0, 20).map((p) => ({ sku: p.l.channelSku, itemId: p.l.externalListingId, currentlyStored: p.l.listedQuantity, restoreTo: p.target, source: p.source })),
      };
    }

    // Hundreds of sequential Trading API calls outlive any HTTP request — the first attempt died on
    // a 502 from the gateway while the server carried on working, which is the worst of both: no
    // result to read and no way to know how far it got. Runs as a job so progress is followable.
    ctx?.setTotal(plan.length);
    const results: any[] = [];
    for (const p of plan) {
      ctx?.note(p.l.channelSku);
      // Route by the LISTING's own channel, not by the argument that selected it.
      //
      // This called pushEbayQuantity unconditionally while accepting a channelType parameter, so
      // asking it to restore Amazon would have picked Amazon listings and then pushed them through
      // eBay's Trading API. Nobody hit it because only GB was ever run, but it sat there loaded the
      // moment an Amazon restore was discussed.
      const type = p.l.integration.channelType;
      const r =
        type === 'ebay' ? await this.integrations.pushEbayQuantity(p.l.integrationId, p.l.channelSku, p.l.marketplace, p.target, false, p.l.externalListingId)
        : type === 'amazon' ? await this.integrations.pushAmazonQuantity(p.l.integrationId, p.l.channelSku, p.target, false)
        : type === 'onbuy' ? await this.integrations.pushOnBuyQuantity(p.l.integrationId, p.l.channelSku, p.target, false)
        // Refusing beats guessing: a wrong channel writes a real quantity to the wrong marketplace.
        : { ok: false, message: 'No quantity push for ' + type };
      if (r.ok) {
        await this.prisma.channelListing.update({ where: { id: p.l.id }, data: { listedQuantity: p.target, lastPushedAt: new Date() } });
      }
      await this.prisma.channelPush.create({
        data: {
          companyId: p.l.companyId, integrationId: p.l.integrationId, productId: p.l.productId,
          channelSku: p.l.channelSku, marketplace: p.l.marketplace, field: 'quantity',
          requestedValue: p.target, previousValue: p.l.listedQuantity, ok: r.ok,
          message: ('restore: ' + r.message).slice(0, 300), dryRun: false, createdById: actorId ?? null,
        },
      });
      results.push({ sku: p.l.channelSku, restoreTo: p.target, ok: r.ok, message: r.message });
      ctx?.tick(r.ok);
    }

    const ok = results.filter((r) => r.ok).length;
    this.logger.log('Quantity restore on ' + marketplace + ': ' + ok + '/' + results.length + ' listings put back.');
    return { dryRun: false, marketplace: marketplace ?? opts.integrationId, count: results.length, ok, failed: results.length - ok, results };
  }

  private readonly logger = new Logger(ChannelListingsService.name);
  private pushQueue = new Set<string>();
  private pushTimer: NodeJS.Timeout | null = null;

  /**
   * Coalesce channel pushes triggered by sell-through. A burst of ingested orders touching the
   * same SKUs collapses to one live push per affected product, not one per order, which keeps
   * us well inside the marketplaces' quantity-update rate limits. Fire-and-forget: the sale that
   * scheduled it never waits on the network and never fails because a push did.
   */
  schedulePush(productIds: string[]) {
    for (const id of productIds) if (id) this.pushQueue.add(id);
    if (this.pushTimer || this.pushQueue.size === 0) return;
    this.pushTimer = setTimeout(() => {
      const ids = [...this.pushQueue];
      this.pushQueue.clear();
      this.pushTimer = null;
      this.pushAvailability(ids, { dryRun: false })
        .then((r) => this.logger.log(`Sell-through auto-push: ${r.ok}/${r.count} listing(s) updated across ${ids.length} product(s)${r.failed ? `, ${r.failed} failed` : ''}`))
        .catch((e) => this.logger.error(`Sell-through auto-push failed: ${e?.message ?? e}`));
    }, 8000);
    this.pushTimer.unref?.();
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
          channelListings: { where: query.companyIds ? { companyId: { in: query.companyIds } } : undefined, select: { integrationId: true, marketplace: true, channelSku: true, asin: true, listedPrice: true, currency: true, listedQuantity: true, fulfilmentChannel: true, listingStatus: true } },
        },
      }),
    ]);
    // A "column" is (integration × marketplace). eBay listings key by both so each marketplace
    // gets its own cell; single-marketplace channels (marketplace '') key by integration alone.
    const colId = (l: any) => (l.marketplace ? `${l.integrationId}:${l.marketplace}` : l.integrationId);
    const rows = products.map((p) => {
      const cells: Record<string, any> = {};
      for (const l of p.channelListings) cells[colId(l)] = this.cellOf(l);
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
        channelListings: {
          where: companyIds ? { companyId: { in: companyIds } } : undefined,
          select: { integrationId: true, channelSku: true, asin: true, listedPrice: true, currency: true, listedQuantity: true, fulfilmentChannel: true, listingStatus: true, lastPulledAt: true },
          orderBy: { integration: { name: 'asc' } },
        },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    const channels = await this.channels(companyIds);
    const byInt = new Map(p.channelListings.map((l) => [l.integrationId, l]));
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
      };
    });
    return {
      productId: p.id, sku: p.mainSku, title: p.title, brand: p.brand?.name ?? null,
      masterStock: p.availability?.quantity ?? null,
      listedCount: p.channelListings.length,
      channelCount: channels.length,
      unitsLive: perChannel.filter((c) => c.listed).reduce((s, c) => s + (c.quantity ?? 0), 0),
      lastSyncedAt: p.channelListings.map((l) => l.lastPulledAt).filter(Boolean).sort().slice(-1)[0] ?? null,
      channels: perChannel,
    };
  }
}

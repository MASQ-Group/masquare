import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProgressSink } from '../jobs/jobs.service';
import { channelDrifted } from './channel-drift';
import { ModuleRef } from '@nestjs/core';
import { Logger } from '@nestjs/common';

export interface AvailabilityQuery {
  q?: string;
  brandId?: string;
  vendorId?: string;
  productTypeId?: string;
  /** Only rows whose availability has (or hasn't) been set yet. */
  page?: number;
  pageSize?: number;
}

const ACTIVE = { deletedAt: null };

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  /**
   * `moduleRef` is OPTIONAL so the service stays constructible as `new AvailabilityService(prisma)`.
   * The commit-ordering spec builds it that way deliberately — it models two database connections to
   * catch a stale read, and forcing it to build a Nest container would trade a sharp test for a
   * slow one. Without the ref the push is skipped, which is right for a unit test and would be
   * loudly wrong in production, where Nest always supplies it.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * Resolved lazily by string token, with no runtime import of the class.
   *
   * Importing ChannelListingsModule here closes the cycle integrations -> sales-transactions ->
   * channel-listings -> integrations, which `nest build` does not catch — it fails at boot with that
   * module's first import undefined. The sell-through and the reconcile sweep reach the same service
   * the same way, for the same reason.
   */
  private channelListings(): { schedulePush(ids: string[], reason?: string): void } | null {
    return this.moduleRef?.get('CHANNEL_LISTINGS_SERVICE', { strict: false }) ?? null;
  }

  private serialize(p: any) {
    return {
      productId: p.id,
      mainSku: p.mainSku,
      title: p.title,
      brand: p.brand?.name ?? null,
      vendor: p.vendor?.name ?? null,
      productType: p.productType?.name ?? null,
      quantity: p.availability?.quantity ?? null, // null = never set
      lastSource: p.availability?.lastSource ?? null,
      updatedAt: p.availability?.updatedAt ?? null,
    };
  }

  /** The product filter shared by list() and listIds() so "select all matching" uses the same set. */
  /**
   * The availability list is the availability table, not the catalogue.
   *
   * A product is here because a person put it here. Listing every
   * product instead and leaving a blank where there was no row made the two indistinguishable:
   * "we hold none of this" looked the same as "nobody has ever assessed this", and there was
   * nothing for an operator to add because everything was already on screen. Products that are
   * listed on a channel but absent from here are work to do, and they have their own tab.
   */
  private buildWhere(query: AvailabilityQuery): Prisma.ProductWhereInput {
    const q = query.q?.trim();
    return {
      ...ACTIVE,
      availability: { isNot: null },
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.productTypeId ? { productTypeId: query.productTypeId } : {}),
      ...(q
        ? {
            OR: [
              { mainSku: { contains: q, mode: 'insensitive' } },
              { title: { contains: q, mode: 'insensitive' } },
              { aliases: { some: { skuValue: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
  }

  /** Every product id matching the current filter — backs "select all N" across pages. */
  async listIds(query: AvailabilityQuery): Promise<string[]> {
    const rows = await this.prisma.product.findMany({ where: this.buildWhere(query), select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Products with their channel-availability quantity (the number broadcast to sales channels). */
  async list(query: AvailabilityQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const where = this.buildWhere(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { mainSku: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, mainSku: true, title: true,
          brand: { select: { name: true } },
          vendor: { select: { name: true } },
          productType: { select: { name: true } },
          availability: { select: { quantity: true, lastSource: true, updatedAt: true } },
        },
      }),
    ]);
    return { items: rows.map((r) => this.serialize(r)), total, page, pageSize };
  }

  /**
   * SKUs live on a sales channel but absent from availability — the onboarding worklist.
   *
   * A listing whose SKU is not in availability is deliberately ignored by every quantity path: it is
   * never pushed, and never set to zero. That silence is correct, but it made the gap invisible, so
   * a product could sit listed and unmanaged indefinitely with nothing to say so. This is that gap,
   * named.
   *
   * Two kinds appear, and the difference decides what to do about them:
   *   • linked to a product — add it to availability and it is ready to sell
   *   • linked to nothing — the channel SKU matches no product at all, so the product must be
   *     created first. Grouped by SKU so one row means one thing to fix, not one per marketplace.
   */
  async missingFromAvailability(query: { q?: string; channelType?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const q = query.q?.trim()?.toLowerCase();

    const rows = await this.prisma.channelListing.findMany({
      where: {
        // Absent from availability. A listing whose product IS in availability is already handled.
        OR: [{ productId: null }, { product: { availability: { is: null } } }],
        ...(query.channelType ? { integration: { channelType: query.channelType } } : {}),
        ...(q ? { channelSku: { contains: q, mode: 'insensitive' } } : {}),
      },
      select: {
        channelSku: true,
        marketplace: true,
        listedQuantity: true,
        listingStatus: true,
        productId: true,
        product: { select: { id: true, mainSku: true, title: true } },
        integration: { select: { channelType: true, name: true } },
      },
    });

    // One row per SKU: the same product listed on five marketplaces is one job, not five.
    // Grouped by platform, because "listed on Amazon" is the fact that matters at a glance and the
    // eleven marketplaces behind it are the detail. eBay runs one integration across many markets,
    // so its market comes from the listing; Amazon and OnBuy carry theirs on the integration.
    const bySku = new Map<string, {
      channelSku: string;
      productId: string | null;
      mainSku: string | null;
      title: string | null;
      channels: { platform: string; markets: string[] }[];
      listedQuantity: number;
    }>();
    for (const r of rows) {
      const key = (r.product?.mainSku ?? r.channelSku).trim().toLowerCase();
      const cur = bySku.get(key) ?? {
        channelSku: r.channelSku,
        productId: r.productId,
        mainSku: r.product?.mainSku ?? null,
        title: r.product?.title ?? null,
        channels: [],
        listedQuantity: 0,
      };
      const platform = r.integration?.channelType ?? 'unknown';
      const market = platform === 'ebay' && r.marketplace
        ? `eBay ${r.marketplace.toUpperCase()}`
        : r.integration?.name ?? platform;
      let group = cur.channels.find((c) => c.platform === platform);
      if (!group) { group = { platform, markets: [] }; cur.channels.push(group); }
      if (!group.markets.includes(market)) group.markets.push(market);
      // What the marketplaces currently advertise, which is a useful starting figure but not a
      // number the platform vouches for — the operator still decides what goes into availability.
      cur.listedQuantity = Math.max(cur.listedQuantity, r.listedQuantity ?? 0);
      bySku.set(key, cur);
    }

    const all = [...bySku.values()].sort((a, b) => {
      // Products we already know come first: they are one click from being onboarded.
      if (!!a.productId !== !!b.productId) return a.productId ? -1 : 1;
      return (a.mainSku ?? a.channelSku).localeCompare(b.mainSku ?? b.channelSku);
    });

    return {
      items: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      /** Split so the UI can say how much is "add to availability" and how much is "create first". */
      withProduct: all.filter((r) => r.productId).length,
      withoutProduct: all.filter((r) => !r.productId).length,
      page,
      pageSize,
    };
  }

  /**
   * One product's availability, its movements, and what the channels were actually told.
   *
   * The three used to be answerable only in three places, which made the ordinary question
   * unanswerable: a unit sells, availability drops to 0, and nobody can say whether the channels
   * were told. "The push did not run" and "the push ran and was rejected" need different fixes, and
   * without the attempts beside the movements neither can be distinguished from the other — or from
   * a push that simply has not fired yet, since sell-through pushes are debounced.
   *
   * `companyIds` scopes the channel side and nothing else. Availability is one shared pool per
   * product and is deliberately company-agnostic, but listings and pushes belong to a company's
   * integration and must never be read across that line.
   */
  async get(productId: string, companyIds?: string[]) {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, ...ACTIVE },
      select: {
        id: true, mainSku: true, title: true,
        brand: { select: { name: true } }, vendor: { select: { name: true } }, productType: { select: { name: true } },
        availability: { select: { quantity: true, lastSource: true, updatedAt: true } },
      },
    });
    if (!p) throw new NotFoundException('Product not found');

    const scope = companyIds ? { companyId: { in: companyIds } } : {};
    const [ledger, pushes, listings] = await Promise.all([
      this.prisma.availabilityLedger.findMany({
        where: { productId }, orderBy: { createdAt: 'desc' }, take: 25,
      }),
      /**
       * Real quantity pushes only. A dry run is a rehearsal that never left the building, and
       * showing it next to a live attempt would answer "was the channel told?" with a yes when the
       * truthful answer is no.
       */
      this.prisma.channelPush.findMany({
        where: { productId, field: 'quantity', dryRun: false, ...scope },
        orderBy: { createdAt: 'desc' }, take: 40,
        // ChannelPush carries integrationId but has no relation to follow, so the channel is named
        // below from the listings, which do.
        select: {
          id: true, createdAt: true, marketplace: true, channelSku: true, integrationId: true,
          requestedValue: true, previousValue: true, ok: true, message: true,
        },
      }),
      this.prisma.channelListing.findMany({
        where: { productId, ...scope },
        select: {
          id: true, integrationId: true, marketplace: true, channelSku: true,
          listedQuantity: true, lastPulledAt: true,
          integration: { select: { name: true, channelType: true } },
        },
      }),
    ]);

    const held = p.availability?.quantity ?? null;
    const nameOf = new Map(listings.map((l) => [l.integrationId, l.integration?.name ?? null]));
    /**
     * What each channel actually holds, against what we hold — the check that settles it.
     *
     * Deliberately independent of the push log. A push row can be missing because the attempt was
     * never made, and it can be present and successful while our own record went unupdated;
     * comparing the two numbers catches both and needs neither to be trustworthy.
     *
     * `listedQuantity` is the marketplace's own figure as of the last pull (a successful push
     * overwrites it until the next one), so a mismatch means the channel really was advertising a
     * different number — as of that pull, which is why the date travels with it.
     */
    const channels = listings.map((l) => ({
      id: l.id,
      marketplace: l.marketplace || null,
      channelSku: l.channelSku,
      channelName: l.integration?.name ?? null,
      channelType: l.integration?.channelType ?? null,
      listedQuantity: l.listedQuantity,
      /**
       * How fresh that figure is. `lastPushedAt` would be the more natural field and is useless:
       * a full pull runs `deleteMany` then `createMany` over an integration's listings, so every
       * row is destroyed and rebuilt and the push stamp goes with it. Across the whole table, 0 of
       * 17,374 rows carry one. The pull date is real.
       */
      lastPulledAt: l.lastPulledAt,
      drifted: channelDrifted(held, l.listedQuantity),
    }));

    return {
      ...this.serialize(p),
      ledger,
      // A push against an integration this product is no longer listed on still happened, so it is
      // kept and simply goes unnamed rather than being dropped from the record.
      pushes: pushes.map(({ integrationId, ...r }) => ({ ...r, channelName: nameOf.get(integrationId) ?? null })),
      channels,
    };
  }

  /**
   * Every product whose channels disagree with what we hold — the reconcile worklist.
   *
   * The per-product panel answers "was this one told?"; this answers "what is out of step right
   * now?", which is the question nobody could ask at all. It is deliberately a QUERY rather than a
   * stored table: drift is a comparison of two live numbers, and a stored copy would be one more
   * thing that can be stale in its own right.
   *
   * `listedQuantity` is the marketplace's own figure as of the last pull, overwritten by any figure
   * we later push successfully — so a row here means the channel really was advertising a different
   * number when we last looked. `lastPulledAt` travels with it because that freshness is the whole
   * caveat.
   *
   * Company scope is not optional. Availability is one shared pool per product, but listings belong
   * to a company's integration and must never be read across that line.
   */
  async drift(opts: { companyIds?: string[]; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Number(opts.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(opts.pageSize) || 50));

    /**
     * Both sides in one pass, joined in memory.
     *
     * Prisma cannot compare two columns across a relation, and the alternative — raw SQL — would
     * put the drift rule in a second place that can drift from `channelDrifted` itself. The volume
     * is a few thousand rows on one side and tens of thousands on the other, which is a cheap join
     * to do here and an expensive rule to duplicate.
     */
    const [held, listings] = await Promise.all([
      this.prisma.productAvailability.findMany({ select: { productId: true, quantity: true } }),
      this.prisma.channelListing.findMany({
        where: { productId: { not: null }, ...(opts.companyIds ? { companyId: { in: opts.companyIds } } : {}) },
        select: {
          productId: true, marketplace: true, channelSku: true, listedQuantity: true, lastPulledAt: true,
          integration: { select: { name: true, channelType: true } },
        },
      }),
    ]);

    const heldBy = new Map(held.map((h) => [h.productId, h.quantity]));
    const offBy = new Map<string, { channels: any[] }>();
    for (const l of listings) {
      const pid = l.productId!;
      // A product with no availability row is not "out of step" — nothing was ever established for
      // it to be out of step WITH. channelDrifted refuses that comparison and so does this.
      if (!heldBy.has(pid)) continue;
      if (!channelDrifted(heldBy.get(pid), l.listedQuantity)) continue;
      if (!offBy.has(pid)) offBy.set(pid, { channels: [] });
      offBy.get(pid)!.channels.push({
        marketplace: l.marketplace || null,
        channelSku: l.channelSku,
        channelName: l.integration?.name ?? null,
        channelType: l.integration?.channelType ?? null,
        listedQuantity: l.listedQuantity,
        lastPulledAt: l.lastPulledAt,
      });
    }

    const ids = [...offBy.keys()];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, ...ACTIVE },
      select: { id: true, mainSku: true, title: true, brand: { select: { name: true } } },
    });

    /**
     * Which of these zeros anybody actually established.
     *
     * A product ADDED to availability carries zero meaning "tracked, not yet counted"; a product
     * COUNTED at zero really is out of stock. They are the same number and opposite facts, and the
     * difference decides whether the channels may be told. Pushing zero on an unestablished zero
     * empties live listings on the strength of something nobody ever said — which is how roughly
     * five thousand were emptied on 4 August.
     *
     * A count leaves a manual_set or vendor_import that MOVED the figure. The creation row is a
     * delta of zero, so it cannot be mistaken for one. Deliberately setting zero on an uncounted
     * product also records a zero delta and so reads as uncounted here: that is a false negative,
     * and the safe direction — it withholds a push rather than inventing one, and the worklist
     * still offers the button.
     */
    const counted = new Set(
      (await this.prisma.availabilityLedger.groupBy({
        by: ['productId'],
        where: { productId: { in: ids }, reason: { in: ['manual_set', 'vendor_import'] }, delta: { not: 0 } },
      })).map((r) => r.productId),
    );

    const rows = products.map((pr) => ({
      productId: pr.id,
      mainSku: pr.mainSku,
      title: pr.title,
      brand: pr.brand?.name ?? null,
      held: heldBy.get(pr.id) ?? null,
      /**
       * True when we hold zero and no count ever established it. Such a row is a question, not a
       * finding, and nothing may push it automatically.
       */
      unestablishedZero: (heldBy.get(pr.id) ?? 0) === 0 && !counted.has(pr.id),
      channels: offBy.get(pr.id)!.channels,
    }))
      // Worst first: the products advertising the most stock they do not have are the ones that
      // oversell, and a worklist nobody can triage is a worklist nobody reads.
      .sort((a, b) => {
        const over = (r: typeof a) => Math.max(...r.channels.map((c: any) => (c.listedQuantity ?? 0) - (r.held ?? 0)));
        return over(b) - over(a) || a.mainSku.localeCompare(b.mainSku);
      });

    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      /** Listings, not products — one product can be out of step on eight marketplaces. */
      channelCount: rows.reduce((n, r) => n + r.channels.length, 0),
      page,
      pageSize,
    };
  }

  /**
   * Clear availability entirely, so it can be rebuilt from figures someone vouches for.
   *
   * Almost every row arrived by a route that is no longer allowed: `adjust` used to upsert, so an
   * order for a product nobody had stocked created a row, sales clamped it at zero, and each
   * cancellation added one to nothing. 664 of 690 rows came from trade rather than from a vendor
   * file or a person, and 324 advertised units that never existed. A row at zero would still claim
   * "we know this product and hold none", which nobody ever established — so the table is emptied
   * rather than zeroed, and each product re-enters deliberately.
   *
   * The lines' recorded deductions go with it. Leaving 5,473 units of debt against rows that no
   * longer exist would reinvent the bug: re-add a product, cancel an old order, and the difference
   * between "deducted" and "desired" hands back units that were never taken.
   *
   * The ledger is kept. It is the record of what the system did, mistakes included, and deleting it
   * would erase the evidence of why the table was emptied.
   */
  async purgeAll(opts: { confirm?: boolean } = {}, actorId?: string) {
    const rows = await this.prisma.productAvailability.findMany({
      select: { productId: true, quantity: true, lastSource: true },
    });
    const lines = await this.prisma.salesTransactionItem.aggregate({
      where: { deletedAt: null, availabilityDeductedQty: { not: 0 } },
      _count: true,
      _sum: { availabilityDeductedQty: true },
    });

    const bySource = new Map<string, { rows: number; units: number }>();
    for (const r of rows) {
      const k = r.lastSource ?? '(none)';
      const cur = bySource.get(k) ?? { rows: 0, units: 0 };
      cur.rows += 1;
      cur.units += r.quantity;
      bySource.set(k, cur);
    }

    // Rows never set by a person or a vendor file: the ones trade created on its own.
    const deliberate = await this.prisma.availabilityLedger.findMany({
      where: { reason: { in: ['manual_set', 'manual_adjust', 'vendor_import'] } },
      select: { productId: true },
      distinct: ['productId'],
    });
    const deliberateIds = new Set(deliberate.map((d) => d.productId));

    const summary = {
      rows: rows.length,
      unitsAdvertised: rows.reduce((s, r) => s + r.quantity, 0),
      rowsFromTradeOnly: rows.filter((r) => !deliberateIds.has(r.productId)).length,
      bySource: [...bySource].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.rows - a.rows),
      linesHoldingADeduction: lines._count,
      unitsHeldOnLines: lines._sum.availabilityDeductedQty ?? 0,
    };

    if (!opts.confirm) return { dryRun: true as const, ...summary };

    await this.prisma.$transaction(async (tx) => {
      // One ledger line per product saying where its quantity went, so a product that reappears
      // later has an explanation rather than an unaccountable gap.
      for (const r of rows) {
        if (r.quantity === 0) continue;
        await tx.availabilityLedger.create({
          data: {
            productId: r.productId,
            delta: -r.quantity,
            newQuantity: 0,
            reason: 'purge',
            note: 'Availability cleared — rebuilt from vendor files and manual entry',
            createdById: actorId ?? null,
          },
        });
      }
      await tx.productAvailability.deleteMany({});
      await tx.salesTransactionItem.updateMany({
        where: { availabilityDeductedQty: { not: 0 } },
        data: { availabilityDeductedQty: 0 },
      });
    });

    return { dryRun: false as const, ...summary };
  }

  /**
   * Put products into availability at zero, so they can be counted.
   *
   * Adding one at a time is the honest unit — a person decides a product is ours to track — but 660
   * listed products need adding after the purge, and 660 clicks is not a process anyone completes.
   * This is the same decision taken once for many.
   *
   * Zero is the opening figure, not a guess at stock: the product is now watched and nobody has
   * counted it. It is also the only safe opening figure, because a quantity we invented would be
   * publishable the moment someone pressed Push to channels.
   *
   * `listedOnly` restricts it to products that actually sell somewhere, which is the set worth
   * onboarding first — a product listed nowhere gains nothing from being tracked.
   */
  async bulkAdd(
    opts: { productIds?: string[]; listedOnly?: boolean; confirm?: boolean } = {},
    actorId?: string,
    ctx?: ProgressSink,
  ) {
    const explicit = (opts.productIds ?? []).filter(Boolean);

    const candidates = await this.prisma.product.findMany({
      where: {
        ...ACTIVE,
        // Never touch a product already in availability: it has a figure someone stands behind, and
        // resetting it to zero would empty the shelves by another name.
        availability: { is: null },
        ...(explicit.length ? { id: { in: explicit } } : {}),
        ...(opts.listedOnly !== false ? { channelListings: { some: {} } } : {}),
      },
      select: { id: true, mainSku: true, title: true },
      orderBy: { mainSku: 'asc' },
    });

    if (!opts.confirm) {
      return {
        dryRun: true as const,
        wouldAdd: candidates.length,
        /** Asked for by id but already in availability, or not found — neither is an error. */
        skipped: explicit.length ? explicit.length - candidates.length : 0,
        sample: candidates.slice(0, 40).map((p) => ({ productId: p.id, mainSku: p.mainSku, title: p.title })),
      };
    }

    ctx?.setTotal(candidates.length);
    let added = 0;
    for (const p of candidates) {
      // One transaction each: a failure part-way leaves the products already added in availability
      // rather than rolling back work an operator can see has happened.
      await this.prisma.$transaction(async (tx) => {
        await tx.productAvailability.create({
          data: { productId: p.id, quantity: 0, lastSource: 'manual', updatedById: actorId ?? null },
        });
        await tx.availabilityLedger.create({
          data: {
            productId: p.id, delta: 0, newQuantity: 0, reason: 'manual_set',
            note: 'Added to availability — quantity not yet counted', createdById: actorId ?? null,
          },
        });
      });
      added += 1;
      ctx?.tick();
    }
    return { dryRun: false as const, added };
  }

  /** Set the absolute available quantity (manual). Records the change in the ledger. */
  async setQuantity(productId: string, quantity: number, note: string | null, actorId?: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, ...ACTIVE }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const qty = Math.max(0, Math.trunc(quantity));
    const current = await this.prisma.productAvailability.findUnique({ where: { productId }, select: { quantity: true } });
    const prev = current?.quantity ?? 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.productAvailability.upsert({
        where: { productId },
        create: { productId, quantity: qty, lastSource: 'manual', updatedById: actorId ?? null },
        update: { quantity: qty, lastSource: 'manual', updatedById: actorId ?? null },
      });
      await tx.availabilityLedger.create({
        data: { productId, delta: qty - prev, newQuantity: qty, reason: 'manual_set', note: note?.trim() || null, createdById: actorId ?? null },
      });
    });

    /**
     * Read AFTER the commit, not inside it.
     *
     * `get` goes through `this.prisma` — a different connection from the transaction's `tx` — so
     * called from inside the callback it could not see the writes above and returned the state from
     * before them. Setting a quantity of 3 on a product new to availability answered
     * `quantity: null, lastSource: null`: the write was right and the reply said it had not
     * happened, so any screen trusting the response showed an empty row after a successful save.
     *
     * The alternative — threading `tx` through `get` — would make a read helper carry a transaction
     * it has no other use for. Reading once the transaction has committed is both simpler and more
     * honest about what it returns: what is actually stored.
     */
    /**
     * Telling the channels is the point of setting the figure.
     *
     * Nothing here ever queued a push, so only SALES reached the marketplaces: someone typing a
     * quantity changed the number the platform holds and nothing else, and the listings kept
     * advertising the old one indefinitely. On production that left 57 products and 645 listings out
     * of step, and no amount of correct arithmetic here would have shown up on a marketplace.
     *
     * Fire-and-forget through the persisted queue, so the save never waits on the network and never
     * fails because a push did — and cannot lose the debt if the process restarts.
     */
    try {
      this.channelListings()?.schedulePush([productId], 'manual_set');
    } catch (e: any) {
      this.logger.error(`Could not queue a channel push for ${productId}: ${e?.message ?? e}`);
    }

    return this.get(productId);
  }

  /**
   * Move an EXISTING availability row by a delta (never below zero). Returns the new quantity, or
   * null when the product is not in availability.
   *
   * It will not create a row. A product enters availability when a person adds it, and never as a
   * side effect of trade. This used to upsert, so an order for a product
   * nobody had ever stocked created a row: sales clamped it at zero, then each cancellation added
   * one to nothing. 664 rows arrived that way, 324 of them showing 1,096 units that never existed,
   * and every one of those was a candidate to be broadcast to the marketplaces as sellable.
   *
   * A product outside availability is simply not our concern: no row, no ledger entry, nothing
   * recorded against the line. If it is added later it starts from the figure the operator or the
   * vendor file gives it, which is the only number anyone can vouch for.
   */
  async adjust(
    productId: string,
    delta: number,
    /**
     * Why, as established by the caller — never inferred here from the sign of the delta.
     *
     * 'cancellation' is retained only because 1,683 rows already carry it and their real cause was
     * never recorded. Nothing writes it any more: a caller now says which release this is.
     */
    reason: 'sale' | 'order_cancelled' | 'order_not_submitted' | 'released' | 'quantity_reduced'
      | 'cancellation' | 'vendor_import' | 'manual_adjust',
    ref: { refType?: string; refId?: string; note?: string } = {},
    actorId?: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number | null> {
    const current = await db.productAvailability.findUnique({ where: { productId }, select: { quantity: true } });
    if (!current) return null;
    const prev = current.quantity;
    const next = Math.max(0, prev + Math.trunc(delta));
    // A cancellation is the sale reversing itself, so it reads as the sale did. There is no
    // 'return' source: a return never moves availability.
    const source = reason === 'vendor_import' ? 'vendor_import' : reason === 'manual_adjust' ? 'manual' : 'sale';
    await db.productAvailability.update({
      where: { productId },
      data: { quantity: next, lastSource: source, updatedById: actorId ?? null },
    });
    await db.availabilityLedger.create({
      data: { productId, delta: next - prev, newQuantity: next, reason, refType: ref.refType ?? null, refId: ref.refId ?? null, note: ref.note ?? null, createdById: actorId ?? null },
    });
    return next;
  }
}

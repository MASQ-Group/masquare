import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalFactName, factFor } from './fact-names';
import { foldFindings, type SourceFinding } from './gather-rules';
import { isPayloadEligible, normaliseAspects, toJson, type AspectRecord } from './provenance';

/**
 * What is true about a product, once, for every channel.
 *
 * Research used to be per channel and so did its result: a colour found from the manufacturer's page
 * while writing eBay content was invisible to OnBuy, which sent Claude to find it again. Every
 * channel added multiplied that — and worse, a fact that two channels had each found once from a
 * retailer stayed held back on both, because neither could see that two sources now agreed.
 *
 * So findings land here as well as on the channel's own record, under canonical names. The evidence
 * shape is unchanged, which is the point: the two-sources rule, the manufacturer-outranks-everything
 * rule and the held-back-until-a-person-looks rule all keep working, and now they see everything
 * that has ever been found rather than one channel's share of it.
 *
 * Deliberately additive. Nothing reads this INSTEAD of a channel's own answer — a channel that has
 * its own record keeps using it, and this is the floor underneath.
 */
@Injectable()
export class ProductFactsService {
  private readonly logger = new Logger(ProductFactsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Everything known about the product, keyed canonically. */
  async facts(productId: string): Promise<Record<string, AspectRecord>> {
    const row = await this.prisma.product.findFirst({ where: { id: productId }, select: { facts: true } });
    return normaliseAspects(row?.facts ?? null);
  }

  /**
   * Fold accepted findings into the shared store.
   *
   * The finding's field is canonicalised BEFORE folding, so two channels' spellings of one fact
   * become one record with both sources on it. That is what lets a value each channel found once
   * from a retailer reach the two-sources rule together, which neither could do alone.
   */
  async remember(productId: string, accepted: readonly SourceFinding[], at: string, userId?: string): Promise<number> {
    const canonical = accepted
      .map((f) => ({ ...f, field: canonicalFactName(f.field) }))
      .filter((f) => f.field && (f.value ?? '').trim());
    if (!canonical.length) return 0;

    const names = [...new Set(canonical.map((f) => f.field))];
    const existing = await this.facts(productId);
    const { records, touched } = foldFindings(existing, canonical, names, at);
    const changed = touched.filter((t) => t.changed);
    if (!changed.length) return 0;

    await this.prisma.product.update({
      where: { id: productId },
      data: { facts: toJson(records) as object, ...(userId ? { updatedById: userId } : {}) },
    });
    this.logger.log(`Product facts: ${changed.length} fact(s) learned for ${productId}`);
    return changed.length;
  }

  /**
   * What we already know, answered by the names a channel uses.
   *
   * Only values that may be published: a fact one retailer vouched for is a suggestion, and offering
   * it here as already known would route around the rule that holds it back for a person to see.
   */
  async knownFor(productId: string, channelNames: readonly string[]): Promise<Record<string, string>> {
    const store = await this.facts(productId);
    const out: Record<string, string> = {};
    for (const name of channelNames) {
      const rec = factFor(store, name);
      if (rec && isPayloadEligible(rec)) out[name] = rec.value;
    }
    return out;
  }
}

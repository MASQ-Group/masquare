import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Writing down what Amazon said about one product on one marketplace.
 *
 * One function, used by both the background sweep and the manual "Check Amazon Availability"
 * button. They ask the same question of the same API, so they must leave the same record: two write
 * paths would drift, and the answer on screen would be whichever ran last rather than whichever is
 * true.
 *
 * A free function rather than a method because the manual path lives on AmazonListingService and the
 * scheduled one on AvailabilitySweepService, and the scheduled one already depends on the manual
 * one. Making the dependency go both ways to share four lines is a poor trade.
 */
export interface AvailabilityResult {
  found: boolean;
  asin: string | null;
  productType: string | null;
  title: string | null;
  /**
   * The catalogue image Amazon returned.
   *
   * Stored because a match is a judgement, and an ASIN with a title is thin evidence for one. The
   * sweep was already receiving this and throwing it away.
   */
  imageUrl: string | null;
  /** Null means the restrictions call itself failed — unknown, not unrestricted. */
  restricted: boolean | null;
  restrictionReason: string | null;
  error: string | null;
}

export async function recordAvailability(
  prisma: PrismaService,
  where: { productId: string; integrationId: string; companyId: string; marketplace: string },
  result: AvailabilityResult,
  source: 'scheduled' | 'manual',
): Promise<void> {
  const data = {
    ...result,
    // Trimmed rather than left for the database to refuse: an over-long Amazon message is not a
    // reason to lose the verdict that came with it.
    restrictionReason: result.restrictionReason?.slice(0, 500) ?? null,
    error: result.error?.slice(0, 500) ?? null,
    marketplace: where.marketplace,
    companyId: where.companyId,
    checkedAt: new Date(),
    source,
  };
  await prisma.productChannelAvailability.upsert({
    where: { productId_integrationId: { productId: where.productId, integrationId: where.integrationId } },
    create: { productId: where.productId, integrationId: where.integrationId, ...data },
    update: data,
  });
}

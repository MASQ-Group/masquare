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

/**
 * What the competition looked like at the moment of the check.
 *
 * Optional throughout: a check without pricing does not ask, and Amazon sometimes refuses. Both are
 * `undefined`/null rather than false — "we did not ask" and "we would lose money" are different
 * facts, and only one of them should stop somebody listing.
 */
export interface CompetitionResult {
  /** True where we could win the Buy Box at a profit; false where we could not; null unanswered. */
  competitive: boolean | null;
  featuredPriceCents: number | null;
  featuredMarginPct: number | null;
  currency: string | null;
}

/** The competition columns as stored. */
export interface StoredCompetition {
  asin: string | null;
  competitive: boolean | null;
  competitionCheckedAt: Date | null;
  featuredPriceCents: number | null;
  featuredMarginPct: number | null;
  currency: string | null;
}

const CLEARED = {
  competitive: null,
  competitionCheckedAt: null,
  featuredPriceCents: null,
  featuredMarginPct: null,
  currency: null,
} as const;

/**
 * Which competition columns a check should write.
 *
 * Three cases, and the two that are easy to get wrong are the ones that matter:
 *
 *  - The check priced. Write what it found, dated now.
 *  - The check did not price, and the catalogue answer is about the SAME ASIN. Keep what is stored.
 *    A nightly availability sweep must not erase a price read somebody paid a throttled call for;
 *    its own date is what tells a reader how old it is.
 *  - The check did not price, and the ASIN has CHANGED. Clear it. A verdict about the old ASIN is
 *    not a stale answer to this question, it is an answer to a different one, and carrying it over
 *    would attach one product's competition to another's.
 */
export function competitionUpdate(
  stored: StoredCompetition | null,
  incomingAsin: string | null,
  competition: CompetitionResult | undefined,
  now: Date,
): Partial<StoredCompetition> {
  if (competition) {
    return {
      competitive: competition.competitive,
      // Dated even when the verdict is null: "asked at 10am and Amazon would not say" is worth
      // recording, and without a date it is indistinguishable from never having asked.
      competitionCheckedAt: now,
      featuredPriceCents: competition.featuredPriceCents,
      featuredMarginPct: competition.featuredMarginPct,
      currency: competition.currency,
    };
  }
  if (!stored?.competitionCheckedAt) return {};
  return stored.asin === incomingAsin ? {} : { ...CLEARED };
}

export async function recordAvailability(
  prisma: PrismaService,
  where: { productId: string; integrationId: string; companyId: string; marketplace: string },
  result: AvailabilityResult,
  source: 'scheduled' | 'manual',
  /** Omitted where the check did not price. Not the same as pricing that came back empty. */
  competition?: CompetitionResult,
): Promise<void> {
  const stored = await prisma.productChannelAvailability.findUnique({
    where: { productId_integrationId: { productId: where.productId, integrationId: where.integrationId } },
    select: {
      asin: true, competitive: true, competitionCheckedAt: true,
      featuredPriceCents: true, featuredMarginPct: true, currency: true,
    },
  });
  const now = new Date();
  const data = {
    ...result,
    // Trimmed rather than left for the database to refuse: an over-long Amazon message is not a
    // reason to lose the verdict that came with it.
    restrictionReason: result.restrictionReason?.slice(0, 500) ?? null,
    error: result.error?.slice(0, 500) ?? null,
    marketplace: where.marketplace,
    companyId: where.companyId,
    checkedAt: now,
    source,
    ...competitionUpdate(stored, result.asin, competition, now),
  };
  await prisma.productChannelAvailability.upsert({
    where: { productId_integrationId: { productId: where.productId, integrationId: where.integrationId } },
    create: { productId: where.productId, integrationId: where.integrationId, ...data },
    update: data,
  });
}

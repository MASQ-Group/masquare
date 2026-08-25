import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Which Amazon integrations may be used for more than pulling orders.
 *
 * The platform serves two companies with two SEPARATE Amazon seller accounts, each with its own
 * developer credentials. Work performed against the wrong one is not a cosmetic bug: it writes
 * prices or listings into another legal entity's account.
 *
 * Nothing in a query like `findFirst({ channelType: 'amazon', marketplace: 'UK' })` knows which
 * company an integration belongs to, and with two UK integrations it returns whichever row the
 * database offers first. This turns "we only use Multitrade for orders" from an intention into a
 * property of the query: an orders-only company's integrations are not disabled, they are
 * unreachable from repricing, listing, fees, floors and the marketplace sweep.
 *
 * Order ingestion deliberately does NOT use this — it is the one thing an orders-only account is for.
 */
export async function fullScopeIntegrationWhere(
  prisma: PrismaService,
): Promise<Prisma.ChannelIntegrationWhereInput> {
  const ordersOnly = await prisma.company.findMany({
    where: { amazonScope: 'orders' },
    select: { id: true },
  });

  return {
    AND: [
      // Default-deny on an unassigned integration. A freshly connected account has no company yet,
      // and that gap is exactly when picking the wrong seller is easiest — better for repricing to
      // ignore an integration nobody has finished setting up than to reach into an unknown account.
      // Stated on its own rather than left to `NOT IN` quietly dropping NULLs, which is true but
      // far too subtle a thing to rest this guarantee on.
      { targetCompanyId: { not: null } },
      ...(ordersOnly.length > 0 ? [{ targetCompanyId: { notIn: ordersOnly.map((c) => c.id) } }] : []),
    ],
  };
}

/** True when this company may only be used to pull orders. */
export async function isOrdersOnlyCompany(prisma: PrismaService, companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const c = await prisma.company.findFirst({ where: { id: companyId }, select: { amazonScope: true } });
  return c?.amazonScope === 'orders';
}

import { describe, expect, it } from 'vitest';
import { fullScopeIntegrationWhere, isOrdersOnlyCompany } from './amazon-scope';

/**
 * Two companies, two SEPARATE Amazon seller accounts, two sets of developer credentials.
 *
 * N.K. Multitrade is connected to pull orders for analytics and nothing else. That was a stated
 * intention, and an intention is not enforced by anything: a query like
 * `findFirst({ channelType: 'amazon', marketplace: 'UK' })` has no idea which company an
 * integration belongs to, and with two UK integrations it returns whichever row the database
 * offers first. Repricing could then authenticate as Multitrade and write a price derived from
 * maSquare's costs into Multitrade's account.
 *
 * These pin the filter that turns the intention into a property of the query.
 */

const prismaWith = (ordersOnlyIds: string[]) =>
  ({ company: { findMany: async () => ordersOnlyIds.map((id) => ({ id })) } }) as any;

const prismaCompany = (scope: string | null) =>
  ({ company: { findFirst: async () => (scope === null ? null : { amazonScope: scope }) } }) as any;

describe('fullScopeIntegrationWhere', () => {
  it('excludes an orders-only company', async () => {
    const where: any = await fullScopeIntegrationWhere(prismaWith(['multitrade-id']));
    expect(where.AND).toContainEqual({ targetCompanyId: { notIn: ['multitrade-id'] } });
  });

  it('excludes an integration with no company at all', async () => {
    // A freshly connected account has no company yet, and that gap is exactly when reaching into
    // the wrong seller is easiest. Both branches must carry this, not just the one with exclusions.
    const withOrdersOnly: any = await fullScopeIntegrationWhere(prismaWith(['multitrade-id']));
    const withNone: any = await fullScopeIntegrationWhere(prismaWith([]));
    expect(withOrdersOnly.AND).toContainEqual({ targetCompanyId: { not: null } });
    expect(withNone.AND).toContainEqual({ targetCompanyId: { not: null } });
  });

  it('does not rely on NOT IN quietly dropping nulls', async () => {
    // It happens to be true in SQL, but this guarantee is too important to rest on a subtlety a
    // future edit could remove without anyone noticing.
    const where: any = await fullScopeIntegrationWhere(prismaWith(['a', 'b']));
    const explicit = where.AND.filter((c: any) => JSON.stringify(c) === JSON.stringify({ targetCompanyId: { not: null } }));
    expect(explicit).toHaveLength(1);
  });

  it('still restricts when nothing is orders-only, so adding a company later cannot widen it', async () => {
    const where: any = await fullScopeIntegrationWhere(prismaWith([]));
    expect(where.AND.length).toBeGreaterThan(0);
    expect(JSON.stringify(where)).not.toBe('{}');
  });
});

describe('isOrdersOnlyCompany', () => {
  it('is true only for an orders-only company', async () => {
    expect(await isOrdersOnlyCompany(prismaCompany('orders'), 'x')).toBe(true);
    expect(await isOrdersOnlyCompany(prismaCompany('full'), 'x')).toBe(false);
  });

  it('is false when there is no company to ask about', async () => {
    // Used to REFUSE listing work, so an unknown company must not read as restricted and block a
    // legitimate maSquare listing. The where-filter is what fails safe; this one fails open.
    expect(await isOrdersOnlyCompany(prismaCompany(null), 'missing')).toBe(false);
    expect(await isOrdersOnlyCompany(prismaCompany('orders'), null)).toBe(false);
    expect(await isOrdersOnlyCompany(prismaCompany('orders'), undefined)).toBe(false);
  });
});

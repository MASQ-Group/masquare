import { describe, expect, it } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AccessGuard } from './access.guard';
import { ACCESS_AREA, ACCESS_CAPABILITY, ACCESS_LEVEL, ACCESS_PORTAL, ACCESS_SKIP } from './access.decorators';
import { resolveAccess } from './resolve';
import { DEFAULT_ROLES } from './default-roles';

/**
 * The gate itself.
 *
 * The behaviour worth pinning hardest is the refusal of an UNDECLARED route. The arrangement this
 * replaces failed silently — an unguarded route was simply open, and nothing distinguished
 * "deliberately public" from "nobody got round to it". 301 of 309 routes looked identical to each
 * other and to a mistake.
 */

const ROLE = (key: string) => DEFAULT_ROLES.find((r) => r.key === key)!.grants;

function guard(meta: Record<string, unknown>, opts: { method?: string; user?: { sub: string } | null; access?: any; portalUser?: boolean } = {}) {
  const req: any = { method: opts.method ?? 'GET', user: opts.user === undefined ? { sub: 'u1' } : opts.user };
  const reflector: any = { getAllAndOverride: (key: string) => meta[key] };
  const service: any = {
    forUser: async () => opts.access ?? resolveAccess({ isAdmin: true }),
    isPortalUser: async () => opts.portalUser === true,
  };
  const ctx: any = {
    getType: () => 'http',
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req }),
  };
  return { guard: new AccessGuard(reflector, service), ctx, req };
}

describe('a route that declares nothing', () => {
  it('is refused, even for a platform admin', async () => {
    // The point of deny-by-default: a controller added without a declaration must fail for the
    // person who wrote it, not quietly admit the whole company.
    const { guard: g, ctx } = guard({}, { access: resolveAccess({ isAdmin: true }) });
    await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 401, not 403, when nobody is signed in', async () => {
    // A global guard runs before the controller's JwtAuthGuard, so this is the ordinary
    // not-signed-in case. The web client redirects to login on 401 and does nothing on 403 — a
    // 403 here left an expired session stuck on a broken page.
    const { guard: g, ctx } = guard({ [ACCESS_AREA]: ['inventory'] }, { user: null });
    await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('is allowed only through an explicit exemption', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_SKIP]: true }, { user: null });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('level inferred from the verb', () => {
  const readOnly = resolveAccess({ isAdmin: false, role: { areas: { inventory: 'view' }, capabilities: {} } });

  it('lets a reader GET', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_AREA]: ['inventory'] }, { method: 'GET', access: readOnly });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });

  it('stops a reader POSTing, PATCHing or DELETEing', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const { guard: g, ctx } = guard({ [ACCESS_AREA]: ['inventory'] }, { method, access: readOnly });
      await expect(g.canActivate(ctx), method).rejects.toThrow(/view but not change/);
    }
  });

  it('honours an override for a POST that only reads', async () => {
    // Previews, estimates and dry runs are POSTs because they carry a body, not because they change
    // anything.
    const { guard: g, ctx } = guard(
      { [ACCESS_AREA]: ['inventory'], [ACCESS_LEVEL]: 'view' },
      { method: 'POST', access: readOnly },
    );
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('several areas on one route', () => {
  it('admits anyone holding any one of them', async () => {
    // Global search reaches into orders, products and stock; holding any is reason enough.
    const onlyOrders = resolveAccess({ isAdmin: false, role: { areas: { sales_transactions: 'view' }, capabilities: {} } });
    const { guard: g, ctx } = guard({ [ACCESS_AREA]: ['products', 'sales_transactions', 'inventory'] }, { access: onlyOrders });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });

  it('refuses someone holding none of them', async () => {
    const none = resolveAccess({ isAdmin: false });
    const { guard: g, ctx } = guard({ [ACCESS_AREA]: ['products', 'sales_transactions'] }, { access: none });
    await expect(g.canActivate(ctx)).rejects.toThrow(/do not have access/);
  });
});

describe('capabilities sit on top of the area, not instead of it', () => {
  const editorWithout = resolveAccess({
    isAdmin: false,
    role: { areas: { channel_listings: 'edit' }, capabilities: { marketplace_write: false } },
  });

  it('refuses an editor who lacks the capability', async () => {
    // Being able to edit a listing is not being able to publish one. This is the 4 August failure
    // expressed as a test.
    const { guard: g, ctx } = guard(
      { [ACCESS_AREA]: ['channel_listings'], [ACCESS_CAPABILITY]: 'marketplace_write' },
      { method: 'POST', access: editorWithout },
    );
    await expect(g.canActivate(ctx)).rejects.toThrow(/Write to marketplaces/);
  });

  it('refuses someone holding the capability but not the area', async () => {
    const capOnly = resolveAccess({ isAdmin: false, role: { areas: {}, capabilities: { marketplace_write: true } } });
    const { guard: g, ctx } = guard(
      { [ACCESS_AREA]: ['channel_listings'], [ACCESS_CAPABILITY]: 'marketplace_write' },
      { method: 'POST', access: capOnly },
    );
    await expect(g.canActivate(ctx)).rejects.toThrow(/do not have access/);
  });
});

describe('the sync operator', () => {
  const syncOnly = resolveAccess({ isAdmin: false, role: ROLE('sync_operator') });
  const full = resolveAccess({ isAdmin: false, role: { areas: { integrations: 'edit' }, capabilities: { trigger_sync: true } } });

  it('may run a manual sync', async () => {
    // View on the area plus the capability — the whole point of keeping the two kinds apart.
    const { guard: g, ctx } = guard(
      { [ACCESS_AREA]: ['integrations'], [ACCESS_LEVEL]: 'view', [ACCESS_CAPABILITY]: 'trigger_sync' },
      { method: 'POST', access: syncOnly },
    );
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });

  it('may not edit or remove a connection', async () => {
    for (const method of ['PATCH', 'DELETE', 'POST']) {
      const { guard: g, ctx } = guard({ [ACCESS_AREA]: ['integrations'] }, { method, access: syncOnly });
      await expect(g.canActivate(ctx), method).rejects.toThrow(/view but not change/);
    }
  });

  it('may not reach scheduling, which is held at edit even to read', async () => {
    const { guard: g, ctx } = guard(
      { [ACCESS_AREA]: ['integrations'], [ACCESS_LEVEL]: 'edit' },
      { method: 'GET', access: syncOnly },
    );
    await expect(g.canActivate(ctx)).rejects.toThrow(/view but not change/);
  });

  it('holds nothing outside integrations and the orders a sync produces', async () => {
    expect(syncOnly.areas.integrations).toBe('view');
    expect(syncOnly.areas.sales_transactions).toBe('view');
    expect(syncOnly.areas.channel_listings).toBe('none');
    expect(syncOnly.areas.products).toBe('none');
    expect(syncOnly.capabilities.trigger_sync).toBe(true);
    expect(syncOnly.capabilities.marketplace_write).toBe(false);
  });

  it('is distinguishable from someone with the full module', async () => {
    // The pair the split exists to create: both can sync, only one can do anything else.
    const { guard: g, ctx } = guard({ [ACCESS_AREA]: ['integrations'] }, { method: 'PATCH', access: full });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('what the handler is given', () => {
  it('leaves the resolved access on the request', async () => {
    // So a service can shape its response — hiding cost columns is a question about the answer, not
    // about whether the route may be called.
    const access = resolveAccess({ isAdmin: false, role: ROLE('warehouse') });
    const { guard: g, ctx, req } = guard({ [ACCESS_AREA]: ['inventory'] }, { access });
    await g.canActivate(ctx);
    expect(req.access.capabilities.marketplace_write).toBe(false);
  });
});

/**
 * A logistics customer's own person, loose in the platform.
 *
 * Their grants are all none, so the area check would refuse them anyway — but `@NoAccessCheck()`
 * routes never reach it, and the countries list and a person's own notifications are both of those.
 * This is the check that closes them.
 */
describe('a portal user', () => {
  it('is refused on an ordinary route', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_AREA]: ['shipments'] }, { portalUser: true });
    await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  /** The one that matters: a route with no area is not a route without a boundary. */
  it('is refused even where no access check applies', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_SKIP]: true }, { portalUser: true });
    await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is told what kind of account they are using', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_SKIP]: true }, { portalUser: true });
    await expect(g.canActivate(ctx)).rejects.toThrow(/customer portal/);
  });

  it('is let through the routes marked for them', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_SKIP]: true, [ACCESS_PORTAL]: true }, { portalUser: true });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });

  it('leaves staff unaffected', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_SKIP]: true }, { portalUser: false });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });

  /** Nobody signed in is nobody to refuse — that case belongs to the 401 below it. */
  it('does not turn an anonymous request into a forbidden one', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_AREA]: ['shipments'] }, { user: null });
    await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

/**
 * A portal route, which declares neither an area nor an exemption.
 *
 * This shipped broken: the route-coverage test learned that `@PortalRoute()` is a declaration and
 * the guard did not, so every portal request reached the "declares no access area" refusal and was
 * forbidden. The customer's own screens were unusable while the tests were green, which is exactly
 * the gap this file exists to close.
 */
describe('a portal route', () => {
  it('is allowed for a signed-in portal user', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_PORTAL]: true }, { portalUser: true });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });

  /** Staff reaching one is not this guard's refusal to make — PortalGuard has no customer for them. */
  it('is allowed past this guard for staff too, because the portal guard is the gate', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_PORTAL]: true }, { portalUser: false });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });

  it('still answers 401 when nobody is signed in', async () => {
    const { guard: g, ctx } = guard({ [ACCESS_PORTAL]: true }, { user: null });
    await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

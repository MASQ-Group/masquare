import { describe, expect, it } from 'vitest';
import { APP_GUARD } from '@nestjs/core';
import { AccessModule } from './access.module';
import { AccessGuard } from './access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * The order the guards run in.
 *
 * This is the one property of the access layer that no unit test could catch, and it broke the
 * whole platform. Nest runs APP_GUARD providers before any `@UseGuards()` on a controller, so while
 * JwtAuthGuard sat at the controller level the access guard ran FIRST, found no `req.user`, and
 * refused every authenticated route with a 401. The web client reads 401 as an expired session:
 * it cleared the token and returned to the login page, so signing in appeared to do nothing.
 *
 * Every other test passed throughout. Each guard was correct on its own; only their sequence was
 * wrong, and sequence is a property of the assembled module rather than of either guard.
 *
 * This reads that assembly. It is not an HTTP test — `@nestjs/testing` is not a dependency here and
 * an incident is the wrong moment to add one — so it asserts the arrangement rather than the
 * behaviour. The behaviour was verified against the running server, and the arrangement is what a
 * future edit would get wrong.
 */

/** The APP_GUARD classes the module registers, in declaration order. */
function globalGuards(): unknown[] {
  const providers: any[] = Reflect.getMetadata('providers', AccessModule) ?? [];
  return providers.filter((p) => p && p.provide === APP_GUARD).map((p) => p.useClass);
}

describe('global guard registration', () => {
  it('registers both guards globally', () => {
    // JwtAuthGuard being global is the fix itself: as a controller-level guard it ran too late to
    // put a user on the request before the access guard looked for one.
    const guards = globalGuards();
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(AccessGuard);
  });

  it('authenticates before it authorises', () => {
    // "Who is this" has to be answered before "what may they do". Reversing these two lines is the
    // entire bug, and it produces a platform where only the login page works.
    const guards = globalGuards();
    expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(guards.indexOf(AccessGuard));
  });

  it('registers exactly these two, so a third does not silently land between them', () => {
    expect(globalGuards()).toEqual([JwtAuthGuard, AccessGuard]);
  });
});

describe('the two exemptions are different questions', () => {
  it('keeps @Public and @NoAccessCheck as separate metadata keys', async () => {
    // Conflating them is the obvious next mistake: /auth/me must be authenticated (not @Public) but
    // must skip the access check (@NoAccessCheck), because it reports your own profile and has to
    // know whose. One flag could not express that.
    const { IS_PUBLIC } = await import('../auth/public.decorator');
    const { ACCESS_SKIP } = await import('./access.decorators');
    expect(IS_PUBLIC).not.toBe(ACCESS_SKIP);
  });
});

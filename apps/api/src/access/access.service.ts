import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { EffectiveAccess } from './catalogue';
import { resolveAccess, sanitiseGrants } from './resolve';

/**
 * How long a resolved access set may be reused before it is read again.
 *
 * Access is resolved per request rather than carried in the token, because a token is a promise
 * made at sign-in and access has to be revocable now: withdrawing someone's right to write to a
 * marketplace must take effect immediately, not whenever they next happen to log in.
 *
 * The cache exists only to stop a burst of requests from one person becoming a burst of identical
 * queries. Ten seconds is short enough that a revocation is effectively immediate and long enough
 * to cover a page load. Every write to a user or a role clears it outright, so the window only ever
 * applies to a change made somewhere this process cannot see.
 */
const CACHE_TTL_MS = 10_000;

@Injectable()
export class AccessService {
  private readonly cache = new Map<string, { at: number; access: EffectiveAccess }>();

  constructor(private readonly prisma: PrismaService) {}

  /** One user's effective access: the admin flag, then their role, then their own overrides. */
  async forUser(userId: string): Promise<EffectiveAccess> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.access;

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        isAdmin: true,
        status: true,
        accessOverrides: true,
        role: { select: { grants: true, deletedAt: true } },
      },
    });

    // No user, or a suspended one, holds nothing. Resolving from `undefined` would otherwise hand
    // back a set of falses that reads the same as a real answer — this way the denial is deliberate.
    const access =
      !user || user.status !== 'active'
        ? resolveAccess({ isAdmin: false })
        : resolveAccess({
            isAdmin: user.isAdmin,
            // A soft-deleted role grants nothing; its holders keep only their own overrides.
            role: user.role && !user.role.deletedAt ? sanitiseGrants(user.role.grants) : null,
            overrides: sanitiseGrants(user.accessOverrides),
          });

    this.cache.set(userId, { at: Date.now(), access });
    return access;
  }

  /**
   * Forget what was resolved.
   *
   * Called whenever a user or a role is written. Clearing everything on a role change is the
   * cheap and correct choice: working out who held that role costs a query, and the recovery is a
   * single re-read per active user.
   */
  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}

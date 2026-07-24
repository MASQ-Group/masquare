import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './current-user.decorator';

/**
 * Company data isolation. A user may only see/act on the companies granted to them
 * (admins hold every grant, mirroring AuthService.me). The *active* company narrows
 * that to the one they're working in (chosen in the CompanySwitcher, sent as the
 * `x-company-id` header). This is the single source of truth for both — enforced
 * server-side so the client can never widen its own scope.
 */
@Injectable()
export class CompanyScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Company ids this user is allowed to see. Admins → all companies. */
  async allowedIds(user: AuthUser): Promise<string[]> {
    if (user.isAdmin) {
      const all = await this.prisma.company.findMany({ where: { deletedAt: null }, select: { id: true } });
      return all.map((c) => c.id);
    }
    const rows = await this.prisma.userCompanyAccess.findMany({
      where: { userId: user.sub, company: { deletedAt: null } },
      select: { companyId: true },
    });
    return rows.map((r) => r.companyId);
  }

  /**
   * Resolve the request's company context.
   * - `activeId`: the company being worked in — the validated header, or the sole
   *   allowed company when there's exactly one. Null for a multi-company user who
   *   hasn't picked one (they then see everything they're allowed).
   * - `visibleIds`: what list queries may return — [activeId] when set, else all allowed.
   */
  async resolve(user: AuthUser, requestedId?: string | null): Promise<{ allowedIds: string[]; activeId: string | null; visibleIds: string[] }> {
    const allowedIds = await this.allowedIds(user);
    const valid = requestedId && allowedIds.includes(requestedId) ? requestedId : null;
    const activeId = valid ?? (allowedIds.length === 1 ? allowedIds[0] : null);
    const visibleIds = activeId ? [activeId] : allowedIds;
    return { allowedIds, activeId, visibleIds };
  }
}

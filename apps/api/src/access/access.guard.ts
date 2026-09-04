import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../common/current-user.decorator';
import { ACCESS_AREA, ACCESS_CAPABILITY, ACCESS_LEVEL, ACCESS_SKIP } from './access.decorators';
import { AccessService } from './access.service';
import { AREAS, CAPABILITIES, type AccessLevel } from './catalogue';
import { canArea, canDo } from './resolve';

/** Reading is a GET; everything else changes something. */
const levelForMethod = (method: string): AccessLevel => (method === 'GET' || method === 'HEAD' ? 'view' : 'edit');

const areaLabel = (key: string) => AREAS.find((a) => a.key === key)?.label ?? key;
const capabilityLabel = (key: string) => CAPABILITIES.find((c) => c.key === key)?.label ?? key;

/**
 * The gate.
 *
 * Registered globally, and denies anything it cannot find a declaration for. That is the whole
 * point: the previous arrangement failed silently — a route with no guard was simply open, and
 * nothing distinguished "deliberately public" from "nobody got round to it". Of 309 routes, 8 were
 * guarded and the other 301 looked exactly the same as each other.
 *
 * Now a route with no `@AccessArea` and no `@NoAccessCheck` refuses everyone, including admins.
 * A new controller added without a declaration fails immediately and loudly for whoever wrote it,
 * rather than quietly admitting the whole company.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const handler = context.getHandler();
    const controller = context.getClass();
    const pick = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, [handler, controller]);

    if (pick<boolean>(ACCESS_SKIP)) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    /**
     * No authenticated user.
     *
     * A global guard runs BEFORE the controller's JwtAuthGuard, so this is the ordinary
     * not-signed-in case rather than anything exotic — and it has to answer 401, because the web
     * client redirects to the login page on 401 and does nothing on 403. Answering 403 here left an
     * expired session staring at a broken page instead of being asked to sign in again.
     *
     * A route genuinely missing its auth guard lands here too and is refused just the same; the log
     * line is what tells the two apart, since the response deliberately cannot.
     */
    if (!user?.sub) {
      this.logger.debug(`${controller.name}.${handler.name} reached the access guard with no authenticated user.`);
      throw new UnauthorizedException();
    }

    const areas = pick<string[]>(ACCESS_AREA);
    if (!areas?.length) {
      this.logger.error(
        `${controller.name}.${handler.name} declares no access area. Add @AccessArea(...) or @NoAccessCheck().`,
      );
      throw new ForbiddenException('This endpoint is not configured for access control.');
    }

    const access = await this.access.forUser(user.sub);
    const required = pick<AccessLevel>(ACCESS_LEVEL) ?? levelForMethod(req.method);

    // Any one of the named areas is enough. A route that spans several — global search reaching
    // into orders and products — is legitimately reachable by someone who holds either.
    const allowed = areas.some((area) => canArea(access, area, required));
    if (!allowed) {
      const names = areas.map(areaLabel).join(' or ');
      // Which refusal this is depends on what they actually hold, not on what was asked for.
      // Telling someone with no access at all that they "can view but not change" it sends them
      // looking for a button that was never there.
      const canRead = areas.some((area) => canArea(access, area, 'view'));
      throw new ForbiddenException(
        canRead ? `You can view but not change ${names}.` : `You do not have access to ${names}.`,
      );
    }

    // On top of the area, never instead of it.
    const capability = pick<string>(ACCESS_CAPABILITY);
    if (capability && !canDo(access, capability)) {
      throw new ForbiddenException(`This action needs the “${capabilityLabel(capability)}” permission.`);
    }

    // Handed to the request so a service can shape what it returns, should one ever need to:
    // narrowing a response is a question about the answer rather than about the route, and the
    // guard is the only place that has already worked out who is asking.
    req.access = access;
    return true;
  }
}

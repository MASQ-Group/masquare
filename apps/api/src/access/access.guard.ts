import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
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
    // Unauthenticated requests are JwtAuthGuard's business. Reaching here without a user means the
    // route has no auth guard either, which is a mistake rather than a permission question.
    if (!user?.sub) {
      this.logger.error(`${controller.name}.${handler.name} has no authentication guard — refusing.`);
      throw new ForbiddenException('This endpoint is not configured for access control.');
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

    // Handed to the request so a service can shape what it returns — hiding cost columns from
    // someone without `cost_profit` is a question about the response, not about the route.
    req.access = access;
    return true;
  }
}

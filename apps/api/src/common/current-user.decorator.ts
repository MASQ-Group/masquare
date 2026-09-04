import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { EffectiveAccess } from '../access/catalogue';

export interface AuthUser {
  /** user id (JWT subject) */
  sub: string;
  email: string;
  isAdmin: boolean;
}

/**
 * The caller's resolved access, as the guard left it on the request.
 *
 * For the handful of decisions a route decorator cannot express — where the SAME endpoint means
 * two different things depending on the arguments, and only one of them is the lesser right.
 */
export const CurrentAccess = createParamDecorator((_data: unknown, ctx: ExecutionContext): EffectiveAccess => {
  const req = ctx.switchToHttp().getRequest();
  // The guard sets this on every checked route. A route reaching here without it is exempt, and an
  // exempt route asking about access is a mistake worth failing on rather than defaulting open.
  if (!req.access) throw new Error('No resolved access on the request — is this route exempt from the access guard?');
  return req.access as EffectiveAccess;
});

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);

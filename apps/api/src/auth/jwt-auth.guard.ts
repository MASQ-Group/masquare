import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC } from './public.decorator';

/**
 * Authentication.
 *
 * Registered globally, and — crucially — BEFORE the access guard. Nest runs APP_GUARD providers in
 * the order they are declared, and both of those run before any `@UseGuards()` on a controller.
 * When this was left as a controller-level guard while the access guard was global, the access
 * guard ran first, found no `req.user`, and refused every authenticated route in the platform.
 * Signing in worked, because the auth routes are exempt from the access check; everything after it
 * came back 401, and the web client dutifully cleared the token and returned to the login screen.
 *
 * So the ordering is not a detail. It is the whole reason this guard is global.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;
    // Signing in, the health probe and the marketplace webhooks arrive with no user by definition.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

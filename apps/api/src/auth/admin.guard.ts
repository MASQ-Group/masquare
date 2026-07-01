import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/current-user.decorator';

/** Allows the request only when the authenticated user is a platform admin.
 *  Use after JwtAuthGuard so req.user is populated. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user?.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}

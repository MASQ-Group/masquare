import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  /** user id (JWT subject) */
  sub: string;
  email: string;
  isAdmin: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);

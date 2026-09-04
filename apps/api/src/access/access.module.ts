import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessService } from './access.service';
import { AccessGuard } from './access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessBootstrap } from './access.bootstrap';
import { AccessController } from './access.controller';
import { RolesController } from './roles.controller';

/**
 * Authentication and access control, wired globally, in that order.
 *
 * Both are APP_GUARDs rather than something each controller opts into. A guard you have to remember
 * is a guard somebody eventually forgets, and the failure is silent — which is precisely how 301 of
 * 309 routes came to be unguarded.
 *
 * THE ORDER MATTERS AND IS NOT COSMETIC. Nest runs APP_GUARD providers in the order declared here,
 * and all of them before any `@UseGuards()` on a controller. While JwtAuthGuard was left at the
 * controller level, the access guard ran first, found no `req.user`, and refused every
 * authenticated route in the platform with a 401 — which the web client reads as an expired session,
 * so it cleared the token and bounced back to the login screen. Signing in appeared to do nothing.
 *
 * Authentication answers "who is this"; access answers "what may they do". The second cannot be
 * asked before the first.
 */
@Global()
@Module({
  controllers: [AccessController, RolesController],
  providers: [
    AccessService,
    // Seeds the shipped roles on every start. Roles are not optional data: with enforcement on, a
    // deploy that migrates and stops there locks out everyone who is not a platform admin.
    AccessBootstrap,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AccessService],
})
export class AccessModule {}

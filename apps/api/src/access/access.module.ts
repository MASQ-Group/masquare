import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessService } from './access.service';
import { AccessGuard } from './access.guard';
import { AccessController } from './access.controller';

/**
 * Access control, wired globally.
 *
 * The guard is registered as an APP_GUARD rather than left for each controller to remember. A guard
 * you have to opt into is a guard somebody eventually forgets, and the failure is silent — which is
 * precisely how 301 of 309 routes came to be unguarded. This way the default is refusal and the
 * exemptions are the thing that has to be written down.
 */
@Global()
@Module({
  controllers: [AccessController],
  providers: [AccessService, { provide: APP_GUARD, useClass: AccessGuard }],
  exports: [AccessService],
})
export class AccessModule {}

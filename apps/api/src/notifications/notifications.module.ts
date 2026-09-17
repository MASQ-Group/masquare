import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

/**
 * In-app notifications.
 *
 * Global for the same reason as mail: everything that will want to raise one lives in a different
 * module, and it depends on nothing but Prisma, so it cannot join an import cycle.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

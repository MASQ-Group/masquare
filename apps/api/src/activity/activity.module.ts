import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';

/**
 * Global, because activity is cross-cutting: products today, sales transactions, availability,
 * pricing and settings next. Every one of those modules would otherwise have to import it, and a
 * module that forgets to is a silent hole in the record rather than a compile error.
 */
@Global()
@Module({
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}

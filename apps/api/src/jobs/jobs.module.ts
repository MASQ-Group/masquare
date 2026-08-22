import { Global, Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

/** Global: any module with a slow action can register one without wiring an import each time. */
@Global()
@Module({
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}

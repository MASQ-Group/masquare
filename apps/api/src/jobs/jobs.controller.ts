import { Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JobsService } from './jobs.service';
import { NoAccessCheck } from '../access/access.decorators';

/** Progress for long-running actions. Read-only apart from cancel; the ids are unguessable UUIDs. */
@ApiTags('jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('jobs')
// Progress of a job the caller already started; the work itself was authorised when it began.
@NoAccessCheck()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    const job = this.jobs.get(id);
    // A job that no longer exists is almost always a restarted server rather than a bad id, and
    // the difference matters: the work stopped partway and has to be run again.
    if (!job) throw new NotFoundException('That run is no longer being tracked — the server restarted, so it stopped partway. Run it again.');
    return job;
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return { cancelled: this.jobs.cancel(id) };
  }
}

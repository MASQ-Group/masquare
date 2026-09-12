import { Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JobsService } from './jobs.service';
import { NoAccessCheck } from '../access/access.decorators';
import { looksLikeJobId } from './job-id';

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
    if (job) return job;

    /**
     * Two different situations wearing one 404, and the advice is opposite.
     *
     * A well-formed id we no longer hold really is a restarted server: the work stopped partway and
     * has to be run again. But an id that was never a UUID cannot have been a job — and telling
     * somebody their run "stopped partway, run it again" when they simply pasted the placeholder
     * sends them to re-trigger a job that may be running perfectly well.
     */
    if (!looksLikeJobId(id)) {
      throw new NotFoundException(`"${id}" is not a run id. Use the id the action returned when it started.`);
    }
    throw new NotFoundException('That run is no longer being tracked — the server restarted, so it stopped partway. Run it again.');
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return { cancelled: this.jobs.cancel(id) };
  }
}

import { Controller, Get } from '@nestjs/common';
import { NoAccessCheck } from './access/access.decorators';
import { Public } from './auth/public.decorator';

/** Lightweight, unauthenticated liveness probe. Mounted at /api/health.
 *  Railway's healthcheck polls this so it only cuts traffic to a new
 *  container once it is actually accepting requests (no redeploy gap). */
@Controller('health')
// Liveness probe. Called by the platform, not by a person.
@NoAccessCheck()
@Public()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

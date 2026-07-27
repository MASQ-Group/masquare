import { Controller, Get } from '@nestjs/common';

/** Lightweight, unauthenticated liveness probe. Mounted at /api/health.
 *  Railway's healthcheck polls this so it only cuts traffic to a new
 *  container once it is actually accepting requests (no redeploy gap). */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

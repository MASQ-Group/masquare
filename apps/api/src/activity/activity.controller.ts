import { BadRequestException, Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessArea } from '../access/access.decorators';

/** Retention settings for the change log, and the numbers to choose them against. */
@ApiTags('activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('activity')
@AccessArea('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService, private readonly prisma: PrismaService) {}

  /** The whole log, filtered. Defaults to people — see ActivityService.list. */
  @Get()
  list(@Query() q: Record<string, string>) {
    return this.activity.list({
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      entityType: q.entityType || undefined,
      action: q.action || undefined,
      actorId: q.actorId || undefined,
      who: q.who || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      search: q.search || undefined,
    });
  }

  /** Who and what actually appear in the log, for the filter dropdowns. */
  @Get('facets')
  facets() {
    return this.activity.listFacets();
  }

  /** Current windows plus what the log holds and what a purge would remove. */
  @Get('retention')
  retention() {
    return this.activity.retentionStats();
  }

  @Patch('retention')
  async setRetention(@Body() dto: { userDays?: number; systemDays?: number }) {
    // A negative window is meaningless and would silently keep everything; an absurd one is
    // almost certainly a typo for something much smaller. Zero is allowed and means "keep forever".
    for (const [k, v] of Object.entries(dto)) {
      if (v == null) continue;
      if (!Number.isInteger(v) || v < 0 || v > 3650) {
        throw new BadRequestException(`${k} must be a whole number of days between 0 and 3650 (0 = keep forever).`);
      }
    }
    const existing = await this.prisma.platformSettings.findFirst({ select: { id: true } });
    const data = {
      ...(dto.userDays != null ? { activityRetentionUserDays: dto.userDays } : {}),
      ...(dto.systemDays != null ? { activityRetentionSystemDays: dto.systemDays } : {}),
    };
    if (existing) await this.prisma.platformSettings.update({ where: { id: existing.id }, data });
    else await this.prisma.platformSettings.create({ data });
    return this.activity.retentionStats();
  }

  /**
   * Run the purge now rather than waiting for tonight.
   *
   * Deliberately a separate action from saving the window: shortening retention and deleting to it
   * are different decisions, and doing both on one button would make a mistyped number
   * irreversible before anyone saw the count.
   */
  @Post('retention/purge')
  async purgeNow() {
    const removed = await this.activity.purge();
    return { ...removed, stats: await this.activity.retentionStats() };
  }
}

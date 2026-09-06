import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessArea, NoAccessCheck } from '../../access/access.decorators';
import { AvailabilitySweepService } from './availability-sweep.service';

/**
 * The schedule that keeps "where could we list this" answered.
 *
 * Under global settings rather than under listings, because it is a platform-wide rate: it spends
 * one shared SP-API budget across both companies' accounts, and nobody should be able to raise it
 * from inside the page whose numbers it feeds.
 */
@AccessArea('global_settings')
@ApiTags('global-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('availability-sweep')
export class AvailabilitySweepController {
  constructor(
    private readonly svc: AvailabilitySweepService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The schedule and what it is actually achieving.
   *
   * Readable without the settings permission: the product page shows how old its stored answers
   * are, and that is the same question asked from a different screen.
   */
  @NoAccessCheck()
  @Get()
  status() {
    return this.svc.status();
  }

  @Post()
  async update(
    @Body()
    body: {
      enabled?: boolean;
      batchSize?: number;
      intervalMinutes?: number;
      recheckDays?: number;
    },
  ) {
    const row = await this.prisma.platformSettings.findFirst({ select: { id: true } });
    if (!row) throw new BadRequestException('Platform settings have not been created yet');

    // Bounded on the way in rather than trusted. These numbers decide how hard the platform leans
    // on a shared SP-API quota, and a mistyped batch size is the one that reaches Amazon.
    const data: Record<string, unknown> = {};
    if (body.enabled != null) data.availabilitySweepEnabled = !!body.enabled;
    if (body.batchSize != null) data.availabilitySweepBatchSize = clamp(body.batchSize, 0, 500, 'Batch size');
    if (body.intervalMinutes != null) {
      // Five minutes is the tick; asking for less would silently become five.
      data.availabilitySweepIntervalMinutes = clamp(body.intervalMinutes, 5, 10_080, 'Interval');
    }
    if (body.recheckDays != null) data.availabilityRecheckDays = clamp(body.recheckDays, 1, 365, 'Re-check window');

    await this.prisma.platformSettings.update({ where: { id: row.id }, data });
    return this.svc.status();
  }

  /**
   * Run one batch now.
   *
   * Forced past both the enabled flag and the interval, because the reason to press it is to see
   * whether the thing works at all before leaving it switched on.
   */
  @Post('run')
  run() {
    return this.svc.runDueBatch(true);
  }
}

function clamp(value: number, min: number, max: number, label: string): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) throw new BadRequestException(`${label} must be a number`);
  if (n < min || n > max) throw new BadRequestException(`${label} must be between ${min} and ${max}`);
  return n;
}

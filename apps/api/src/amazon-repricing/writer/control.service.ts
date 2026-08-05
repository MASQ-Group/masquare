import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Global runtime controls for the price-writer (spec §6.4). A single DB row so ops can flip the
// kill switch / live-writes at RUNTIME from the console — no redeploy (you can't redeploy to stop
// a price war). The env AMZ_REPRICING_KILL_SWITCH is an ADDITIONAL last-resort hard stop that ORs
// with the DB flag (see price-writer).

const SINGLETON = 'singleton';

export interface RepricingControl {
  liveWritesEnabled: boolean;
  killSwitchEngaged: boolean;
}

@Injectable()
export class RepricingControlService {
  constructor(private readonly prisma: PrismaService) {}

  /** The control row, created with safe defaults (both OFF) on first read. */
  async get(): Promise<RepricingControl> {
    const row = await this.prisma.repricingControl.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON },
      update: {},
      select: { liveWritesEnabled: true, killSwitchEngaged: true },
    });
    return row;
  }

  async update(patch: Partial<RepricingControl>, actorId?: string): Promise<RepricingControl & { updatedAt: Date }> {
    return this.prisma.repricingControl.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, ...patch, updatedById: actorId ?? null },
      update: { ...patch, updatedById: actorId ?? null },
      select: { liveWritesEnabled: true, killSwitchEngaged: true, updatedAt: true },
    });
  }
}

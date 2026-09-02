import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { diffRecords, summariseChanges, type DiffOptions, type FieldChange } from './diff';

export type ActivitySource = 'user' | 'import' | 'sync' | 'system';

/**
 * Which sources count as a person, for retention.
 *
 * A spreadsheet upload is a deliberate human act and is kept as long as a hand edit — the fact that
 * a file carried the change makes it no less someone's decision, and a bulk import going wrong is
 * precisely the case worth being able to look back at.
 */
const HUMAN_SOURCES = ['user', 'import'];
const MACHINE_SOURCES = ['sync', 'system'];

/** Deleted per statement, so a first purge over a large backlog never holds one long lock. */
const PURGE_BATCH = 5000;

export interface RecordArgs {
  entityType: string;
  entityId: string;
  /** How the record identified itself at the time — a product's main SKU. */
  entityLabel?: string | null;
  action: 'create' | 'update' | 'delete' | 'restore';
  source?: ActivitySource;
  actorId?: string | null;
  summary?: string | null;
  changes?: FieldChange[] | null;
}

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write one entry. Never throws.
   *
   * A failure to record history must not fail the thing being recorded — refusing to save a
   * product because its audit row would not write is a worse outcome than a gap in the log. The
   * failure is logged loudly instead, so a silently broken logger still shows up somewhere.
   */
  async record(args: RecordArgs): Promise<void> {
    try {
      // An update that changed nothing is not an event. Opening a record and pressing Save must
      // not fill the history with rows that say "no fields changed" — that is how a log becomes
      // unreadable, and then unread.
      if (args.action === 'update' && (!args.changes || args.changes.length === 0)) return;

      await this.prisma.activity.create({
        data: {
          entityType: args.entityType,
          entityId: args.entityId,
          entityLabel: args.entityLabel ?? null,
          action: args.action,
          source: args.source ?? 'user',
          actorId: args.actorId ?? null,
          summary: args.summary ?? (args.changes ? summariseChanges(args.changes) : null),
          changes: (args.changes as any) ?? undefined,
        },
      });
    } catch (e: any) {
      this.logger.error(`Could not record ${args.action} on ${args.entityType} ${args.entityId}: ${e?.message ?? e}`);
    }
  }

  /** Convenience: diff two versions and record the result in one call. */
  async recordUpdate(
    args: Omit<RecordArgs, 'action' | 'changes'>,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    opts: DiffOptions = {},
  ): Promise<void> {
    await this.record({ ...args, action: 'update', changes: diffRecords(before, after, opts) });
  }

  /**
   * One entity's history, newest first.
   *
   * Paged rather than unbounded: a product edited daily for a year has hundreds of entries, and a
   * history tab that loads all of them to show the last ten is a slow page for no benefit.
   */
  async forEntity(entityType: string, entityId: string, opts: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const where = { entityType, entityId };

    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, action: true, source: true, summary: true, changes: true, createdAt: true,
          actor: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.activity.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        source: r.source,
        summary: r.summary,
        changes: (r.changes as unknown as FieldChange[] | null) ?? [],
        createdAt: r.createdAt,
        // Null actor means the platform acted on its own — a sync, a repair script. Naming it
        // that way is more honest than showing a blank column.
        actor: r.actor ? { id: r.actor.id, name: r.actor.fullName, email: r.actor.email } : null,
      })),
      total, page, pageSize,
    };
  }

  // --- Retention ------------------------------------------------------------

  /** The configured windows, creating the settings row on first read. */
  async retentionSettings(): Promise<{ userDays: number; systemDays: number }> {
    const select = { activityRetentionUserDays: true, activityRetentionSystemDays: true } as const;
    let s = await this.prisma.platformSettings.findFirst({ select });
    if (!s) s = await this.prisma.platformSettings.create({ data: {}, select });
    return { userDays: s.activityRetentionUserDays, systemDays: s.activityRetentionSystemDays };
  }

  /**
   * What the log currently holds, and what a purge would remove.
   *
   * Shown on the settings page so a retention window is chosen against real numbers rather than a
   * guess — "this will delete 412,000 rows" is the sort of thing worth knowing before saving.
   */
  async retentionStats() {
    const { userDays, systemDays } = await this.retentionSettings();
    const cut = (days: number) => new Date(Date.now() - days * 86400_000);

    const [total, human, machine, oldest, humanDue, machineDue] = await Promise.all([
      this.prisma.activity.count(),
      this.prisma.activity.count({ where: { source: { in: HUMAN_SOURCES } } }),
      this.prisma.activity.count({ where: { source: { in: MACHINE_SOURCES } } }),
      this.prisma.activity.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.activity.count({ where: { source: { in: HUMAN_SOURCES }, createdAt: { lt: cut(userDays) } } }),
      this.prisma.activity.count({ where: { source: { in: MACHINE_SOURCES }, createdAt: { lt: cut(systemDays) } } }),
    ]);
    return { total, human, machine, oldest: oldest?.createdAt ?? null, userDays, systemDays, dueForPurge: humanDue + machineDue, humanDue, machineDue };
  }

  /**
   * Delete entries past their window. Runs nightly; safe to call by hand.
   *
   * Deletes in batches rather than one statement: the first run against a long backlog could
   * otherwise lock the table for as long as it takes to remove hundreds of thousands of rows, and
   * a retention job that blocks the application is worse than one that has not run yet.
   *
   * A window of 0 means "keep forever" — a retention setting that could be typed to zero and
   * silently empty the whole log would be a trap, not a feature.
   */
  async purge(): Promise<{ human: number; machine: number }> {
    const { userDays, systemDays } = await this.retentionSettings();
    const out = { human: 0, machine: 0 };

    for (const [key, sources, days] of [['human', HUMAN_SOURCES, userDays], ['machine', MACHINE_SOURCES, systemDays]] as const) {
      if (!days || days <= 0) continue;
      const cutoff = new Date(Date.now() - days * 86400_000);
      for (;;) {
        // deleteMany takes no limit, so the batch is selected first and deleted by id.
        const batch = await this.prisma.activity.findMany({
          where: { source: { in: [...sources] }, createdAt: { lt: cutoff } },
          select: { id: true },
          take: PURGE_BATCH,
        });
        if (batch.length === 0) break;
        const r = await this.prisma.activity.deleteMany({ where: { id: { in: batch.map((b) => b.id) } } });
        out[key] += r.count;
        if (batch.length < PURGE_BATCH) break;
      }
    }

    if (out.human || out.machine) {
      this.logger.log(`Activity purge: removed ${out.machine} machine and ${out.human} human entries.`);
    }
    return out;
  }

  /**
   * Nightly at 03:30 — quiet, ahead of the 06:30 channel sync so the two never contend, and off
   * the hour because everything else in the platform runs on it.
   */
  @Cron('30 3 * * *')
  async scheduledPurge() {
    await this.purge().catch((e) => this.logger.error(`Activity purge failed: ${e?.message ?? e}`));
  }
}

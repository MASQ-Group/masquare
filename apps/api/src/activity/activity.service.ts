import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { diffRecords, summariseChanges, type DiffOptions, type FieldChange } from './diff';

export type ActivitySource = 'user' | 'import' | 'sync' | 'system';

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
}

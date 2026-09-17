import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { recipientsFor, type RecipientSpec } from './notification-recipients';

/**
 * Telling people things, inside the platform.
 *
 * Deliberately plain: a row per person, a bell, a list. No websockets and no push — the bell polls,
 * because a notification that arrives within a minute is indistinguishable from an instant one for
 * everything this platform has to say, and a live connection is a thing that breaks quietly at 3am.
 *
 * Like email, raising a notification must never break what raised it. Every failure here is caught
 * and logged: nobody's shipment should fail to file because we could not write a bell.
 */

export interface NotificationInput {
  kind: string;
  title: string;
  body?: string | null;
  /** An in-app path. Never a URL — see the column comment. */
  link?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  /** Repeats with this key are dropped while an unread one is outstanding. */
  dedupeKey?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Raise a notification for whoever the spec names. Returns how many people were told.
   *
   * Never throws.
   */
  async notify(spec: RecipientSpec, input: NotificationInput): Promise<number> {
    try {
      const users = await this.prisma.user.findMany({
        where: { deletedAt: null, status: 'active' },
        select: { id: true, isAdmin: true, status: true, deletedAt: true, accessOverrides: true, role: { select: { grants: true } } },
      });
      const recipients = recipientsFor(spec, users as never);
      if (recipients.length === 0) return 0;

      // A repeat is dropped only while the first is still unread: once somebody has read it, that
      // the thing is STILL happening is news again.
      const alreadyTold = input.dedupeKey
        ? new Set(
          (await this.prisma.notification.findMany({
            where: { dedupeKey: input.dedupeKey, readAt: null, userId: { in: recipients } },
            select: { userId: true },
          })).map((n) => n.userId),
        )
        : new Set<string>();

      const toWrite = recipients.filter((id) => !alreadyTold.has(id));
      if (toWrite.length === 0) return 0;

      await this.prisma.notification.createMany({
        data: toWrite.map((userId) => ({
          userId,
          kind: input.kind,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
          relatedType: input.relatedType ?? null,
          relatedId: input.relatedId ?? null,
          dedupeKey: input.dedupeKey ?? null,
        })),
      });
      return toWrite.length;
    } catch (e) {
      this.logger.error(`Could not raise "${input.kind}": ${(e as Error)?.message ?? e}`);
      return 0;
    }
  }

  /** One person's notifications, unread first, newest first within that. */
  async list(userId: string, params: { limit?: number; unreadOnly?: boolean } = {}) {
    const take = Math.max(1, Math.min(100, Number(params.limit) || 30));
    const items = await this.prisma.notification.findMany({
      where: { userId, ...(params.unreadOnly ? { readAt: null } : {}) },
      orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
      take,
    });
    return { items, unread: await this.unreadCount(userId) };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Mark one as read. Scoped to the owner, so an id from somewhere else changes nothing. */
  async markRead(userId: string, id: string): Promise<{ unread: number }> {
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    return { unread: await this.unreadCount(userId) };
  }

  async markAllRead(userId: string): Promise<{ unread: number; marked: number }> {
    const { count } = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { unread: 0, marked: count };
  }
}

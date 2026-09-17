import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { NoAccessCheck } from '../access/access.decorators';
import { NotificationsService } from './notifications.service';

/**
 * A person's own notifications.
 *
 * No access area, and none is missing: these belong to whoever is signed in, and every query is
 * scoped to them. There is no route here that can reach anybody else's, which is why the area check
 * is declared absent rather than left off by accident.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
@NoAccessCheck()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('unread') unread?: string) {
    return this.notifications.list(user.sub, { limit: limit ? Number(limit) : undefined, unreadOnly: unread === 'true' });
  }

  /** Just the badge. Polled, so it is kept to a count. */
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser) {
    return { unread: await this.notifications.unreadCount(user.sub) };
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.sub);
  }
}

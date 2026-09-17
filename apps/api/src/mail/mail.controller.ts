import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccessArea } from '../access/access.decorators';
import { MailService } from './mail.service';

/**
 * How the platform sends email, and what it has sent.
 *
 * Admin-only throughout, and for a stronger reason than most settings: whoever holds this chooses
 * the address the platform speaks as. A message from our own domain is believed, so being able to
 * change where it comes from is close to being able to write in somebody else's name.
 */
@ApiTags('email')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('email')
@AccessArea('global_settings')
export class MailController {
  constructor(private readonly mail: MailService) {}

  /** The configuration, without the key — only whether one is held, and which. */
  @Get('settings')
  settings() {
    return this.mail.settings();
  }

  @Put('settings')
  save(
    @Body() dto: { senderAddress?: string | null; senderName?: string | null; replyTo?: string | null; enabled?: boolean; serviceAccountJson?: string | null },
    @CurrentUser() user: AuthUser,
  ) {
    return this.mail.saveSettings(dto ?? {}, user.sub);
  }

  /** Send a real message, to prove the configuration works before anything depends on it. */
  @Post('settings/test')
  test(@Body() body: { to: string }, @CurrentUser() user: AuthUser) {
    return this.mail.sendTest((body?.to ?? '').trim(), user.sub);
  }

  /** What has been sent, and what failed. Read-only. */
  @Get('messages')
  messages(@Query('limit') limit?: string, @Query('status') status?: string) {
    return this.mail.history({ limit: limit ? Number(limit) : undefined, status: status?.trim() || undefined });
  }
}

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { INVITE_REFUSALS, createInviteToken, expiryFrom, hashToken, inviteState, passwordProblems } from './invite-token';

/**
 * The people at a customer who sign in to the portal.
 *
 * They are ordinary User rows with one column set — `customerId` — and that column is the whole
 * boundary: the guard refuses them everywhere in the platform, and every portal query will be scoped
 * to it. Reusing User rather than inventing a second kind of account means one sign-in, one password
 * rule, one session, and no second implementation of any of it to drift.
 *
 * Nobody here ever sets somebody else's password. The account is created unusable and an invitation
 * is emailed; the person chooses their own. An admin who types a password has to say it out loud.
 */

/** Where the invitation link points. The portal is served by the web app, at its own path. */
const INVITE_PATH = '/portal/set-password';

@Injectable()
export class CustomerUsersService {
  private readonly logger = new Logger(CustomerUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async list(customerId: string) {
    await this.assertCustomer(customerId);
    const users = await this.prisma.user.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { fullName: 'asc' },
      select: {
        id: true, fullName: true, email: true, status: true, createdAt: true,
        invites: { orderBy: { createdAt: 'desc' }, take: 1, select: { expiresAt: true, usedAt: true, createdAt: true } },
      },
    });
    return users.map((u) => {
      const invite = u.invites[0];
      return {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        status: u.status,
        createdAt: u.createdAt,
        /**
         * Where this person is in getting started, which is the question actually asked of this
         * list: nobody wonders whether a row exists, they wonder whether the person can sign in.
         */
        invite: invite
          ? { state: inviteState(invite), sentAt: invite.createdAt, expiresAt: invite.expiresAt }
          : null,
      };
    });
  }

  /**
   * Create a portal login and email the invitation.
   *
   * The account exists whether or not the email goes out — the invitation can be sent again, and an
   * account that failed to be created because a mailbox was full would be worse than one waiting to
   * be invited. The caller is told which happened.
   */
  async create(customerId: string, dto: { fullName?: string; email?: string }, actorId?: string) {
    const customer = await this.assertCustomer(customerId);
    const fullName = (dto.fullName ?? '').trim();
    const email = (dto.email ?? '').trim().toLowerCase();
    if (!fullName) throw new BadRequestException('A name is required.');
    if (!email || !email.includes('@')) throw new BadRequestException('A valid email address is required.');

    const taken = await this.prisma.user.findUnique({ where: { email }, select: { id: true, customerId: true, deletedAt: true } });
    if (taken && !taken.deletedAt) {
      throw new ConflictException(
        taken.customerId
          ? 'Somebody with that email address already has a portal login.'
          : 'That email address belongs to a platform user. A person cannot be both.',
      );
    }

    const role = await this.prisma.role.findUnique({ where: { key: 'logistics_customer' }, select: { id: true } });

    const user = await this.prisma.user.create({
      data: {
        fullName,
        email,
        // Unusable until they set their own through the invitation: random, never shown, never kept.
        passwordHash: await bcrypt.hash(randomBytes(32).toString('base64'), 10),
        customerId,
        roleId: role?.id ?? null,
        status: 'active',
        createdById: actorId ?? null,
      },
      select: { id: true, fullName: true, email: true },
    });

    const sent = await this.sendInvite(user.id, actorId);
    return { user, invite: sent };
  }

  /** Send (or resend) the invitation. A new one supersedes any outstanding link. */
  async invite(customerId: string, userId: string, actorId?: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, customerId, deletedAt: null }, select: { id: true } });
    if (!user) throw new NotFoundException('That person is not one of this customer’s users.');
    return this.sendInvite(userId, actorId);
  }

  async update(customerId: string, userId: string, dto: { fullName?: string; status?: string }) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, customerId, deletedAt: null }, select: { id: true } });
    if (!user) throw new NotFoundException('That person is not one of this customer’s users.');
    /**
     * Narrowed to the two values the column accepts, and the payload typed outright.
     *
     * `['active','disabled'].includes(x)` proves nothing to the type checker — it leaves `string`,
     * which an enum column refuses. Inside an inline spread that mismatch went unnoticed by one
     * compiler and was caught by another; naming the type means it is caught by every one.
     */
    const status = dto.status === 'active' || dto.status === 'disabled' ? dto.status : undefined;
    const data: Prisma.UserUpdateInput = {
      ...(dto.fullName !== undefined ? { fullName: (dto.fullName ?? '').trim() || undefined } : {}),
      ...(status ? { status } : {}),
    };
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.list(customerId);
  }

  async remove(customerId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, customerId, deletedAt: null }, select: { id: true } });
    if (!user) throw new NotFoundException('That person is not one of this customer’s users.');
    // Soft, and disabled with it: the row is referenced by whatever they filed, and a deleted user
    // who could still sign in would be the worst of both.
    await this.prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date(), status: 'disabled' } });
    return this.list(customerId);
  }

  // ── the invitation itself ────────────────────────────────────────────────────────────────────

  /** What an invitation link is worth, for the page the recipient lands on. */
  async describeInvite(token: string) {
    const invite = await this.prisma.userInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        expiresAt: true, usedAt: true,
        user: { select: { id: true, fullName: true, email: true, deletedAt: true, status: true, customer: { select: { name: true, active: true } } } },
      },
    });
    // The same answer for a token that never existed as for one that has been tampered with: there
    // is nothing useful to say about an invitation we have no record of.
    if (!invite || invite.user.deletedAt) return { ok: false as const, reason: 'This invitation is not valid. Ask your contact to send a new one.' };

    const state = inviteState(invite);
    if (state !== 'valid') return { ok: false as const, reason: INVITE_REFUSALS[state] };
    if (invite.user.status !== 'active' || invite.user.customer?.active === false) {
      return { ok: false as const, reason: 'This account is not active. Ask your contact at maSquare.' };
    }
    return { ok: true as const, fullName: invite.user.fullName, email: invite.user.email, customerName: invite.user.customer?.name ?? null };
  }

  /** Set the password an invitation was for. One link, one password. */
  async acceptInvite(token: string, password: string) {
    const problems = passwordProblems(password);
    if (problems.length) throw new BadRequestException(problems.join(' '));

    const invite = await this.prisma.userInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, expiresAt: true, usedAt: true, user: { select: { id: true, deletedAt: true, status: true } } },
    });
    if (!invite || invite.user.deletedAt) throw new BadRequestException('This invitation is not valid. Ask your contact to send a new one.');
    const state = inviteState(invite);
    if (state !== 'valid') throw new BadRequestException(INVITE_REFUSALS[state]);
    if (invite.user.status !== 'active') throw new BadRequestException('This account is not active. Ask your contact at maSquare.');

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: invite.user.id }, data: { passwordHash: await bcrypt.hash(password, 10) } }),
      this.prisma.userInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } }),
      // Any other outstanding invitation for this person is spent too: a second link that still
      // worked would be a second way in, long after they had chosen a password.
      this.prisma.userInvite.updateMany({ where: { userId: invite.user.id, usedAt: null }, data: { usedAt: new Date() } }),
    ]);
    return { ok: true };
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  private async sendInvite(userId: string, actorId?: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, fullName: true, email: true, customer: { select: { name: true } } },
    });
    if (!user) throw new NotFoundException('User not found');

    const { token, tokenHash } = createInviteToken();
    const expiresAt = expiryFrom(new Date());
    await this.prisma.userInvite.create({ data: { userId, tokenHash, expiresAt, createdById: actorId ?? null } });

    const base = appBaseUrl();
    if (!base) {
      this.logger.warn('No APP_BASE_URL or CORS_ORIGINS, so no invitation link could be built.');
      return { sent: false, message: 'The account was created, but the platform does not know its own web address, so no invitation could be sent. Set APP_BASE_URL and send it again.' };
    }
    const link = `${base}${INVITE_PATH}?token=${encodeURIComponent(token)}`;

    const result = await this.mail.send({
      to: user.email,
      subject: 'Your maSquare shipments login',
      text: [
        `Hello ${user.fullName},`,
        '',
        `You have been given access to file and follow ${user.customer?.name ?? 'your company'}’s shipments with maSquare.`,
        '',
        'Choose your password here:',
        link,
        '',
        'The link is good for seven days. If it expires, ask your contact to send another.',
      ].join('\n'),
      kind: 'invite',
      relatedType: 'user',
      relatedId: user.id,
      actorId,
    });

    return result.ok
      ? { sent: true, message: `Invitation sent to ${user.email}.` }
      : { sent: false, message: `The account is ready, but the invitation could not be sent: ${result.error}` };
  }

  private async assertCustomer(customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: { id: true, name: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}

/**
 * Where the web app lives, for a link somebody has to click.
 *
 * `APP_BASE_URL` when it is set; otherwise the first allowed CORS origin, which IS the web app by
 * definition — the alternative was a second variable saying the same thing, kept in step by hand.
 */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = (env.APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const first = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  return first ? first.replace(/\/+$/, '') : null;
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { GMAIL_SEND_SCOPE, JWT_BEARER_GRANT, TOKEN_URL, buildAssertion, readServiceAccountKey } from './google-jwt';
import { encodeForGmail, isSendableAddress } from './mime-message';
import { describeGoogleFailure } from './google-error';

/**
 * Sending email, through the Workspace mailbox the platform is configured to act as.
 *
 * One rule shapes everything here: sending must never break the thing that wanted to send. An
 * invitation that fails is a person who has to be told their password another way; a notification
 * that fails is a tab somebody opens anyway. Neither is worth an exception thrown into the middle of
 * creating a user or filing a shipment — so `send` reports rather than throws, and every attempt is
 * recorded whether it worked or not.
 *
 * The exception is the test send, which exists precisely to fail loudly.
 */

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
/** Refreshed a minute early, so a token never expires between being chosen and being used. */
const TOKEN_SAFETY_SECONDS = 60;

export interface SendInput {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  /** test | invite | notification — what this message is for, for the log. */
  kind?: string;
  relatedType?: string | null;
  relatedId?: string | null;
  actorId?: string | null;
}

export type SendResult = { ok: true; id: string; providerMessageId: string | null } | { ok: false; id: string; error: string };

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  /** One token per mailbox we act as. In memory: a token outlives neither a deploy nor its hour. */
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ── configuration ────────────────────────────────────────────────────────────────────────────

  /** The settings row, created empty on first read. Never includes the private key. */
  async settings() {
    const existing = await this.prisma.emailSettings.findFirst();
    const row = existing ?? (await this.prisma.emailSettings.create({ data: {} }));
    const { privateKeyCiphertext, privateKeyIv, privateKeyAuthTag, privateKeyVersion, ...rest } = row;
    return { ...rest, hasKey: !!privateKeyCiphertext };
  }

  /**
   * Save the configuration, and the key with it.
   *
   * The key arrives as the whole JSON file rather than as separate fields: it is what Google hands
   * you, copying two values out of it by hand is a step that can go wrong, and the file itself says
   * which service account it belongs to.
   */
  async saveSettings(
    dto: { senderAddress?: string | null; senderName?: string | null; replyTo?: string | null; enabled?: boolean; serviceAccountJson?: string | null },
    actorId?: string,
  ) {
    const current = await this.prisma.emailSettings.findFirst();
    const id = current?.id ?? (await this.prisma.emailSettings.create({ data: {} })).id;

    const data: Record<string, unknown> = { updatedById: actorId ?? null };
    if (dto.senderAddress !== undefined) {
      const address = (dto.senderAddress ?? '').trim();
      if (address && !isSendableAddress(address)) throw new BadRequestException('That sender address is not a valid email address.');
      data.senderAddress = address || null;
    }
    if (dto.senderName !== undefined) data.senderName = (dto.senderName ?? '').trim() || 'maSquare';
    if (dto.replyTo !== undefined) {
      const reply = (dto.replyTo ?? '').trim();
      if (reply && !isSendableAddress(reply)) throw new BadRequestException('That reply-to address is not a valid email address.');
      data.replyTo = reply || null;
    }

    if (dto.serviceAccountJson) {
      const key = readServiceAccountKey(dto.serviceAccountJson);
      if (!key.ok) throw new BadRequestException(key.reason);
      const sealed = this.crypto.encrypt(key.privateKey);
      Object.assign(data, {
        clientEmail: key.clientEmail,
        keyId: key.keyId,
        privateKeyCiphertext: sealed.ciphertext,
        privateKeyIv: sealed.iv,
        privateKeyAuthTag: sealed.authTag,
        privateKeyVersion: sealed.keyVersion,
        keyLoadedAt: new Date(),
      });
      // A new key invalidates a token minted with the old one.
      this.tokens.clear();
    }

    if (dto.enabled !== undefined) {
      const after = { ...current, ...data } as { senderAddress?: string | null; privateKeyCiphertext?: string | null };
      // Refused rather than saved and quietly ineffective: "on" with nothing to send through is a
      // switch that lies.
      if (dto.enabled && (!after.senderAddress || !after.privateKeyCiphertext)) {
        throw new BadRequestException('Add the sender address and the service account key before switching sending on.');
      }
      data.enabled = dto.enabled;
    }

    await this.prisma.emailSettings.update({ where: { id }, data });
    return this.settings();
  }

  // ── sending ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Send a message, and record the attempt.
   *
   * Returns a result rather than throwing: see the note at the top. `force` is for the test send,
   * which must work before sending is switched on.
   */
  async send(input: SendInput, opts: { force?: boolean } = {}): Promise<SendResult> {
    const row = await this.prisma.emailMessage.create({
      data: {
        toAddress: input.to,
        subject: input.subject,
        bodyText: input.text,
        kind: input.kind ?? 'notification',
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        createdById: input.actorId ?? null,
      },
      select: { id: true },
    });
    const fail = async (error: string): Promise<SendResult> => {
      await this.prisma.emailMessage.update({ where: { id: row.id }, data: { status: 'failed', error: error.slice(0, 1000) } });
      this.logger.warn(`Email to ${input.to} failed: ${error.split('\n')[0].slice(0, 200)}`);
      return { ok: false, id: row.id, error };
    };

    if (!isSendableAddress(input.to)) return fail(`"${input.to}" is not an address this can send to.`);

    const config = await this.prisma.emailSettings.findFirst();
    if (!config?.senderAddress || !config.privateKeyCiphertext || !config.clientEmail) {
      return fail('Email is not configured yet — add the sender address and the service account key in Settings.');
    }
    if (!config.enabled && !opts.force) {
      return fail('Email sending is switched off in Settings, so nothing was sent.');
    }

    let token: string;
    try {
      token = await this.accessToken(config);
    } catch (e) {
      return fail((e as Error).message);
    }

    const raw = encodeForGmail({
      fromAddress: config.senderAddress,
      fromName: config.senderName,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? null,
      replyTo: config.replyTo,
    });

    let res: Response;
    try {
      res = await fetch(GMAIL_SEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      return fail((e as Error)?.name === 'TimeoutError' ? 'Gmail did not answer in time.' : 'Could not reach Gmail.');
    }

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return fail(describeGoogleFailure(res.status, body, { senderAddress: config.senderAddress, clientEmail: config.clientEmail }));
    }

    const providerMessageId = (body as any)?.id ?? null;
    await this.prisma.emailMessage.update({
      where: { id: row.id },
      data: { status: 'sent', sentAt: new Date(), providerMessageId },
    });
    return { ok: true, id: row.id, providerMessageId };
  }

  /**
   * Send a message to prove the configuration works, and record the verdict on the settings row.
   *
   * Ignores the on/off switch on purpose: the test is how you find out whether it is safe to switch
   * on, and a test that needs sending to be on already would be useless.
   */
  async sendTest(to: string, actorId?: string) {
    const result = await this.send(
      {
        to,
        subject: 'maSquare test message',
        text: [
          'This is a test from maSquare.',
          '',
          'If you are reading it, the platform can send email through your Google Workspace account.',
        ].join('\n'),
        kind: 'test',
        actorId,
      },
      { force: true },
    );

    const config = await this.prisma.emailSettings.findFirst({ select: { id: true } });
    if (config) {
      await this.prisma.emailSettings.update({
        where: { id: config.id },
        data: {
          lastTestStatus: result.ok ? 'ok' : 'failed',
          lastTestMessage: result.ok ? `Sent to ${to}` : result.error.slice(0, 1000),
          lastTestedAt: new Date(),
        },
      });
    }
    return result.ok ? { ok: true as const, message: `Sent to ${to}. Check the inbox — and the spam folder if it is not there.` } : { ok: false as const, message: result.error };
  }

  /** The messages the platform has tried to send, newest first. */
  async history(params: { limit?: number; status?: string } = {}) {
    const take = Math.max(1, Math.min(200, Number(params.limit) || 50));
    return this.prisma.emailMessage.findMany({
      where: params.status ? { status: params.status } : {},
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, toAddress: true, subject: true, kind: true, status: true, error: true, sentAt: true, createdAt: true },
    });
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  /** A token for the configured mailbox, minted when there isn't a good one already. */
  private async accessToken(config: {
    clientEmail: string | null;
    senderAddress: string | null;
    privateKeyCiphertext: string | null;
    privateKeyIv: string | null;
    privateKeyAuthTag: string | null;
    privateKeyVersion: number | null;
  }): Promise<string> {
    const key = `${config.clientEmail}|${config.senderAddress}`;
    const held = this.tokens.get(key);
    if (held && held.expiresAt > Date.now()) return held.token;

    const privateKeyPem = this.crypto.decrypt({
      ciphertext: config.privateKeyCiphertext as string,
      iv: config.privateKeyIv as string,
      authTag: config.privateKeyAuthTag as string,
      keyVersion: config.privateKeyVersion as number,
    });

    const assertion = buildAssertion({
      clientEmail: config.clientEmail as string,
      subject: config.senderAddress as string,
      privateKeyPem,
      scope: GMAIL_SEND_SCOPE,
    });

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !(body as any)?.access_token) {
      throw new Error(describeGoogleFailure(res.status, body, { senderAddress: config.senderAddress, clientEmail: config.clientEmail }));
    }

    const token = (body as any).access_token as string;
    const expiresIn = Number((body as any).expires_in) || 3600;
    this.tokens.set(key, { token, expiresAt: Date.now() + (expiresIn - TOKEN_SAFETY_SECONDS) * 1000 });
    return token;
  }
}

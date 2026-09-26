import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { RequestHandler, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { PrismaService } from '../../prisma/prisma.service';
import { jwtSecret } from '../../config/secrets';
import type { AuthUser } from '../../common/current-user.decorator';
import {
  ACCESS_TOKEN_SECONDS,
  CODE_SECONDS,
  LOGIN_PAGE_SECONDS,
  oauthSigningKey,
  readOAuthConfig,
  redirectAllowed,
  REFRESH_TOKEN_SECONDS,
  type OAuthConfig,
} from './oauth-config';
import { loginPageHeaders, renderLoginPage } from './login-page';
import { LoginThrottle } from './login-throttle';

/** Where the sign-in form posts, under the API's global prefix. */
export const LOGIN_PATH = '/api/mcp/oauth/login';

/** What the sign-in form's submission leads to: back to the app, or the page again. */
export type LoginOutcome =
  | { kind: 'redirect'; url: string }
  | { kind: 'page'; status: number; headers: Record<string, string>; html: string };

interface PendingClaims {
  typ: 'mcp-pending';
  cid: string;
  ru: string;
  cc: string;
  st?: string;
  rs?: string;
}

interface AccessClaims {
  typ: 'mcp-access';
  sub: string;
  cid: string;
  exp: number;
}

/** A bcrypt hash of nothing anyone knows, compared against when no account matched, so a missing
 *  account takes as long to refuse as a wrong password and timing does not reveal which it was. */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

const SIGN_IN_REFUSED =
  'That did not work. Check the email and password. Administrator accounts, and accounts not allowed to connect, cannot sign in here.';

/**
 * The connector's sign-in: an OAuth 2.1 authorization server for the maSquare connector, so Claude
 * on claude.ai can connect with a person's own maSquare account instead of a shared fixed token.
 *
 * The MCP SDK provides the protocol endpoints (metadata, registration, /authorize, /token, /revoke)
 * and checks PKCE; this class supplies what they need from maSquare — who the apps are, who may
 * sign in, and the codes and tokens. See `oauth-config.ts` for who may sign in and why.
 *
 * Every token is re-checked against the account on use, so disabling a user, making them an admin
 * or removing them from MCP_OAUTH_ALLOWED_EMAILS cuts the connector off at their next request.
 */
@Injectable()
export class McpOAuthService implements OAuthServerProvider {
  private readonly logger = new Logger(McpOAuthService.name);
  readonly config: OAuthConfig = readOAuthConfig(process.env);
  private readonly jwt = new JwtService({ secret: oauthSigningKey(jwtSecret()) });
  private readonly throttle = new LoginThrottle();

  constructor(private readonly prisma: PrismaService) {
    if (!this.config.enabled && this.config.reason) this.logger.warn(this.config.reason);
  }

  /** The SDK's OAuth endpoints, to mount at the application root; null while sign-in is off. */
  router(): RequestHandler | null {
    if (!this.config.enabled) return null;
    return mcpAuthRouter({
      provider: this,
      issuerUrl: this.config.issuer,
      resourceServerUrl: this.config.resource,
      resourceName: 'maSquare',
    });
  }

  /** Where a client that was refused can learn how to sign in, for the WWW-Authenticate header. */
  resourceMetadataUrl(): string | null {
    return this.config.enabled ? getOAuthProtectedResourceMetadataUrl(this.config.resource) : null;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => {
        const row = await this.prisma.mcpOAuthClient.findUnique({ where: { clientId } });
        return row ? (row.info as unknown as OAuthClientInformationFull) : undefined;
      },
      registerClient: async (client) => {
        const cfg = this.requireConfig();
        const refused = client.redirect_uris.filter((u) => !redirectAllowed(String(u), cfg.redirectHosts));
        if (refused.length > 0) {
          // Only Claude, and local apps on the person's own computer, may collect codes.
          throw new InvalidClientMetadataError(`Redirect address not allowed: ${refused.join(', ')}`);
        }
        const full = client as OAuthClientInformationFull;
        await this.prisma.mcpOAuthClient.create({
          data: { clientId: full.client_id, info: JSON.parse(JSON.stringify(full)) },
        });
        return full;
      },
    };
  }

  /** Shows the sign-in page. The request itself travels inside a signed, short-lived value. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const cfg = this.requireConfig();
    if (params.resource && !sameResource(params.resource, cfg.resource)) {
      throw new InvalidTargetError('This sign-in is for the maSquare connector only.');
    }
    const claims: PendingClaims = {
      typ: 'mcp-pending',
      cid: client.client_id,
      ru: params.redirectUri,
      cc: params.codeChallenge,
      st: params.state,
      rs: params.resource?.href,
    };
    const pending = this.jwt.sign(claims, { expiresIn: LOGIN_PAGE_SECONDS, audience: this.loginAudience(cfg) });
    res
      .status(200)
      .set(loginPageHeaders(params.redirectUri))
      .send(renderLoginPage({
        clientName: client.client_name || 'An app',
        pending,
        action: LOGIN_PATH,
        cancelUrl: withParams(params.redirectUri, { error: 'access_denied', state: params.state }),
      }));
  }

  /** The sign-in form was submitted: check the person, then send them back to the app with a code. */
  async completeLogin(form: { pending?: unknown; email?: unknown; password?: unknown }): Promise<LoginOutcome> {
    const cfg = this.requireConfig();
    const expired: LoginOutcome = {
      kind: 'page',
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      html: 'This sign-in page has expired or is not valid. Go back to Claude and connect again.',
    };

    let claims: PendingClaims;
    try {
      claims = this.jwt.verify<PendingClaims>(String(form.pending ?? ''), { audience: this.loginAudience(cfg) });
    } catch {
      return expired;
    }
    if (claims.typ !== 'mcp-pending') return expired;
    const client = await this.clientsStore.getClient(claims.cid);
    if (!client) return expired;

    const email = String(form.email ?? '').trim().toLowerCase();
    const password = String(form.password ?? '');
    const again = (message: string, status: number): LoginOutcome => ({
      kind: 'page',
      status,
      headers: loginPageHeaders(claims.ru),
      html: renderLoginPage({
        clientName: client.client_name || 'An app',
        pending: String(form.pending),
        action: LOGIN_PATH,
        cancelUrl: withParams(claims.ru, { error: 'access_denied', state: claims.st }),
        email,
        error: message,
      }),
    });

    if (!email || !password) return again('Enter your email and password.', 400);
    if (!this.throttle.allow(email)) {
      return again('Too many attempts for this account. Wait 15 minutes and try again.', 429);
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    const actor = user && passwordOk ? await this.allowedUser(user.id) : null;
    if (!actor) {
      this.throttle.fail(email);
      this.logger.warn(`Connector sign-in refused for ${email}`);
      return again(SIGN_IN_REFUSED, 401);
    }
    this.throttle.succeed(email);

    const code = randomToken();
    await this.prisma.mcpOAuthCode.create({
      data: {
        codeHash: hash(code),
        clientId: claims.cid,
        userId: actor.sub,
        codeChallenge: claims.cc,
        redirectUri: claims.ru,
        resource: claims.rs ?? null,
        expiresAt: new Date(Date.now() + CODE_SECONDS * 1000),
      },
    });
    this.logger.log(`Connector signed in as ${actor.email} for ${client.client_name || claims.cid}`);
    return { kind: 'redirect', url: withParams(claims.ru, { code, state: claims.st }) };
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    const row = await this.prisma.mcpOAuthCode.findUnique({ where: { codeHash: hash(code) } });
    if (!row || row.clientId !== client.client_id) throw new InvalidGrantError('Unknown sign-in code.');
    return row.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const cfg = this.requireConfig();
    const codeHash = hash(code);
    // Claimed in one statement, so two exchanges of the same code cannot both succeed.
    const claimed = await this.prisma.mcpOAuthCode.updateMany({
      where: { codeHash, clientId: client.client_id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new InvalidGrantError('The sign-in code is not valid, has expired or was already used.');

    const row = await this.prisma.mcpOAuthCode.findUniqueOrThrow({ where: { codeHash } });
    if (redirectUri && redirectUri !== row.redirectUri) throw new InvalidGrantError('Redirect address does not match.');
    if (resource && !sameResource(resource, cfg.resource)) throw new InvalidTargetError('Wrong resource.');

    const actor = await this.allowedUser(row.userId);
    if (!actor) throw new InvalidGrantError('This account may no longer connect.');
    return this.issueTokens(client.client_id, actor.sub, cfg);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const cfg = this.requireConfig();
    if (resource && !sameResource(resource, cfg.resource)) throw new InvalidTargetError('Wrong resource.');
    const tokenHash = hash(refreshToken);

    const claimed = await this.prisma.mcpOAuthRefreshToken.updateMany({
      where: { tokenHash, clientId: client.client_id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    const row = await this.prisma.mcpOAuthRefreshToken.findUnique({ where: { tokenHash } });
    if (claimed.count !== 1) {
      if (row && row.clientId === client.client_id && row.revokedAt) {
        // A refresh token is replaced on every use, so one coming back means a copy exists somewhere
        // it should not. End every sign-in this app holds for that person; they sign in again.
        await this.prisma.mcpOAuthRefreshToken.updateMany({
          where: { userId: row.userId, clientId: row.clientId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        this.logger.warn(`A used connector refresh token came back; signed that user out of ${row.clientId}`);
      }
      throw new InvalidGrantError('The refresh token is not valid, has expired or was already used.');
    }

    const actor = await this.allowedUser(row!.userId);
    if (!actor) throw new InvalidGrantError('This account may no longer connect.');
    return this.issueTokens(client.client_id, actor.sub, cfg);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const cfg = this.requireConfig();
    let claims: AccessClaims;
    try {
      claims = this.jwt.verify<AccessClaims>(token, { audience: cfg.resource.href });
    } catch {
      throw new InvalidTokenError('The access token is not valid or has expired.');
    }
    if (claims.typ !== 'mcp-access') throw new InvalidTokenError('Not a connector access token.');
    return {
      token,
      clientId: claims.cid,
      scopes: [],
      expiresAt: claims.exp,
      resource: cfg.resource,
      extra: { userId: claims.sub },
    };
  }

  /** Only refresh tokens can be revoked; access tokens are short-lived and expire on their own. */
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this.prisma.mcpOAuthRefreshToken.updateMany({
      where: { tokenHash: hash(request.token), clientId: client.client_id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * The account a connector token acts as, if it may still connect: active, not an administrator,
   * not a logistics customer's portal account, and named in MCP_OAUTH_ALLOWED_EMAILS. Checked at
   * sign-in and again on every request.
   */
  async allowedUser(userId: string): Promise<AuthUser | null> {
    if (!this.config.enabled) return null;
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: 'active' },
      select: { id: true, email: true, isAdmin: true, customerId: true },
    });
    if (!user || user.isAdmin || user.customerId) return null;
    if (!this.config.allowedEmails.has(user.email.toLowerCase())) return null;
    return { sub: user.id, email: user.email, isAdmin: false };
  }

  private async issueTokens(clientId: string, userId: string, cfg: Extract<OAuthConfig, { enabled: true }>): Promise<OAuthTokens> {
    const access = this.jwt.sign(
      { typ: 'mcp-access', sub: userId, cid: clientId },
      { expiresIn: ACCESS_TOKEN_SECONDS, audience: cfg.resource.href },
    );
    const refresh = randomToken();
    await this.prisma.mcpOAuthRefreshToken.create({
      data: {
        tokenHash: hash(refresh),
        clientId,
        userId,
        resource: cfg.resource.href,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000),
      },
    });
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refresh };
  }

  private requireConfig(): Extract<OAuthConfig, { enabled: true }> {
    if (!this.config.enabled) throw new Error('Connector sign-in is not enabled.');
    return this.config;
  }

  private loginAudience(cfg: Extract<OAuthConfig, { enabled: true }>): string {
    return new URL(LOGIN_PATH, cfg.issuer).href;
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function sameResource(a: URL, b: URL): boolean {
  const strip = (u: URL) => u.href.replace(/\/+$/, '');
  return strip(a) === strip(b);
}

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.href;
}

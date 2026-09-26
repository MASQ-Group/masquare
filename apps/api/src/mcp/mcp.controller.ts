import { Controller, Delete, Get, Logger, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Public } from '../auth/public.decorator';
import { NoAccessCheck } from '../access/access.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyScopeService } from '../common/company-scope';
import { EbayListingService } from '../listing/ebay/ebay-listing.service';
import { OnbuyContentService } from '../listing/onbuy/onbuy-content.service';
import { ProductContentService } from '../listing/product-content.service';
import type { AuthUser } from '../common/current-user.decorator';
import { matchCredential, readMcpConfig } from './mcp-auth';
import { buildMasquareServer } from './mcp-tools';
import { McpOAuthService } from './oauth/mcp-oauth.service';

/**
 * The maSquare connector's HTTP endpoint: `POST /api/mcp`.
 *
 * Speaks MCP over Streamable HTTP, in STATELESS mode: every request builds its own server and
 * transport and throws them away afterwards. Nothing is held between calls, so there is no session
 * to hijack, nothing to leak between users, and a restart or a second instance changes nothing.
 * Responses are plain JSON rather than a stream, since no tool here reports progress.
 *
 * `@Public()` and `@NoAccessCheck()` switch off the platform's own login and permission guards, which
 * expect a maSquare browser session. That is not the same as no authentication: this controller
 * checks the connector's bearer token itself, on every request, before anything else happens — and
 * acts as the user that token names (the everyday user, or the owner for the owner token), whose
 * ordinary company grants still decide what it may reach.
 *
 * Imported from the SDK's CommonJS build by way of a `paths` entry in tsconfig: this API resolves
 * modules the older "node" way, which cannot read the SDK's `exports` map. The emitted require keeps
 * the documented specifier, which Node resolves correctly at runtime.
 */
@ApiExcludeController()
@Controller('mcp')
@Public()
@NoAccessCheck()
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CompanyScopeService,
    private readonly listing: EbayListingService,
    private readonly onbuy: OnbuyContentService,
    /** Every channel at once: one brief, and the words kept for the product rather than a channel. */
    private readonly content: ProductContentService,
    /** Sign-in for claude.ai, when configured: a second way in beside the fixed tokens. */
    private readonly oauth: McpOAuthService,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const config = readMcpConfig(process.env);
    const oauthOn = this.oauth.config.enabled;
    if (!config.enabled && !oauthOn) {
      // The operator learns why from the log; a caller learns only that there is nothing here.
      this.logger.warn(`Connector request refused: ${config.reason}`);
      res.status(404).json(rpcError(-32001, 'Not found'));
      return;
    }

    let actor: AuthUser | null = null;
    const credential = config.enabled ? matchCredential(req.headers.authorization, config.credentials) : null;
    if (config.enabled) for (const w of config.warnings) this.logger.warn(`Connector configuration: ${w}`);

    if (credential) {
      actor = await this.actingUser(credential.userEmail);
      if (!actor) {
        const setting = credential.kind === 'admin' ? 'MCP_ADMIN_USER_EMAIL' : 'MCP_USER_EMAIL';
        this.logger.error(`${setting} does not name an active maSquare user, so the connector cannot act.`);
        res.status(403).json(rpcError(-32001, 'The connector is not linked to an active maSquare user.'));
        return;
      }
    } else if (oauthOn) {
      // Not a fixed token, so perhaps a sign-in token; re-checked against the account every time.
      actor = await this.signedInUser(req.headers.authorization);
    }

    if (!actor) {
      this.logger.warn(`Connector request with a missing or wrong token from ${req.ip}`);
      // Tells a client that supports sign-in where to find out how, which is how claude.ai starts it.
      const metadata = this.oauth.resourceMetadataUrl();
      const challenge = metadata ? `Bearer resource_metadata="${metadata}"` : 'Bearer';
      res.status(401).setHeader('WWW-Authenticate', challenge).json(rpcError(-32001, 'Unauthorized'));
      return;
    }

    const server = buildMasquareServer(
      { listing: this.listing, onbuy: this.onbuy, content: this.content, scope: this.scope, prisma: this.prisma },
      actor,
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

    // Both are per-request; closing them when the response ends is what keeps the endpoint stateless.
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      this.logger.error(`Connector request failed: ${(e as Error)?.message ?? e}`, (e as Error)?.stack);
      if (!res.headersSent) res.status(500).json(rpcError(-32603, 'Internal error'));
    }
  }

  /**
   * Stateless mode has no server-initiated stream to open and no session to end, so the other two
   * methods the transport defines are refused outright rather than half-supported.
   */
  @Get()
  get(@Res() res: Response): void {
    res.status(405).setHeader('Allow', 'POST').json(rpcError(-32000, 'Method not allowed'));
  }

  @Delete()
  remove(@Res() res: Response): void {
    res.status(405).setHeader('Allow', 'POST').json(rpcError(-32000, 'Method not allowed'));
  }

  /** The account a sign-in token acts as, or null if the token is not one or may no longer connect. */
  private async signedInUser(header: string | undefined): Promise<AuthUser | null> {
    const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
    if (!match) return null;
    try {
      const info = await this.oauth.verifyAccessToken(match[1].trim());
      return await this.oauth.allowedUser(String(info.extra?.userId ?? ''));
    } catch {
      return null;
    }
  }

  /**
   * The maSquare user the connector acts as — looked up on every request, so suspending or deleting
   * that user closes the connector immediately, with nothing cached to outlive the change.
   */
  private async actingUser(email: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null, status: 'active' },
      select: { id: true, email: true, isAdmin: true },
    });
    return user ? { sub: user.id, email: user.email, isAdmin: user.isAdmin } : null;
  }
}

function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

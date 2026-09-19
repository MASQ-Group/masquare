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
import type { AuthUser } from '../common/current-user.decorator';
import { bearerMatches, readMcpConfig } from './mcp-auth';
import { buildMasquareServer } from './mcp-tools';

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
 * acts as one named user whose ordinary company grants still decide what it may reach.
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
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const config = readMcpConfig(process.env);
    if (!config.enabled) {
      // The operator learns why from the log; a caller learns only that there is nothing here.
      this.logger.warn(`Connector request refused: ${config.reason}`);
      res.status(404).json(rpcError(-32001, 'Not found'));
      return;
    }

    if (!bearerMatches(req.headers.authorization, config.token)) {
      this.logger.warn(`Connector request with a missing or wrong token from ${req.ip}`);
      res.status(401).setHeader('WWW-Authenticate', 'Bearer').json(rpcError(-32001, 'Unauthorized'));
      return;
    }

    const actor = await this.actingUser(config.userEmail);
    if (!actor) {
      this.logger.error('MCP_USER_EMAIL does not name an active maSquare user, so the connector cannot act.');
      res.status(403).json(rpcError(-32001, 'The connector is not linked to an active maSquare user.'));
      return;
    }

    const server = buildMasquareServer({ listing: this.listing, onbuy: this.onbuy, scope: this.scope, prisma: this.prisma }, actor);
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

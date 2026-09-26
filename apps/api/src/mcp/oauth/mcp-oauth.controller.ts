import { Controller, NotFoundException, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../auth/public.decorator';
import { NoAccessCheck } from '../../access/access.decorators';
import { McpOAuthService } from './mcp-oauth.service';

/**
 * Where the connector's sign-in form posts: `POST /api/mcp/oauth/login`.
 *
 * The rest of the OAuth flow (metadata, registration, /authorize, /token, /revoke) is the MCP SDK's
 * router, mounted at the application root in main.ts; only this step is ours, because only this step
 * checks a maSquare password. Public, because the person is not signed in to maSquare yet.
 */
@ApiExcludeController()
@Controller('mcp/oauth')
@Public()
@NoAccessCheck()
export class McpOAuthController {
  constructor(private readonly oauth: McpOAuthService) {}

  @Post('login')
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.oauth.config.enabled) throw new NotFoundException();
    const outcome = await this.oauth.completeLogin(req.body ?? {});
    if (outcome.kind === 'redirect') {
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, outcome.url);
      return;
    }
    res.status(outcome.status).set(outcome.headers).send(outcome.html);
  }
}

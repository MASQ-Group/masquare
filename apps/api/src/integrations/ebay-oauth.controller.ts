import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IntegrationsService } from './integrations.service';
import { AccessArea } from '../access/access.decorators';

/**
 * eBay OAuth redirect landing. eBay sends the browser here (the RuName's "accepted URL")
 * with ?code=…&state=<integration id> after the seller consents. We exchange the code for a
 * refresh token server-side (using the integration's own encrypted App ID + Cert ID) and store
 * it. Public — eBay redirects the user's browser here unauthenticated; the code is single-use
 * and short-lived, and `state` must be a known eBay integration.
 */
@ApiExcludeController()
@Controller('ebay/oauth')
@AccessArea('integrations')
export class EbayOAuthController {
  constructor(private readonly svc: IntegrationsService) {}

  @Get('callback')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async callback(@Query('code') code?: string, @Query('state') state?: string) {
    if (!code || !state) return page('Connection failed', 'Missing authorization code — please start the eBay connection again from the platform.', false);
    try {
      const r = await this.svc.exchangeEbayOAuthCode(state, code);
      const validity = r.refreshTokenExpiresInDays ? ` The connection is valid for about <b>${r.refreshTokenExpiresInDays} days</b>.` : '';
      return page('eBay connected', `Your eBay account is now linked to <b>${escapeHtml(r.name)}</b>.${validity} You can close this tab and return to the platform.`, true);
    } catch (e: any) {
      return page('Connection failed', escapeHtml(e?.message ?? 'Token exchange failed.'), false);
    }
  }

  @Get('declined')
  @Header('Content-Type', 'text/html; charset=utf-8')
  declined() {
    return page('Connection cancelled', 'You declined the authorization, so nothing was changed. You can start again any time from the platform.', false);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function page(title: string, body: string, ok: boolean): string {
  const accent = ok ? '#0e7a73' : '#c63b1b';
  const icon = ok ? '✓' : '✕';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} — maSquare</title>
<style>body{margin:0;background:#f6f8f7;color:#1c211f;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:grid;place-items:center;min-height:100vh}
.card{background:#fff;border:1px solid #e3e8e5;border-radius:16px;padding:34px 34px 38px;max-width:460px;margin:20px;text-align:center}
.badge{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;margin:0 auto 14px;font-size:26px;color:#fff;background:${accent}}
h1{font-size:20px;margin:0 0 8px;letter-spacing:-0.01em}p{color:#33403a;margin:0}</style></head>
<body><div class="card"><div class="badge">${icon}</div><h1>${escapeHtml(title)}</h1><p>${body}</p></div></body></html>`;
}

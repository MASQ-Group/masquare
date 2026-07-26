import { Body, Controller, Get, HttpCode, Logger, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { createHash } from 'crypto';

/**
 * eBay Marketplace Account Deletion / Closure notifications.
 *
 * eBay requires every production application to expose ONE public HTTPS endpoint that:
 *  1. Answers a validation *challenge* (GET ?challenge_code=…) with the SHA-256 hash of
 *     challengeCode + verificationToken + endpointURL — this is what the Developer Portal
 *     ("Send Test Notification") checks when you register the endpoint.
 *  2. Receives account-deletion *notifications* (POST) and acknowledges them (2xx).
 *
 * Both the verification token and the exact registered endpoint URL come from env vars, so
 * moving to a custom domain later is just: update EBAY_DELETION_ENDPOINT_URL + the portal URL.
 * The token (EBAY_VERIFICATION_TOKEN) stays the same across domains.
 *
 * This controller is intentionally public (no JwtAuthGuard) — eBay calls it unauthenticated.
 * maSquare stores no eBay buyer PII (SalesTransaction holds no buyer name/address/email), so a
 * deletion notification has nothing to purge today; we validate + acknowledge. If buyer PII is
 * ever stored, add the purge in `notification()`.
 */
@ApiExcludeController()
@Controller('ebay/notifications')
export class EbayNotificationsController {
  private readonly logger = new Logger('EbayNotifications');

  /** Endpoint-validation challenge. eBay expects 200 + { challengeResponse: <sha256 hex> }. */
  @Get('account-deletion')
  challenge(@Query('challenge_code') challengeCode?: string) {
    const token = process.env.EBAY_VERIFICATION_TOKEN ?? '';
    const endpoint = process.env.EBAY_DELETION_ENDPOINT_URL ?? '';
    if (!token || !endpoint) {
      this.logger.warn('EBAY_VERIFICATION_TOKEN or EBAY_DELETION_ENDPOINT_URL is not set — challenge will not validate.');
    }
    const challengeResponse = createHash('sha256')
      .update(challengeCode ?? '')
      .update(token)
      .update(endpoint)
      .digest('hex');
    return { challengeResponse };
  }

  /** Live account-deletion notification. Acknowledge with 200; nothing to purge (no buyer PII). */
  @Post('account-deletion')
  @HttpCode(200)
  notification(@Body() body: any) {
    const username = body?.notification?.data?.username ?? body?.notification?.data?.userId ?? 'unknown';
    this.logger.log(`Received eBay account-deletion notification for user "${username}" — acknowledged (no stored PII to purge).`);
    return { ok: true };
  }
}

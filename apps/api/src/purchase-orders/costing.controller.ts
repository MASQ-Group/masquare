import { Body, Controller, Get, Param, Post, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { CostingReadService } from './costing-read.service';
import { AccessArea } from '../access/access.decorators';

@ApiTags('costing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('costing')
@AccessArea('purchasing')
export class CostingController {
  constructor(private readonly svc: CostingReadService) {}

  /** The ledger behind one product's average cost, newest first. */
  @Get('products/:productId/history')
  history(@Param('productId') productId: string, @Query('limit') limit?: string) {
    return this.svc.history(productId, limit ? Number(limit) : undefined);
  }

  /** Products with no average cost yet, so the gap is visible before it matters. */
  @Get('uncosted')
  uncosted(@Query('limit') limit?: string) {
    return this.svc.uncosted(limit ? Number(limit) : undefined);
  }

  /** What this product was last purchased at on a submitted PO — for the "up/down vs last" hint. */
  @Get('products/:productId/last-purchase-cost')
  lastPurchaseCost(@Param('productId') productId: string) {
    return this.svc.lastPurchaseCost(productId);
  }

  /**
   * Seed opening averages from the catalogue purchase cost for products that have
   * never been costed. Admin-only and idempotent — it skips anything already costed,
   * so running it twice cannot distort a value the receiving process has established.
   */
  @Post('seed-opening')
  seedOpening(@Body() body: { productIds?: string[]; dryRun?: boolean }, @CurrentUser() user: AuthUser) {
    if (!user.isAdmin) throw new ForbiddenException('Admin only');
    return this.svc.seedOpening(body?.productIds, body?.dryRun ?? false, user.sub);
  }
}

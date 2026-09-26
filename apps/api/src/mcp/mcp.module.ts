import { Module } from '@nestjs/common';
import { ListingModule } from '../listing/listing.module';
import { CompanyScopeService } from '../common/company-scope';
import { McpController } from './mcp.controller';

/**
 * The maSquare connector — how Claude, run by a person on their own Claude plan, researches products
 * and hands the evidence back. Off unless MCP_TOKEN and MCP_USER_EMAIL are configured;
 * MCP_ADMIN_TOKEN and MCP_ADMIN_USER_EMAIL optionally add an owner token that acts as another user.
 *
 * `CompanyScopeService` is provided here as well as in the root module because it is not exported
 * from there; it is stateless and only needs Prisma, which is global, so a second instance is safe.
 */
@Module({
  imports: [ListingModule],
  controllers: [McpController],
  providers: [CompanyScopeService],
})
export class McpModule {}

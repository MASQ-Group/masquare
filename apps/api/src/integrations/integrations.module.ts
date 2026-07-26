import { Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { EbayNotificationsController } from './ebay-notifications.controller';
import { EbayOAuthController } from './ebay-oauth.controller';
import { SalesTransactionsModule } from '../sales-transactions/sales-transactions.module';

@Module({
  imports: [SalesTransactionsModule],
  controllers: [IntegrationsController, EbayNotificationsController, EbayOAuthController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}

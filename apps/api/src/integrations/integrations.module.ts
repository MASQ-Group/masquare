import { Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { EbayNotificationsController } from './ebay-notifications.controller';
import { EbayOAuthController } from './ebay-oauth.controller';
import { SalesTransactionsModule } from '../sales-transactions/sales-transactions.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [SalesTransactionsModule, JobsModule],
  controllers: [IntegrationsController, EbayNotificationsController, EbayOAuthController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}

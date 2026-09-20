import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SalesTransactionsModule } from '../sales-transactions/sales-transactions.module';
import { JiniusOrdersController } from './jinius-orders.controller';
import { JiniusOrdersService } from './jinius-orders.service';

/**
 * Jinius orders. Its own module because these orders are not sales transactions and not channel
 * listings: they sit between the marketplace and the local invoice accounting issues for them.
 */
@Module({
  imports: [IntegrationsModule, SalesTransactionsModule],
  controllers: [JiniusOrdersController],
  // Under a token as well, so IntegrationsService can reach it lazily: Jinius imports Integrations,
  // and a direct injection the other way would be a cycle.
  providers: [JiniusOrdersService, { provide: 'JINIUS_ORDERS_SERVICE', useExisting: JiniusOrdersService }],
  exports: [JiniusOrdersService, 'JINIUS_ORDERS_SERVICE'],
})
export class JiniusModule {}

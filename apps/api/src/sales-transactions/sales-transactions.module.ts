import { Module } from '@nestjs/common';
import { SalesTransactionsService } from './sales-transactions.service';
import { SalesTransactionsController } from './sales-transactions.controller';

@Module({
  controllers: [SalesTransactionsController],
  providers: [SalesTransactionsService],
  exports: [SalesTransactionsService],
})
export class SalesTransactionsModule {}

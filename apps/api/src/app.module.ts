import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { ModulesModule } from './modules-catalog/modules.module';
import { GlobalSettingsModule } from './global-settings/global-settings.module';
import { GlobalDataModule } from './global-data/global-data.module';
import { ProductsModule } from './products/products.module';
import { SalesTransactionsModule } from './sales-transactions/sales-transactions.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { SearchModule } from './search/search.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CustomsFxModule } from './customs-fx/customs-fx.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    StorageModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    ModulesModule,
    GlobalSettingsModule,
    GlobalDataModule,
    ProductsModule,
    SalesTransactionsModule,
    ShipmentsModule,
    SearchModule,
    AnalyticsModule,
    CustomsFxModule,
    IntegrationsModule,
  ],
})
export class AppModule {}

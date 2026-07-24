import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
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
import { FbaShipmentsModule } from './fba-shipments/fba-shipments.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { PricingModule } from './pricing/pricing.module';
import { ProcurementModule } from './procurement/procurement.module';
import { InventoryModule } from './inventory/inventory.module';
import { SearchModule } from './search/search.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CustomsFxModule } from './customs-fx/customs-fx.module';
import { ExpensesModule } from './expenses/expenses.module';
import { AvailabilityModule } from './availability/availability.module';
import { ChannelListingsModule } from './channel-listings/channel-listings.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Serve the built SPA (apps/web/dist) for every non-/api route, so a single
    // service hosts both the API and the frontend on one origin in production.
    // In local dev the folder may not exist; serve-static simply serves nothing then.
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'apps/web/dist'),
      exclude: ['/api*'],
    }),
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
    FbaShipmentsModule,
    WarehousesModule,
    PurchaseOrdersModule,
    ProcurementModule,
    InventoryModule,
    PricingModule,
    SearchModule,
    AnalyticsModule,
    CustomsFxModule,
    ExpensesModule,
    AvailabilityModule,
    ChannelListingsModule,
    IntegrationsModule,
  ],
})
export class AppModule {}

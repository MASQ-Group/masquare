import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { ModulesModule } from './modules-catalog/modules.module';
import { GlobalSettingsModule } from './global-settings/global-settings.module';
import { GlobalDataModule } from './global-data/global-data.module';
import { ProductsModule } from './products/products.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    ModulesModule,
    GlobalSettingsModule,
    GlobalDataModule,
    ProductsModule,
  ],
})
export class AppModule {}

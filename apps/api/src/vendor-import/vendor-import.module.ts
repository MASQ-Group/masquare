import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VendorImportController } from './vendor-import.controller';
import { VendorImportService } from './vendor-import.service';

@Module({
  imports: [PrismaModule],
  controllers: [VendorImportController],
  providers: [VendorImportService],
  exports: [VendorImportService],
})
export class VendorImportModule {}

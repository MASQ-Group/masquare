import { Module } from '@nestjs/common';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { PortalGuard } from './portal.guard';
import { CustomerShipmentsModule } from '../customer-shipments/customer-shipments.module';

/** The customer portal: its own routes, its own guard, nothing shared with the platform's screens. */
@Module({
  imports: [CustomerShipmentsModule],
  controllers: [PortalController],
  providers: [PortalService, PortalGuard],
})
export class PortalModule {}

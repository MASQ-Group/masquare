import { Module } from '@nestjs/common';
import { CarriersService } from './carriers.service';
import { CarriersController } from './carriers.controller';
import { CryptoModule } from '../crypto/crypto.module';
import { TrackingSweepService } from './tracking-sweep.service';
import { DutyRulesService } from './duty-rules.service';
import { DutyRulesController } from './duty-rules.controller';

/**
 * Carrier accounts and, in time, everything that runs on them — rating, labels, pickups, tracking.
 *
 * Exported because the shipments module will need `token()` once there is more than authentication
 * to do, and every FedEx call has to go through the one cache.
 */
@Module({
  imports: [CryptoModule],
  controllers: [CarriersController, DutyRulesController],
  providers: [CarriersService, TrackingSweepService, DutyRulesService],
  exports: [CarriersService, DutyRulesService],
})
export class CarriersModule {}
